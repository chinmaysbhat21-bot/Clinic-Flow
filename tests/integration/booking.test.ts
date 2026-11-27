import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileOffline } from '../../apps/api/src/recovery.js';
import { configureBrevo } from '../../apps/api/src/brevo-notifications.js';
import { configureOtpDelivery } from '../../apps/api/src/otp-delivery.js';
import { Payments } from '../../apps/api/src/payments.js';
import { Engine } from '../../apps/api/src/core.js';
import { ReconciliationWorker } from '../../apps/api/src/reconciliation.js';
import { configureNotificationDelivery,NotificationWorker,type NotificationProvider } from '../../apps/api/src/notification-worker.js';
import { enqueuePaymentNotice } from '../../apps/api/src/notification-outbox.js';
import { approveRefund,RefundWorker } from '../../apps/api/src/refund-worker.js';
import type { ProviderRefund } from '../../apps/api/src/payments.js';
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
 const webhookSecret='fixture-webhook-secret';
 const state=createApp(db,{mockKey:'fixture-only-key',webhookSecret,provider,now:()=>now,otpSink:(id,code)=>codes.set(id,code)});
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
 async function webhook(eventId:string,event:string,id:string,order_id:string,valid=true){
  const payload=event.startsWith('refund.')?{refund:{entity:{id,payment_id:order_id}}}:{payment:{entity:{id,order_id}}};
  const body=JSON.stringify({event,payload});
  return fetch(base+'/api/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Razorpay-Event-Id':eventId,'X-Razorpay-Signature':valid?signature(webhookSecret,body):'invalid'},body});
 }
 return {...state,provider,db,request,webhook,session,codes,input,consent,reserve,verifiedHold,pay,advance:(ms:number)=>{now+=ms;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}};
}

test('admin filters, fee updates, logout and clinic scoping preserve booking data',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  const checkout=await f.pay(hold.id);
  await checkout.verify();
  const booking=await f.engine.confirm('lotus',f.session,hold.id);
  const login=async(clinic:string)=>(await f.request('/api/admin/login','POST',{email:clinic+'@demo.invalid',password:'test-password-123'})).data.token;
  const lotus=await login('lotus'),harbor=await login('harbor');
  const call=(path:string,method='GET',body?:unknown,token=lotus)=>f.request('/api/admin'+path,method,body,undefined,'lotus',token);
  assert.equal((await call('/appointments?from=2026-12-01&to=2026-12-01')).data[0].id,booking.id);
  assert.equal((await call('/appointments?from=bad')).status,400);
  assert.equal((await call('/appointments/'+booking.id,'GET',undefined,harbor)).status,404);
  const detail=(await call('/appointments/'+booking.id)).data;
  assert.deepEqual(Object.keys(detail).sort(),['id','reference','doctor_id','service_id','start','end','state','fee','duration'].sort());
  assert.equal(detail.fee,hold.fee);
  assert.equal(detail.duration,30);
  assert.equal((await call('/summary')).data.finance.verifiedPayments.amount,hold.fee);
  assert.equal((await call('/services/lotus-consult','PATCH',{active:false,description:'Fixture'})).status,200);
  assert.equal((await call('/services/lotus-consult','PATCH',{fee:60000})).status,200);
  const service=f.engine.one('SELECT active,description FROM services WHERE id=?','lotus-consult');
  assert.equal(service?.active,0);
  assert.equal(service?.description,'Fixture');
  assert.equal(f.engine.one('SELECT amount FROM payments WHERE hold_id=?',hold.id)?.amount,hold.fee);
  assert.equal(f.engine.booking('lotus',f.session,booking.id).state,'CONFIRMED');
  assert.equal((await call('/audit-logs')).data.some((entry:{actor_id:string|null;action:string})=>entry.actor_id&&entry.action==='SERVICE_UPDATED'),true);
  assert.equal((await call('/session','DELETE')).data.loggedOut,true);
  assert.equal((await call('/summary')).status,401);
  const expiring=await login('lotus');
  f.advance(3600000);
  assert.equal((await call('/summary','GET',undefined,expiring)).status,401);
 }finally{await f.close();}
});

test('availability reflects admin schedules, holidays, blocks and doctor-service assignments while preserving existing holds',async()=>{
 const f=await fixture();
 try{
  await f.consent();
  const hold=(await f.reserve()).data;
  const login=await f.request('/api/admin/login','POST',{email:'lotus@demo.invalid',password:'test-password-123'});
  const admin=(path:string,method:string,body?:unknown)=>f.request('/api/admin'+path,method,body,undefined,'lotus',login.data.token);
  const slots=(date:string)=>f.engine.slots('lotus','lotus-doctor','lotus-consult',date);
  assert.equal((await admin('/config','PATCH',{holidays:[{date:'2026-12-02'}],breaks:[{start:'10:00',end:'11:00',days:[2]}]})).status,200);
  assert.deepEqual(slots('2026-12-02'),[]);
  assert.ok(!slots('2026-12-01').some(s=>s.start==='2026-12-01T04:30:00.000Z'));
  assert.equal((await admin('/doctors/lotus-doctor/availability','PATCH',{days:[2],start:9,end:17})).status,200);
  assert.deepEqual(slots('2026-12-03'),[]);
  const block={start:'2026-12-01T06:30:00.000Z',end:'2026-12-01T07:00:00.000Z',reason:'Fixture'};
  const created=await admin('/blocks','POST',block);
  assert.equal(created.status,201);
  assert.ok(!slots('2026-12-01').some(s=>s.start===block.start));
  assert.equal((await admin('/blocks/'+created.data.id,'DELETE')).status,200);
  assert.ok(slots('2026-12-01').some(s=>s.start===block.start));
  assert.equal((await admin('/doctors/lotus-doctor/services/lotus-consult','DELETE')).status,200);
  assert.throws(()=>slots('2026-12-01'),{code:'INVALID_SELECTION'});
  assert.equal((await admin('/doctors/lotus-doctor/services','POST',{serviceId:'harbor-consult'})).status,400);
  assert.equal((await admin('/doctors/lotus-doctor/services','POST',{serviceId:'lotus-consult'})).status,200);
  assert.equal((await admin('/doctors/lotus-doctor','PATCH',{active:false})).status,200);
  assert.throws(()=>slots('2026-12-01'),{code:'INVALID_SELECTION'});
  assert.equal(f.engine.hold('lotus',f.session,hold.id).state,'HELD');
 }finally{await f.close();}
});

