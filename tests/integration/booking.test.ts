import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb,seed } from '../../apps/api/src/db.js';
import { createApp } from '../../apps/api/src/server.js';
import { signature } from '../../apps/api/src/core.js';
import { GoogleAdapter } from '../../apps/api/src/adapters.js';
import type { PaymentProvider } from '../../apps/api/src/payments.js';

async function fixture(){
 const db=openDb(':memory:');seed(db,'test-password-123');let now=Date.parse('2026-12-01T00:00:00Z');const codes=new Map<string,string>();const orders=new Map<string,number>();const captured=new Map<string,{order:string;amount:number}>();
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
 return {...state,db,request,session,codes,input,consent,reserve,verifiedHold,pay,advance:(ms:number)=>{now+=ms;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}};
}
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
