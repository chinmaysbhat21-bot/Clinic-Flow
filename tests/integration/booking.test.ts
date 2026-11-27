import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileOffline } from '../../apps/api/src/recovery.js';
import { Payments } from '../../apps/api/src/payments.js';
import { Engine } from '../../apps/api/src/core.js';
import { expireHolds,openDb,seed,transaction } from '../../apps/api/src/db.js';
import { createApp } from '../../apps/api/src/server.js';
import { signature } from '../../apps/api/src/core.js';
import { GoogleAdapter } from '../../apps/api/src/adapters.js';
import type { PaymentProvider } from '../../apps/api/src/payments.js';

function signal() {
 let resolve!: () => void;
 const promise = new Promise<void>(done => { resolve = done; });
 return {promise, resolve};
}

test('additive migration preserves existing clinic data across reopen', () => {
 const directory=mkdtempSync(join(tmpdir(),'clinic-migration-'));
 const path=join(directory,'clinic.db');
 try {
  const legacy=openDb(path);
  try {
   seed(legacy);
   legacy.exec('DROP TABLE booking_operations; DROP TABLE payment_order_attempts;');
  } finally {legacy.close();}
  const migrated=openDb(path);
  try {
   assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM clinics').get()?.count,2);
   assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM booking_operations').get()?.count,0);
   assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM payment_order_attempts').get()?.count,0);
  } finally {migrated.close();}
 } finally {rmSync(directory,{recursive:true});}
});

test('a confirmation claim survives expiry on a second connection and ambiguous provider success', async () => {
 const directory=mkdtempSync(join(tmpdir(),'clinic-confirm-recovery-'));
 const path=join(directory,'clinic.db');
 try {
  const f=await fixture(path);
  let holdId='', session='', externalId='';
  try {
   const hold=await f.verifiedHold();
   holdId=hold.id;
   session=f.session;
   const payment=await f.pay(holdId);
   await payment.verify();
   const adapter=f.engine.adapters('lotus');
   const confirm=adapter.confirmBooking.bind(adapter);
   const applied=signal(), release=signal();
   adapter.confirmBooking=async input=>{
    externalId=await confirm(input);
    applied.resolve();
    await release.promise;
    throw new Error('Provider response lost');
   };
   f.engine.adapters=()=>adapter;
   const confirmation=assert.rejects(f.engine.confirm('lotus',session,holdId),{code:'CONFIRMATION_PENDING'});
   await applied.promise;
   const second=openDb(path);
   try {
    f.advance(301000);
    transaction(second,()=>expireHolds(second,f.engine.now()));
    const other=new Engine(second,()=>{throw new Error('Unexpected provider call');},undefined,f.engine.now);
    await assert.rejects(other.confirm('lotus',session,holdId),{code:'CONFIRMATION_PENDING'});
    assert.equal(other.hold('lotus',session,holdId,false).state,'CONFIRMATION_PENDING');
    assert.equal(other.one('SELECT state FROM payments WHERE hold_id=?',holdId)?.state,'VERIFIED');
    assert.equal(other.all('SELECT id FROM appointments').length,1);
    assert.equal((await payment.verify()).data.state,'VERIFIED');
   } finally {second.close();release.resolve();}
   await confirmation;
  } finally {await f.close();}
  const restarted=openDb(path);
  try {
   const other=new Engine(restarted,()=>{throw new Error('Unexpected provider call');},undefined,f.engine.now);
   await assert.rejects(other.confirm('lotus',session,holdId),{code:'CONFIRMATION_PENDING'});
   assert.equal(other.one('SELECT state FROM mock_bookings WHERE id=?',externalId)?.state,'CONFIRMED');
   reconcileOffline(restarted,{kind:'CONFIRM',clinicId:'lotus',holdId,outcome:'applied',externalId},other.now());
   const first=await other.confirm('lotus',session,holdId);
   assert.equal(first.state,'CONFIRMED');
   assert.equal((await other.confirm('lotus',session,holdId)).id,first.id);
   assert.equal(other.hold('lotus',session,holdId,false).state,'CONFIRMED');
   assert.equal(other.one('SELECT state FROM payments WHERE hold_id=?',holdId)?.state,'VERIFIED');
  } finally {restarted.close();}
 } finally {rmSync(directory,{recursive:true});}
});