test('Phase 8 migration retains populated catalog rows and leaves legacy admin sessions unlinked',()=>{
 const directory=mkdtempSync(join(tmpdir(),'clinic-admin-migration-'));
 const path=join(directory,'clinic.db');
 try{
  const legacy=openDb(path);
  try{
   seed(legacy,'fixture-password');
   legacy.exec(`ALTER TABLE admin_sessions DROP COLUMN admin_id;
    ALTER TABLE admins DROP COLUMN role;
    ALTER TABLE doctors DROP COLUMN specialization;
    ALTER TABLE services DROP COLUMN description;
    ALTER TABLE appointments DROP COLUMN fee;
    ALTER TABLE appointments DROP COLUMN duration;
    INSERT INTO admin_sessions VALUES('fixture-hash','lotus',12345);`);
  }finally{legacy.close();}
  const migrated=openDb(path);
  try{
   const session=migrated.prepare('SELECT clinic_id,expires_at,admin_id FROM admin_sessions WHERE token_hash=?').get('fixture-hash');
   assert.equal(session?.clinic_id,'lotus');
   assert.equal(session?.expires_at,12345);
   assert.equal(session?.admin_id,null);
   assert.equal(migrated.prepare("SELECT role FROM admins WHERE clinic_id='lotus'").get()?.role,'OWNER');
   assert.equal(migrated.prepare("SELECT fee FROM services WHERE id='lotus-consult'").get()?.fee,50000);
   assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{migrated.close();}
 }finally{rmSync(directory,{recursive:true});}
});

test('manual reconciliation retains the guard when the provider has no matching event',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await (await f.pay(hold.id)).verify();
  const adapter=f.engine.adapters('lotus');
  adapter.confirmBooking=async()=>{throw new Error('Lost provider outcome');};
  adapter.lookupBooking=async()=>null;
  f.engine.adapters=()=>adapter;
  await assert.rejects(f.engine.confirm('lotus',f.session,hold.id),{code:'CONFIRMATION_PENDING'});
  f.advance(31000);
  const worker=new ReconciliationWorker(f.engine,f.payments,f.provider,{graceMs:0,maxAttempts:1});
  await worker.runOnce();
  const job=f.engine.one("SELECT id,status FROM reconciliation_jobs WHERE kind='CONFIRM'")!;
  assert.equal(job.status,'MANUAL');
  const login=await f.request('/api/admin/login','POST',{email:'lotus@demo.invalid',password:'test-password-123'});
  const resolution=await f.request('/api/admin/reconciliation/'+job.id+'/resolve','POST',{reason:'Provider reviewed'},undefined,'lotus',login.data.token);
  assert.equal(resolution.error.code,'RECONCILIATION_EVIDENCE_UNAVAILABLE');
  assert.ok(f.engine.one('SELECT * FROM booking_operations WHERE booking_key=?',hold.id));
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'VERIFIED');
 }finally{await f.close();}
});

test('local OTP delivery requires explicit development configuration',()=>{
 const lines:string[]=[];
 const delivery=configureOtpDelivery('development','development-console',line=>lines.push(line));
 delivery?.deliver('fixture-hold','123456','+12025550123');
 assert.deepEqual(lines,['[local OTP] hold=fixture-hold code=123456']);
 assert.throws(()=>configureOtpDelivery('production','development-console'),/unsafe/);
 assert.throws(()=>configureOtpDelivery(undefined,'development-console'),/unsafe/);
 assert.equal(configureOtpDelivery('production','disabled'),undefined);
});

test('OTP expires independently of the hold and a verified code cannot be reused',async()=>{
 const f=await fixture();
 try {
  await f.consent();
  const hold=(await f.reserve()).data;
  const input={holdId:hold.id,phone:'+12025550123'};
  await f.request('/api/otp/send','POST',input,f.session);
  f.advance(180001);
  const verify=()=>f.request('/api/otp/verify','POST',{...input,code:f.codes.get(hold.id)},f.session);
  assert.equal((await verify()).error.code,'OTP_INVALID_OR_EXPIRED');
  assert.equal((await f.request('/api/otp/send','POST',input,f.session)).status,200);
  assert.equal((await verify()).data.state,'OTP_VERIFIED');
  assert.equal((await verify()).error.code,'OTP_INVALID_OR_EXPIRED');
 } finally {await f.close();}
});

test('signed webhook retries, failed events and concurrent capture share payment state',async()=>{
 const f=await fixture();
 try {
  const hold=await f.verifiedHold();
  const payment=await f.pay(hold.id);
  const {razorpay_payment_id:id,razorpay_order_id:order}=payment.body;
  const lookup=f.provider.payment.bind(f.provider);
  f.provider.payment=async ()=>({...await lookup(id),id:'failed-attempt',status:'failed'});
  assert.equal((await f.webhook('bad','payment.failed','failed-attempt',order,false)).status,400);
  assert.equal((await f.webhook('failed','payment.failed','failed-attempt',order)).status,200);
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'FAILED');
  f.provider.payment=async id=>({...await lookup(id),currency:'USD'});
  assert.equal((await f.webhook('captured','payment.captured',id,order)).status,400);
  f.provider.payment=async id=>({...await lookup(id),amount:1});
  assert.equal((await payment.verify()).error.code,'PAYMENT_NOT_CAPTURED');
  const entered=signal(),release=signal();
  let calls=0;
  f.provider.payment=async id=>{if(++calls===1){entered.resolve();await release.promise;}return lookup(id);};
  const webhook=f.webhook('captured','payment.captured',id,order);
  await entered.promise;
  try {assert.equal((await payment.verify()).data.state,'PAYMENT_VERIFIED');}
  finally {release.resolve();}
  assert.equal((await webhook).status,200);
  assert.equal((await f.webhook('captured','payment.captured',id,order)).status,200);
  assert.equal((await f.webhook('late-failure','payment.failed','failed-attempt',order)).status,200);
  assert.equal(calls,2);
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'VERIFIED');
  assert.equal(f.engine.all("SELECT id FROM audit WHERE action='PAYMENT_VERIFIED'").length,1);
  assert.equal((await f.engine.confirm('lotus',f.session,hold.id)).state,'CONFIRMED');
 } finally {await f.close();}
});
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
test('reconciliation lease survives restart and fences a delayed worker',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'clinic-worker-'));
 const path=join(directory,'clinic.db');
 try{
  const f=await fixture(path);
  try{
   const hold=await f.verifiedHold();
   const order={id:'fixture-order',amount:hold.fee,currency:'INR',receipt:hold.id};
   f.provider.order=async()=>{throw new Error('Lost order response');};
   await assert.rejects(f.payments.order('lotus',f.session,hold.id));
   const entered=signal(),release=signal();
   let lookups=0;
   const provider:PaymentProvider={...f.provider,findOrder:async()=>{
    if(++lookups===1){entered.resolve();await release.promise;}
    return order;
   }};
   const options={graceMs:0,leaseMs:100,maxAttempts:3};
   const first=new ReconciliationWorker(f.engine,f.payments,provider,options);
   const old=first.runOnce();
   await entered.promise;
   const secondDb=openDb(path);
   try{
    const engine=new Engine(secondDb,f.engine.adapters,undefined,f.engine.now);
    const restart=new ReconciliationWorker(engine,new Payments(engine,provider),provider,options);
    assert.equal(await restart.runOnce(),false);
    f.advance(101);
    assert.equal(await restart.runOnce(),true);
    assert.equal(engine.one('SELECT COUNT(*) count FROM reconciliation_jobs')?.count,1);
    assert.equal(engine.one('SELECT status,attempts FROM reconciliation_jobs')?.attempts,2);
    assert.equal(engine.one('SELECT status FROM reconciliation_jobs')?.status,'DONE');
   }finally{secondDb.close();release.resolve();await old;}
   assert.equal(f.engine.one('SELECT COUNT(*) count FROM payments')?.count,1);
   assert.equal(f.engine.one('SELECT COUNT(*) count FROM payment_order_attempts')?.count,0);
  }finally{await f.close();}
 }finally{rmSync(directory,{recursive:true});}
});

test('worker backs off, escalates and exposes only clinic-scoped job metadata',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  const payment=await f.pay(hold.id);
  const provider:PaymentProvider={...f.provider,findCapturedPayment:async()=>null};
  const worker=new ReconciliationWorker(f.engine,f.payments,provider,{graceMs:0,retryMs:100,maxAttempts:2});
  assert.equal(await worker.runOnce(),true);
  assert.equal(await worker.runOnce(),false);
  f.advance(100);
  assert.equal(await worker.runOnce(),true);
  assert.equal(f.engine.one('SELECT status FROM reconciliation_jobs')?.status,'MANUAL');
  for(const clinic of ['lotus','harbor']){
   const admin=await f.request('/api/admin/login','POST',{email:clinic+'@demo.invalid',password:'test-password-123'});
   const response=await f.request('/api/admin/reconciliation','GET',undefined,undefined,clinic,admin.data.token);
   assert.equal(response.data.length,clinic==='lotus'?1:0);
   if(clinic==='lotus')assert.deepEqual(Object.keys(response.data[0]).sort(),['attempts','bookingReference','id','kind','nextAttemptAt','reason','status'].sort());
  }
  const captureProvider:PaymentProvider={...provider,findCapturedPayment:async()=>payment.body.razorpay_payment_id};
  f.advance(301000);
  // Operator requeues the job after receiving capture evidence.
  f.engine.run("UPDATE reconciliation_jobs SET status='PENDING',attempts=0,next_at=?",f.engine.now());
  const capture=new ReconciliationWorker(f.engine,f.payments,captureProvider,{graceMs:0});
  assert.equal(await capture.runOnce(),true);
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'REFUND_PENDING');
  assert.equal(await capture.runOnce(),true);
  assert.equal(f.engine.one("SELECT status FROM reconciliation_jobs WHERE kind='REFUND'")?.status,'MANUAL');
 }finally{await f.close();}
});

test('provider evidence recovers confirmation, expired replacement and cancellation without replay',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await (await f.pay(hold.id)).verify();
  const adapter=f.engine.adapters('lotus');
  f.engine.adapters=()=>adapter;
  const confirm=adapter.confirmBooking.bind(adapter);
  const move=adapter.rescheduleBooking.bind(adapter);
  const cancel=adapter.cancelBooking.bind(adapter);
  adapter.confirmBooking=async input=>{await confirm(input);throw new Error('Lost confirmation response');};
  adapter.rescheduleBooking=async (...args)=>{await move(...args);throw new Error('Lost move response');};
  adapter.cancelBooking=async id=>{await cancel(id);throw new Error('Lost cancellation response');};
  const worker=new ReconciliationWorker(f.engine,f.payments,f.provider,{graceMs:0});
  await assert.rejects(f.engine.confirm('lotus',f.session,hold.id),{code:'CONFIRMATION_PENDING'});
  assert.equal(await worker.runOnce(),true);
  const appointment=await f.engine.confirm('lotus',f.session,hold.id);
  assert.equal(appointment.state,'CONFIRMED');
  const replacementInput={...f.input,start:'2026-12-04T03:30:00.000Z'};
  const replacement=await f.engine.reserve('lotus',f.session,replacementInput);
  await assert.rejects(f.engine.reschedule('lotus',f.session,appointment.id,replacement.id),{code:'RESCHEDULE_PENDING'});
  f.advance(86400001);
  transaction(f.db,()=>expireHolds(f.db,f.engine.now()));
  assert.equal(f.engine.slots('lotus',f.input.doctorId,f.input.serviceId,'2026-12-04').some(s=>s.start===replacementInput.start),false);
  assert.equal(await worker.runOnce(),true);
  assert.equal(f.engine.booking('lotus',f.session,appointment.id).start,replacementInput.start);
  assert.equal(f.engine.hold('lotus',f.session,replacement.id,false).state,'CONFIRMED');
  await assert.rejects(f.engine.cancel('lotus',f.session,appointment.id),/Lost cancellation response/);
  assert.equal(await worker.runOnce(),true);
  assert.equal((await f.engine.cancel('lotus',f.session,appointment.id)).state,'REFUND_PENDING');
  assert.equal(f.engine.one('SELECT COUNT(*) count FROM booking_operations')?.count,0);
 }finally{await f.close();}
});