test('expiry wins before confirmation on a second connection for verified and delayed payments', async () => {
 const directory=mkdtempSync(join(tmpdir(),'clinic-expiry-race-'));
 const path=join(directory,'clinic.db');
 try {
  const f=await fixture(path);
  const second=openDb(path);
  try {
   const other=new Engine(second,()=>{throw new Error('Unexpected provider call');},undefined,f.engine.now);
   const paid=await f.verifiedHold();
   await (await f.pay(paid.id)).verify();
   f.advance(301000);
   transaction(second,()=>expireHolds(second,other.now()));
   await assert.rejects(f.engine.confirm('lotus',f.session,paid.id),{code:'HOLD_EXPIRED'});
   assert.equal(other.one('SELECT state FROM payments WHERE hold_id=?',paid.id)?.state,'REFUND_PENDING');
   const pending=await f.verifiedHold();
   const payment=await f.pay(pending.id);
   const lookup=f.provider.payment.bind(f.provider);
   const entered=signal(), release=signal();
   f.provider.payment=async id=>{entered.resolve();await release.promise;return lookup(id);};
   const delayed=payment.verify();
   await entered.promise;
   try {
    f.advance(301000);
    await assert.rejects(other.confirm('lotus',f.session,pending.id),{code:'HOLD_EXPIRED'});
   } finally {release.resolve();}
   assert.equal((await delayed).data.state,'REFUND_PENDING');
   assert.equal(other.hold('lotus',f.session,pending.id,false).state,'EXPIRED');
   assert.equal(other.all('SELECT id FROM appointments').length,0);
  } finally {second.close();await f.close();}
 } finally {rmSync(directory,{recursive:true});}
});