test('an inconclusive move remains quarantined after hold expiry and manual escalation',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await (await f.pay(hold.id)).verify();
  const appointment=await f.engine.confirm('lotus',f.session,hold.id);
  const target={...f.input,start:'2026-12-04T03:30:00.000Z'};
  const replacement=await f.engine.reserve('lotus',f.session,target);
  const adapter=f.engine.adapters('lotus');
  adapter.rescheduleBooking=async()=>{throw new Error('Unknown provider outcome');};
  f.engine.adapters=()=>adapter;
  await assert.rejects(f.engine.reschedule('lotus',f.session,appointment.id,replacement.id),{code:'RESCHEDULE_PENDING'});
  f.advance(86400001);
  const worker=new ReconciliationWorker(f.engine,f.payments,f.provider,{graceMs:0,maxAttempts:1});
  assert.equal(await worker.runOnce(),true);
  assert.equal(f.engine.one("SELECT status FROM reconciliation_jobs WHERE kind='RESCHEDULE'")?.status,'MANUAL');
  assert.equal(f.engine.booking('lotus',f.session,appointment.id).start,appointment.start);
  assert.equal(f.engine.one('SELECT replacement_id FROM booking_operations')?.replacement_id,replacement.id);
  await assert.rejects(f.engine.reserve('lotus',f.session,target),{code:'SLOT_UNAVAILABLE'});
 }finally{await f.close();}
});
test('notification outbox is atomic, deduplicated and delivers only redacted development messages',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await f.request('/api/notification-preferences','POST',{enabled:true,language:'kn'},f.session);
  const payment=await f.pay(hold.id);
  f.db.exec("CREATE TRIGGER fixture_notify_rollback BEFORE INSERT ON notification_jobs BEGIN SELECT RAISE(ABORT,'fixture outbox failure'); END;");
  assert.equal((await payment.verify()).status,500);
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'CREATED');
  assert.equal(f.engine.one('SELECT COUNT(*) AS n FROM outbox')?.n,0);
  f.db.exec('DROP TRIGGER fixture_notify_rollback;');
  assert.equal((await payment.verify()).data.state,'PAYMENT_VERIFIED');
  await payment.verify();
  const booking=await f.engine.confirm('lotus',f.session,hold.id);
  await f.engine.confirm('lotus',f.session,hold.id);
  f.engine.briefing('lotus',f.session,booking.id,'Private fictional medical text','private-fixture@example.invalid');
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE event='CONFIRMATION'")?.n,1);
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE event='PAYMENT_CONFIRMED'")?.n,1);
  const sent:string[]=[];
  const consoleProvider=configureNotificationDelivery('development','development-console',line=>sent.push(line))!;
  assert.throws(()=>configureNotificationDelivery('production','development-console'),/requires/);
  const worker=new NotificationWorker(f.db,consoleProvider,{},f.engine.now);
  while(await worker.runOnce()){}
  assert.equal(sent.length,3);
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE status='SIMULATED'")?.n,3);
  for(const excluded of [f.session,'Private fictional medical text','private-fixture@example.invalid','+919999999999',payment.body.razorpay_signature]){
   assert.equal(sent.join('').includes(excluded),false);
  }
  for(const clinic of ['lotus','harbor']){
   const login=await f.request('/api/admin/login','POST',{email:clinic+'@demo.invalid',password:'test-password-123'});
   const list=await f.request('/api/admin/notifications','GET',undefined,undefined,clinic,login.data.token);
   assert.equal(list.data.length,clinic==='lotus'?4:0);
   if(clinic==='lotus')assert.deepEqual(Object.keys(list.data[0]).sort(),['id','event','channel','status','attempts','scheduledAt','nextAttemptAt','reason','bookingReference'].sort());
  }
 }finally{await f.close();}
});

test('reschedule replaces reminders, cancellation and stale or opted-out reminders are suppressed',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await f.request('/api/notification-preferences','POST',{enabled:true},f.session);
  await (await f.pay(hold.id)).verify();
  const a=await f.engine.confirm('lotus',f.session,hold.id);
  const old=f.engine.all("SELECT * FROM notification_jobs WHERE event='REMINDER'");
  assert.equal(old.length,1);
  const target='2026-12-04T03:30:00.000Z';
  const replacement=await f.engine.reserve('lotus',f.session,{...f.input,start:target});
  await f.engine.reschedule('lotus',f.session,a.id,replacement.id);
  const scheduled=f.engine.all("SELECT * FROM notification_jobs WHERE event='REMINDER' AND status='PENDING' ORDER BY scheduled_at");
  assert.deepEqual(scheduled.map(j=>j.scheduled_at),[Date.parse(target)-86400000,Date.parse(target)-3600000]);
  assert.equal(f.engine.one('SELECT status FROM notification_jobs WHERE id=?',old[0].id)?.status,'SUPPRESSED');
  const lines:string[]=[];
  const worker=new NotificationWorker(f.db,configureNotificationDelivery('development','development-console',s=>lines.push(s))!,{},f.engine.now);
  f.engine.run('UPDATE sessions SET expires_at=? WHERE id=?',Date.parse(target)+86400000,f.session);
  f.advance(scheduled[0].scheduled_at-f.engine.now()+900001);
  while(await worker.runOnce()){}
  assert.equal(f.engine.one('SELECT last_error FROM notification_jobs WHERE id=?',scheduled[0].id)?.last_error,'STALE_REMINDER');
  await f.engine.cancel('lotus',f.session,a.id);
  assert.equal((await f.request('/api/notification-preferences','POST',{enabled:false},f.session)).status,200);
  while(await worker.runOnce()){}
  assert.equal(f.engine.one('SELECT status FROM notification_jobs WHERE id=?',scheduled[1].id)?.status,'SUPPRESSED');
  assert.equal(f.engine.one("SELECT last_error FROM notification_jobs WHERE event='CANCELLATION'")?.last_error,'CONSENT_OR_PREFERENCE_MISSING');
  assert.equal(lines.some(s=>s.includes('"kind":"REMINDER"')),false);
 }finally{await f.close();}
});

test('notification lease takeover fences stale workers across database connections',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clinic-notification-'));
 const path=join(dir,'clinic.db');
 try{
  const f=await fixture(path);
  try{
   const hold=await f.verifiedHold();
   await f.request('/api/notification-preferences','POST',{enabled:true},f.session);
   await (await f.pay(hold.id)).verify();
   const started=signal(),release=signal();
   const ids:string[]=[];
   const provider:NotificationProvider={key:'idempotent-fixture',channels:['CONSOLE'],idempotent:true,async deliver(message){
    ids.push(message.id);
    if(ids.length===1){started.resolve();await release.promise;return 'PERMANENT';}
    return 'DELIVERED';
   }};
   const first=new NotificationWorker(f.db,provider,{leaseMs:60000},f.engine.now);
   const pending=first.runOnce();
   await started.promise;
   const reopened=openDb(path);
   try{
    const second=new NotificationWorker(reopened,provider,{leaseMs:60000},f.engine.now);
    assert.equal(await second.runOnce(),false);
    f.advance(60001);
    assert.equal(await second.runOnce(),true);
    assert.equal(ids.length,2);
    assert.equal(ids[0],ids[1]);
   }finally{reopened.close();release.resolve();await pending;}
   assert.equal(f.engine.one('SELECT status FROM notification_jobs')?.status,'DELIVERED');
  }finally{await f.close();}
 }finally{rmSync(dir,{recursive:true});}
});

test('definitive failures retry and exhaust; ambiguous non-idempotent delivery needs manual review',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await f.request('/api/notification-preferences','POST',{enabled:true},f.session);
  await (await f.pay(hold.id)).verify();
  let attempts=0;
  const provider:NotificationProvider={key:'fixture',channels:['CONSOLE'],idempotent:false,async deliver(){attempts++;return 'RETRY';}};
  const worker=new NotificationWorker(f.db,provider,{maxAttempts:2,retryMs:100},f.engine.now);
  assert.equal(await worker.runOnce(),true);
  assert.equal(await worker.runOnce(),false);
  f.advance(100);
  assert.equal(await worker.runOnce(),true);
  assert.equal(attempts,2);
  assert.equal(f.engine.one('SELECT last_error FROM notification_jobs')?.last_error,'RETRY_LIMIT');
  transaction(f.db,()=>{
   f.engine.run("UPDATE payments SET state='REFUNDED' WHERE hold_id=?",hold.id);
   enqueuePaymentNotice(f.db,hold.id,'REFUND_COMPLETED',f.engine.now());
  });
  const ambiguous=new NotificationWorker(f.db,{...provider,async deliver(){throw new Error('private provider payload');}},{},f.engine.now);
  assert.equal(await ambiguous.runOnce(),true);
  assert.equal(await ambiguous.runOnce(),false);
  assert.equal(f.engine.one("SELECT last_error FROM notification_jobs WHERE event='REFUND_COMPLETED'")?.last_error,'AMBIGUOUS_DELIVERY');
 }finally{await f.close();}
});
test('refund eligibility follows cutoff, late capture and clinic ownership',async()=>{
 const f=await fixture();
 try{
  const close=await f.verifiedHold();
  await (await f.pay(close.id)).verify();
  const near=await f.engine.confirm('lotus',f.session,close.id);
  assert.equal((await f.engine.cancel('lotus',f.session,near.id)).state,'CANCELLED');
  assert.equal((await f.request('/api/holds/'+close.id+'/refund','GET',undefined,f.session)).data.status,'NOT_APPLICABLE');
  f.input.start='2026-12-04T03:30:00.000Z';
  const distant=await f.verifiedHold();
  await (await f.pay(distant.id)).verify();
  const future=await f.engine.confirm('lotus',f.session,distant.id);
  const adapter=f.engine.adapters('lotus');
  const cancel=adapter.cancelBooking.bind(adapter);
  adapter.cancelBooking=async()=>{throw new Error('Outcome unknown');};
  f.engine.adapters=()=>adapter;
  await assert.rejects(f.engine.cancel('lotus',f.session,future.id));
  assert.equal(f.engine.one('SELECT COUNT(*) n FROM refund_operations')?.n,0);
  await cancel(future.external_id);
  reconcileOffline(f.db,{kind:'CANCEL',clinicId:'lotus',holdId:distant.id,outcome:'applied'},f.engine.now());
  const pending=f.engine.one("SELECT * FROM refund_operations WHERE reason='ELIGIBLE_CANCELLATION'")!;
  assert.equal(pending.amount,distant.fee);
  assert.equal(pending.approved_at,null);
  assert.throws(()=>approveRefund(f.db,'harbor',pending.id),/not eligible/);
  assert.equal((await f.request('/api/holds/'+distant.id+'/refund','GET',undefined,f.session,'harbor')).status,401);
  const harbor=await f.request('/api/admin/login','POST',{email:'harbor@demo.invalid',password:'test-password-123'});
  assert.deepEqual((await f.request('/api/admin/refunds','GET',undefined,undefined,'harbor',harbor.data.token)).data,[]);
  const late=await f.verifiedHold();
  const capture=await f.pay(late.id);
  f.advance(301000);
  assert.equal((await capture.verify()).data.state,'REFUND_PENDING');
  assert.equal(f.engine.one("SELECT amount FROM refund_operations WHERE reason='EXPIRED_RESERVATION'")?.amount,late.fee);
  assert.equal(await f.refunds.runOnce(),false);
 }finally{await f.close();}
});