async function fixture(path = ':memory:'){
 const db=openDb(path);seed(db,'test-password-123');let now=Date.parse('2026-12-01T00:00:00Z');const codes=new Map<string,string>();const orders=new Map<string,number>();const captured=new Map<string,{order:string;amount:number}>();
 const provider:PaymentProvider={keyId:'rzp_test_fixture',secret:'fixture-secret',async order(amount){const id=randomUUID();orders.set(id,amount);return {id,amount,currency:'INR'};},async payment(id){const p=captured.get(id)!;return {id,order_id:p.order,amount:p.amount,currency:'INR',status:'captured'};}};
 const state=createApp(db,{mockKey:'fixture-only-key',provider,now:()=>now,otpSink:(id,code)=>codes.set(id,code)});
 const server=state.app.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address() as {port:number};const base=`http://127.0.0.1:${addr.port}`;
 // Redirect mock adapter to this ephemeral HTTP server.
 const { MockAdapter }=await import('../../apps/api/src/adapters.js');const original=state.engine.adapters;state.engine.adapters=c=>c==='lotus'?new MockAdapter(`${base}/mock`,c,'fixture-only-key'):original(c);
 async function request(path:string,method='GET',body?:unknown,session?:string,clinic='lotus',token?:string){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Clinic-Id':clinic,'X-Session-Id':session??'',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
 const session=(await request('/api/sessions','POST',{clinicId:'lotus'})).data.sessionId;
 const consent=()=>request('/api/consent','POST',{booking:true,briefing:true},session);
 const input={doctorId:'lotus-doctor',serviceId:'lotus-consult',start:'2026-12-01T03:30:00.000Z'};
 const reserve=()=>request('/api/holds','POST',input,session);
 async function verifiedHold(){await consent();const h=(await reserve()).data;await request('/api/otp/send','POST',{holdId:h.id,phone:'+919999999999'},session);const r=await request('/api/otp/verify','POST',{holdId:h.id,phone:'+919999999999',code:codes.get(h.id)},session);assert.equal(r.status,200);return h;}
 async function pay(id:string){const r=await request('/api/payments/order','POST',{holdId:id},session);assert.equal(r.status,200,JSON.stringify(r));const order=r.data;const paymentId=randomUUID();captured.set(paymentId,{order:order.orderId,amount:order.amount});const body={holdId:id,razorpay_order_id:order.orderId,razorpay_payment_id:paymentId,razorpay_signature:signature(provider.secret,`${order.orderId}|${paymentId}`)};return {body,verify:()=>request('/api/payments/verify','POST',body,session)};}
 return {...state,provider,db,request,session,codes,input,consent,reserve,verifiedHold,pay,advance:(ms:number)=>{now+=ms;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}};
}
test('delayed duplicate capture and simultaneous confirmation preserve confirmed state', async () => {
 const f=await fixture();
 try {
  const hold=await f.verifiedHold();
  const payment=await f.pay(hold.id);
  const paymentLookup=f.provider.payment.bind(f.provider);
  const entered=signal(), release=signal();
  let lookups=0;
  f.provider.payment=async id=>{
   if(++lookups===1){entered.resolve();await release.promise;}
   return paymentLookup(id);
  };
  const delayed=payment.verify();
  await entered.promise;
  try {
   assert.equal((await payment.verify()).data.state,'PAYMENT_VERIFIED');
   const adapter=f.engine.adapters('lotus');
   const confirm=adapter.confirmBooking.bind(adapter);
   const started=signal(), finish=signal();
   let confirmations=0;
   adapter.confirmBooking=async input=>{confirmations++;started.resolve();await finish.promise;return confirm(input);};
   f.engine.adapters=()=>adapter;
   const first=f.engine.confirm('lotus',f.session,hold.id);
   await started.promise;
   try {
    await assert.rejects(f.engine.confirm('lotus',f.session,hold.id),{code:'CONFIRMATION_PENDING'});
   } finally { finish.resolve(); }
   assert.equal((await first).state,'CONFIRMED');
   assert.equal(confirmations,1);
  } finally { release.resolve(); }
  assert.equal((await delayed).data.state,'VERIFIED');
  assert.equal(f.engine.hold('lotus',f.session,hold.id,false).state,'CONFIRMED');
  assert.equal(f.engine.all('SELECT id FROM appointments').length,1);
 } finally { await f.close(); }
});

test('ambiguous order persists across restart and verified evidence restores checkout', async () => {
 const directory=mkdtempSync(join(tmpdir(),'clinic-recovery-'));
 const path=join(directory,'clinic.db');
 try {
  const f=await fixture(path);
  let hold;
  const captured: {order?: Awaited<ReturnType<PaymentProvider['order']>>} = {};
  try {
   hold=await f.verifiedHold();
   const create=f.provider.order.bind(f.provider);
   f.provider.order=async (...args)=>{
    captured.order=await create(...args);
    throw new Error('Simulated timeout after order creation');
   };
   await assert.rejects(f.payments.order('lotus',f.session,hold.id));
  } finally { await f.close(); }
  const db=openDb(path);
  try {
   const engine=new Engine(db,()=>{throw new Error('Unexpected adapter call');},undefined,f.engine.now);
   const payments=new Payments(engine,f.provider);
   await assert.rejects(payments.order('lotus',f.session,hold.id),{code:'ORDER_PENDING'});
   const externalOrder=captured.order;
   assert.ok(externalOrder);
   const evidence={kind:'ORDER',clinicId:'lotus',holdId:hold.id,orderId:externalOrder.id,amount:externalOrder.amount,currency:'INR',receipt:hold.id} as const;
   assert.throws(()=>reconcileOffline(db,{...evidence,clinicId:'harbor'}),/Unknown clinic/);
   reconcileOffline(db,evidence);
   assert.equal((await payments.order('lotus',f.session,hold.id)).orderId,externalOrder.id);
  } finally { db.close(); }
 } finally { rmSync(directory,{recursive:true}); }
});

test('replacement must be unused and cancellation cannot race reschedule', async () => {
 const f=await fixture();
 try {
  const hold=await f.verifiedHold();
  await (await f.pay(hold.id)).verify();
  const booking=await f.engine.confirm('lotus',f.session,hold.id);
  await assert.rejects(f.engine.reschedule('lotus',f.session,booking.id,hold.id),{code:'INVALID_RESCHEDULE'});
  const replacement=await f.engine.reserve('lotus',f.session,{...f.input,start:'2026-12-02T03:30:00.000Z'});
  const adapter=f.engine.adapters('lotus');
  const move=adapter.rescheduleBooking.bind(adapter);
  const entered=signal(), release=signal();
  let calls=0;
  adapter.rescheduleBooking=async (...args)=>{calls++;entered.resolve();await release.promise;await move(...args);};
  f.engine.adapters=()=>adapter;
  const first=f.engine.reschedule('lotus',f.session,booking.id,replacement.id);
  await entered.promise;
  try {
   await assert.rejects(f.engine.cancel('lotus',f.session,booking.id),{code:'INVALID_STATE'});
   await assert.rejects(f.engine.reschedule('lotus',f.session,booking.id,replacement.id),{code:'RESCHEDULE_PENDING'});
  } finally {release.resolve();}
  const moved=await first;
  assert.equal((await f.engine.reschedule('lotus',f.session,booking.id,replacement.id)).start,moved.start);
  assert.equal(calls,1);
 } finally {await f.close();}
});

test('timeout after external cancellation survives restart without repeating cancellation', async () => {
 const directory=mkdtempSync(join(tmpdir(),'clinic-booking-recovery-'));
 const path=join(directory,'clinic.db');
 try {
  const f=await fixture(path);
  let hold,booking;
  try {
   hold=await f.verifiedHold();
   await (await f.pay(hold.id)).verify();
   booking=await f.engine.confirm('lotus',f.session,hold.id);
   const adapter=f.engine.adapters('lotus');
   const cancel=adapter.cancelBooking.bind(adapter);
   adapter.cancelBooking=async id=>{await cancel(id);throw new Error('Simulated response timeout');};
   f.engine.adapters=()=>adapter;
   await assert.rejects(f.engine.cancel('lotus',f.session,booking.id),/Simulated response timeout/);
   await assert.rejects(f.engine.cancel('lotus',f.session,booking.id),{code:'INVALID_STATE'});
   assert.equal(f.engine.one('SELECT state FROM mock_bookings WHERE id=?',booking.external_id)?.state,'CANCELLED');
  } finally {await f.close();}
  const db=openDb(path);
  try {
   const engine=new Engine(db,()=>{throw new Error('Unexpected adapter call');},undefined,f.engine.now);
   await assert.rejects(engine.cancel('lotus',f.session,booking.id),{code:'INVALID_STATE'});
   reconcileOffline(db,{kind:'CANCEL',clinicId:'lotus',holdId:hold.id,outcome:'applied'},engine.now());
   assert.equal((await engine.cancel('lotus',f.session,booking.id)).state,'CANCELLED');
  } finally {db.close();}
 } finally {rmSync(directory,{recursive:true});}
});
test('SQLite health, consent, clinic isolation and admin authorization',async()=>{const f=await fixture();try{assert.equal((await f.request('/api/health')).data.database,'sqlite');assert.equal((await f.reserve()).error.code,'CONSENT_REQUIRED');assert.equal((await f.request('/api/admin/appointments')).status,401);await f.consent();assert.equal((await f.request('/api/slots?doctorId=harbor-doctor&serviceId=lotus-consult&date=2026-12-01','GET',undefined,f.session)).error.code,'INVALID_SELECTION');assert.equal((await f.request('/api/slots?doctorId=lotus-doctor&serviceId=lotus-consult&date=2026-12-01','GET',undefined,f.session,'harbor')).status,401);}finally{await f.close();}});
test('concurrent HTTP holds have exactly one winner and expiry releases capacity',async()=>{const f=await fixture();try{await f.consent();const results=await Promise.all(Array.from({length:8},()=>f.reserve()));assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,7);f.advance(301000);assert.equal((await f.reserve()).status,201);}finally{await f.close();}});
test('OTP rejects invalid code, enforces retry limit, cooldown and single consumption',async()=>{const f=await fixture();try{await f.consent();const h=(await f.reserve()).data;const input={holdId:h.id,phone:'+919999999999'};const sent=await f.request('/api/otp/send','POST',input,f.session);assert.equal(sent.data.code,undefined);assert.equal((await f.request('/api/otp/send','POST',input,f.session)).status,429);for(let i=0;i<5;i++)assert.equal((await f.request('/api/otp/verify','POST',{...input,code:'000000'},f.session)).status,400);assert.equal((await f.request('/api/otp/verify','POST',{...input,code:f.codes.get(h.id)},f.session)).status,400);}finally{await f.close();}});
test('paid verified confirmation is idempotent, visible to admin, blocks overlap and creates ICS',async()=>{const f=await fixture();try{const h=await f.verifiedHold();const p=await f.pay(h.id);assert.equal((await f.request('/api/payments/verify','POST',{...p.body,razorpay_signature:'bad'},f.session)).error.code,'INVALID_PAYMENT_SIGNATURE');assert.equal((await p.verify()).data.state,'PAYMENT_VERIFIED');assert.equal((await p.verify()).data.state,'VERIFIED');const r=await f.request('/api/bookings/confirm','POST',{holdId:h.id},f.session);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.state,'CONFIRMED');assert.equal((await f.request('/api/bookings/confirm','POST',{holdId:h.id},f.session)).data.id,r.data.id);assert.equal((await f.reserve()).status,409);const login=await f.request('/api/admin/login','POST',{email:'lotus@demo.invalid',password:'test-password-123'});const list=await f.request('/api/admin/appointments','GET',undefined,undefined,'lotus',login.data.token);assert.equal(list.data.length,1);assert.equal(list.data[0].id,r.data.id);assert.equal(f.engine.all('SELECT * FROM mock_bookings WHERE state=?','CONFIRMED').length,1);assert.equal((await f.request(`/api/bookings/${r.data.id}/briefing`,'POST',{patientReportedSummary:'Patient reports tooth discomfort.'},f.session)).error.code,'BRIEFING_DESTINATION_NOT_CONFIGURED');assert.equal(f.engine.briefing('lotus',f.session,r.data.id,'Patient reports tooth discomfort.','test@example.invalid').delivered,false);assert.equal(f.engine.briefing('lotus',f.session,r.data.id,'duplicate','test@example.invalid').delivered,false);assert.equal(f.engine.all("SELECT * FROM outbox WHERE kind='BRIEFING'").length,1);}finally{await f.close();}});
test('late captured payment becomes refund pending and cannot confirm',async()=>{const f=await fixture();try{const h=await f.verifiedHold(),p=await f.pay(h.id);f.advance(301000);assert.equal((await p.verify()).data.state,'REFUND_PENDING');assert.equal((await f.request('/api/bookings/confirm','POST',{holdId:h.id},f.session)).error.code,'HOLD_EXPIRED');}finally{await f.close();}});
test('reschedule updates external state and cancellation records pending refund',async()=>{const f=await fixture();try{const h=await f.verifiedHold(),p=await f.pay(h.id);await p.verify();const a=(await f.request('/api/bookings/confirm','POST',{holdId:h.id},f.session)).data;const next=(await f.request('/api/holds','POST',{...f.input,start:'2026-12-02T03:30:00.000Z'},f.session)).data;const r=await f.request(`/api/bookings/${a.id}/reschedule`,'POST',{holdId:next.id},f.session);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.start,next.start);assert.equal(f.engine.one('SELECT start FROM mock_bookings WHERE id=?',a.external_id)!.start,next.start);const c=await f.request(`/api/bookings/${a.id}/cancel`,'POST',{},f.session);assert.equal(c.data.state,'REFUND_PENDING');assert.equal(f.engine.one('SELECT state FROM mock_bookings WHERE id=?',a.external_id)!.state,'CANCELLED');}finally{await f.close();}});
test('admin appointment reads and actions expose only dashboard fields', async () => {
 const f = await fixture();
 try {
  const hold = await f.verifiedHold();
  const payment = await f.pay(hold.id);
  await payment.verify();
  const booking = (await f.request('/api/bookings/confirm', 'POST', {holdId: hold.id}, f.session)).data;
  const login = await f.request('/api/admin/login', 'POST', {email:'lotus@demo.invalid', password:'test-password-123'});
  const admin = (path: string, method = 'GET', body?: unknown) =>
   f.request('/api/admin/appointments' + path, method, body, undefined, 'lotus', login.data.token);
  const {id, reference, doctor_id, service_id, start, end, state} = booking;
  const expected = {id, reference, doctor_id, service_id, start, end, state};
  assert.deepEqual((await admin('')).data, [expected]);
  const replacement = {...f.input, start:'2026-12-02T03:30:00.000Z'};
  const moved = await admin(`/${id}/reschedule`, 'POST', replacement);
  const updated = {...expected, start:replacement.start, end:'2026-12-02T04:00:00.000Z'};
  assert.deepEqual(moved.data, updated);
  assert.deepEqual((await admin(`/${id}/cancel`, 'POST')).data, {...updated, state:'REFUND_PENDING'});
 } finally {
  await f.close();
 }
});
test('Google adapter fails closed without credentials',async()=>{await assert.rejects(()=>new GoogleAdapter('','').getSlots({doctorId:'x',start:'2026-12-01T00:00:00Z',end:'2026-12-02T00:00:00Z'}),/Google Calendar credentials/);});