test('refund worker recovers a lost submission after lease expiry and completes only with verified provider evidence',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'clinic-refund-'));
 const path=join(folder,'clinic.db');
 try{
  const f=await fixture(path);
  try{
   f.input.start='2026-12-04T03:30:00.000Z';
   const hold=await f.verifiedHold();
   const checkout=await f.pay(hold.id);
   await checkout.verify();
   const a=await f.engine.confirm('lotus',f.session,hold.id);
   await f.engine.cancel('lotus',f.session,a.id);
   const job=f.engine.one('SELECT * FROM refund_operations')!;
   const paymentId=checkout.body.razorpay_payment_id;
   const lookup=f.provider.payment.bind(f.provider);
   let upstream:ProviderRefund|undefined, submissions=0;
   const entered=signal(),release=signal();
   f.provider.payment=async id=>({...await lookup(id),amount_refunded:upstream?.status==='processed'?hold.fee:0});
   f.provider.refunds=async()=>upstream?[upstream]:[];
   f.provider.refund=async()=>{if(!upstream)throw new Error('No refund');return upstream;};
   f.provider.createRefund=async(id,amount,receipt)=>{
    submissions++;
    assert.equal(amount,hold.fee);
    assert.equal(receipt,job.id);
    upstream={id:'fixture-refund',payment_id:id,amount,currency:'INR',status:'pending',receipt};
    entered.resolve();
    await release.promise;
    throw new Error('Lost create response');
   };
   approveRefund(f.db,'lotus',job.id,f.engine.now());
   const initial=new RefundWorker(f.db,f.provider,true,f.engine.now);
   const old=initial.runOnce();
   await entered.promise;
   const restarted=openDb(path);
   try{
    const worker=new RefundWorker(restarted,f.provider,false,f.engine.now);
    assert.equal(await worker.runOnce(),false);
    f.advance(60001);
    assert.equal(await worker.runOnce(),true);
    assert.equal(f.engine.one('SELECT status FROM refund_operations')?.status,'PROCESSING');
    assert.equal(f.engine.one('SELECT state FROM payments')?.state,'REFUND_PENDING');
    assert.ok(upstream);
    upstream.status='processed';
    const webhook=()=>f.webhook('fixture-refund-processed','refund.processed','fixture-refund',paymentId);
    assert.equal((await webhook()).status,200);
    assert.equal((await webhook()).status,200);
    assert.equal((await f.webhook('fixture-refund-older','refund.created','fixture-refund',paymentId)).status,200);
   }finally{restarted.close();release.resolve();await old;}
   assert.equal(submissions,1);
   assert.equal(f.engine.one('SELECT status FROM refund_operations')?.status,'COMPLETED');
   assert.equal(f.engine.one('SELECT state FROM payments')?.state,'REFUNDED');
   assert.equal(f.engine.booking('lotus',f.session,a.id).state,'REFUNDED');
   assert.equal((await f.engine.cancel('lotus',f.session,a.id)).state,'REFUNDED');
   assert.equal(f.engine.one("SELECT COUNT(*) n FROM notification_jobs WHERE event='REFUND_COMPLETED'")?.n,1);
  }finally{await f.close();}
 }finally{rmSync(folder,{recursive:true});}
});

test('refund worker rejects excess, prior refunds and provider failure without retrying submission',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  const checkout=await f.pay(hold.id);
  f.advance(301000);
  await checkout.verify();
  const job=f.engine.one('SELECT * FROM refund_operations')!;
  f.engine.run('UPDATE refund_operations SET amount=amount+1 WHERE id=?',job.id);
  assert.throws(()=>approveRefund(f.db,'lotus',job.id),/not eligible/);
  f.engine.run('UPDATE refund_operations SET amount=? WHERE id=?',hold.fee,job.id);
  const lookup=f.provider.payment.bind(f.provider);
  f.provider.payment=async id=>({...await lookup(id),amount_refunded:0});
  let evidence:ProviderRefund[]=[{id:'unrelated',payment_id:checkout.body.razorpay_payment_id,amount:100,currency:'INR',status:'processed'}];
  let submissions=0;
  f.provider.refunds=async()=>evidence;
  f.provider.refund=async()=>evidence[0];
  f.provider.createRefund=async (id,amount,receipt)=>{
   submissions++;
   evidence=[{id:'failed-refund',payment_id:id,amount,currency:'INR',status:'failed',receipt}];
   return evidence[0];
  };
  approveRefund(f.db,'lotus',job.id,f.engine.now());
  const worker=new RefundWorker(f.db,f.provider,true,f.engine.now);
  assert.equal(await worker.runOnce(),true);
  assert.equal(submissions,0);
  assert.equal(f.engine.one('SELECT status FROM refund_operations')?.status,'MANUAL');
  // A verified operator clears the fixture after establishing no prior refund exists.
  evidence=[];
  f.engine.run("UPDATE refund_operations SET status='PENDING',next_at=? WHERE id=?",f.engine.now(),job.id);
  assert.equal(await worker.runOnce(),true);
  assert.equal(await worker.runOnce(),false);
  assert.equal(submissions,1);
  assert.equal(f.engine.one('SELECT status FROM refund_operations')?.status,'MANUAL');
  assert.equal(f.engine.one('SELECT state FROM payments')?.state,'REFUND_PENDING');
  assert.equal(f.engine.one("SELECT COUNT(*) n FROM notification_jobs WHERE event='REFUND_COMPLETED'")?.n,0);
 }finally{await f.close();}
});
test('authenticated administration supports clinic operations and evidence-only requeue',async()=>{
 const f=await fixture();
 try{
  const auth={email:'lotus@demo.invalid',password:'test-password-123'};
  assert.equal((await f.request('/api/admin/login','POST',{...auth,password:'incorrect'})).status,401);
  const login=await f.request('/api/admin/login','POST',auth);
  const admin=(path:string,method='GET',body?:unknown)=>f.request('/api/admin'+path,method,body,undefined,'lotus',login.data.token);
  for(const path of ['/overview','/summary','/config','/doctors','/services','/blocks','/payments','/refunds','/outbox','/notifications','/audit-logs','/reconciliation']){
   assert.equal((await admin(path)).status,200,path);
  }
  const service=await admin('/services','POST',{name:'Fixture',duration:25,fee:12300});
  assert.equal(service.status,201);
  const doctor=await admin('/doctors','POST',{name:'Fixture Doctor',schedule:{days:[2],start:9,end:16},serviceIds:[service.data.id]});
  assert.equal(doctor.status,201);
  assert.equal((await admin('/doctors/'+doctor.data.id+'/services')).data[0].id,service.data.id);
  const hold=await f.verifiedHold();
  const capture=await f.pay(hold.id);
  const worker=new ReconciliationWorker(f.engine,f.payments,f.provider,{graceMs:0,maxAttempts:1});
  await worker.runOnce();
  const job=(await admin('/reconciliation')).data.find((item:{kind:string})=>item.kind==='CAPTURE');
  assert.equal(job.status,'MANUAL');
  const harbor=await f.request('/api/admin/login','POST',{email:'harbor@demo.invalid',password:'test-password-123'});
  assert.equal((await f.request('/api/admin/reconciliation/'+job.id+'/requeue','POST',{reason:'Fixture'},undefined,'harbor',harbor.data.token)).status,404);
  assert.equal((await admin('/reconciliation/'+job.id+'/requeue','POST',{reason:'Fixture'})).data.status,'PENDING');
  assert.equal(f.engine.one('SELECT state FROM payments WHERE hold_id=?',hold.id)?.state,'CREATED');
  await capture.verify();
  assert.equal((await admin('/summary')).data.finance.verifiedPayments.amount,hold.fee);
 }finally{await f.close();}
});
test('Google adapter fails closed without credentials',async()=>{await assert.rejects(()=>new GoogleAdapter('','').getSlots({doctorId:'x',start:'2026-12-01T00:00:00Z',end:'2026-12-02T00:00:00Z'}),/Google Calendar credentials/);});

const brevoTestConfig = {
 BREVO_API_KEY:'fixture-brevo-key',
 BREVO_SENDER_EMAIL:'sender@example.invalid',
 BREVO_TEST_CLINIC_ID:'lotus',
 BREVO_TEST_RECIPIENT_EMAIL:'recipient@example.invalid',
};
const emailPreference = {enabled:true,channel:'EMAIL',email:'Recipient@example.invalid'};

test('Brevo submission uses a durable quota across workers and restarts, and acceptance is not delivery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clinic-brevo-'));
 const path=join(dir,'clinic.db');
 const f=await fixture(path);
 try{
  const hold=await f.verifiedHold();
  const preference=await f.request('/api/notification-preferences','POST',emailPreference,f.session);
  assert.deepEqual(preference.data,{enabled:true,channel:'EMAIL',language:'en'});
  const payment=await f.pay(hold.id);
  await payment.verify();
  await payment.verify();
  const booking=await f.engine.confirm('lotus',f.session,hold.id);
  await f.engine.confirm('lotus',f.session,hold.id);
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE event IN ('CONFIRMATION','PAYMENT_CONFIRMED')")?.n,2);

  const started=signal(),release=signal(),logs:string[]=[];
  let calls=0;
  const provider=configureBrevo('development',{...brevoTestConfig,BREVO_DAILY_LIMIT:'1'},async(url,init)=>{
   calls++;
   assert.equal(url,'https://api.brevo.com/v3/smtp/email');
   assert.equal(new Headers(init?.headers).get('api-key'),brevoTestConfig.BREVO_API_KEY);
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(body.to,[{email:brevoTestConfig.BREVO_TEST_RECIPIENT_EMAIL}]);
   assert.deepEqual(Object.keys(body).sort(),['sender','subject','textContent','to']);
   assert.equal(body.textContent.includes(f.session),false);
   started.resolve();
   await release.promise;
   return Response.json({messageId:'private-provider-id'},{status:201});
  });
  const pending=new NotificationWorker(f.db,provider,{},f.engine.now,line=>logs.push(line)).runOnce();
  try{
   await Promise.race([started.promise,pending.then(()=>assert.fail('Provider was not called'))]);
   const other=openDb(path);
   try{
    assert.equal(await new NotificationWorker(other,provider,{},f.engine.now).runOnce(),true);
    assert.equal(calls,1);
    assert.equal(other.prepare("SELECT attempts FROM notification_jobs WHERE last_error='EMAIL_DAILY_LIMIT'").get()?.attempts,0);
   }finally{other.close();}
  }finally{release.resolve();await pending;}
  assert.equal(f.engine.booking('lotus',f.session,booking.id).state,'CONFIRMED');

  const reopened=openDb(path);
  try{
   const worker=new NotificationWorker(reopened,provider,{},f.engine.now);
   assert.equal(await worker.runOnce(),false);
   assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM email_submission_budget').get()?.n,1);
   f.advance(86400000);
   while(await worker.runOnce()){}
   assert.equal(calls,2);
   assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM notification_jobs WHERE status='ACCEPTED'").get()?.n,2);
  }finally{reopened.close();}
  const login=await f.request('/api/admin/login','POST',{email:'lotus@demo.invalid',password:'test-password-123'});
  const list=await f.request('/api/admin/notifications','GET',undefined,undefined,'lotus',login.data.token);
  assert.equal(list.data.filter((row:{status:string})=>row.status==='ACCEPTED').length,2);
  assert.equal(list.data.some((row:{status:string})=>row.status==='DELIVERED'),false);
  const exposed=JSON.stringify({logs,list,preference});
  for(const value of [brevoTestConfig.BREVO_API_KEY,brevoTestConfig.BREVO_TEST_RECIPIENT_EMAIL,'private-provider-id',f.session]){
   assert.equal(exposed.includes(value),false);
  }
 }finally{await f.close();rmSync(dir,{recursive:true});}
});

test('Brevo rejects unsafe configuration and classifies failures without replaying uncertain submissions',async(t)=>{
 assert.throws(()=>configureBrevo('production',brevoTestConfig),/Brevo demo requires/);
 assert.throws(()=>configureBrevo('development',{...brevoTestConfig,BREVO_DAILY_LIMIT:'300'}),/Brevo demo requires/);
 const cases=[
  {name:'rejected payload',http:400,reason:'PROVIDER_REJECTED',status:'MANUAL'},
  {name:'invalid key',http:401,reason:'PROVIDER_REJECTED',status:'MANUAL'},
  {name:'rate limited',http:429,reason:'PROVIDER_RETRY',status:'PENDING'},
  {name:'gateway failure',http:502,reason:'AMBIGUOUS_DELIVERY',status:'MANUAL'},
  {name:'unverifiable success',http:201,reason:'AMBIGUOUS_DELIVERY',status:'MANUAL'},
  {name:'timeout',http:0,reason:'AMBIGUOUS_DELIVERY',status:'MANUAL'},
 ];
 for(const item of cases)await t.test(item.name,async()=>{
  const f=await fixture();
  try{
   const hold=await f.verifiedHold();
   await f.request('/api/notification-preferences','POST',emailPreference,f.session);
   await (await f.pay(hold.id)).verify();
   let calls=0;
   const provider=configureBrevo('development',brevoTestConfig,async(_url,init)=>{
    calls++;
    if(item.http)return Response.json({error:'sensitive provider response'},{status:item.http});
    return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('sensitive timeout')), {once:true}));
   });
   const worker=new NotificationWorker(f.db,provider,{retryMs:10,leaseMs:30},f.engine.now);
   assert.equal(await worker.runOnce(),true);
   const job=f.engine.one('SELECT status,last_error FROM notification_jobs');
   assert.equal(job?.status,item.status);
   assert.equal(job?.last_error,item.reason);
   f.advance(10);
   const retries=item.http===429;
   assert.equal(await worker.runOnce(),retries);
   assert.equal(calls,retries?2:1);
   assert.equal(f.engine.one('SELECT COUNT(*) AS n FROM email_submission_budget')?.n,calls);
  }finally{await f.close();}
 });
});

test('Brevo suppresses withdrawn and unapproved email preferences before reserving quota',async()=>{
 const f=await fixture();
 try{
  const hold=await f.verifiedHold();
  await f.request('/api/notification-preferences','POST',emailPreference,f.session);
  await (await f.pay(hold.id)).verify();
  const booking=await f.engine.confirm('lotus',f.session,hold.id);
  await f.request('/api/notification-preferences','POST',{...emailPreference,email:'other@example.invalid'},f.session);
  let calls=0;
  const provider=configureBrevo('development',brevoTestConfig,async()=>{calls++;return Response.json({messageId:'id'},{status:201});});
  const worker=new NotificationWorker(f.db,provider,{},f.engine.now);
  await worker.runOnce();
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE last_error='EMAIL_DESTINATION_NOT_APPROVED'")?.n,1);
  await f.request('/api/notification-preferences','POST',{enabled:false},f.session);
  while(await worker.runOnce()){}
  assert.equal(f.engine.one("SELECT COUNT(*) AS n FROM notification_jobs WHERE last_error='CONSENT_OR_PREFERENCE_MISSING'")?.n,1);
  assert.equal(f.engine.one('SELECT COUNT(*) AS n FROM email_submission_budget')?.n,0);
  assert.equal(calls,0);
  assert.equal(f.engine.booking('lotus',f.session,booking.id).state,'CONFIRMED');
 }finally{await f.close();}
});

test('Brevo migration preserves existing preferences and restricts dispatch to the configured clinic',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clinic-brevo-migration-'));
 const path=join(dir,'clinic.db');
 try{
  const f=await fixture(path);
  try{
   const hold=await f.verifiedHold();
   await f.request('/api/notification-preferences','POST',{enabled:true},f.session);
   await (await f.pay(hold.id)).verify();
   f.db.exec('ALTER TABLE notification_preferences DROP COLUMN email_destination_hash; DROP TABLE email_submission_budget;');
  }finally{await f.close();}

  const migrated=await fixture(path);
  try{
   const prior=migrated.db.prepare("SELECT * FROM notification_preferences WHERE channel='CONSOLE'").get();
   assert.equal(prior?.enabled,1);
   assert.equal(prior?.email_destination_hash,null);
   const optIn=await migrated.request('/api/notification-preferences','POST',emailPreference,String(prior?.session_id));
   assert.equal(optIn.status,200);
   let calls=0;
   const provider=configureBrevo('development',{...brevoTestConfig,BREVO_TEST_CLINIC_ID:'harbor'},async()=>{
    calls++;
    return Response.json({messageId:'id'},{status:201});
   });
   assert.equal(await new NotificationWorker(migrated.db,provider,{},migrated.engine.now).runOnce(),true);
   assert.equal(migrated.engine.one('SELECT last_error FROM notification_jobs')?.last_error,'EMAIL_DESTINATION_NOT_APPROVED');
   assert.equal(calls,0);
  }finally{await migrated.close();}
 }finally{rmSync(dir,{recursive:true});}
});
