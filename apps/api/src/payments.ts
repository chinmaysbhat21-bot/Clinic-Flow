import { randomUUID } from 'node:crypto';
import { Engine,equal,requireThat,signature } from './core.js';
import { transaction } from './db.js';
import { remote } from './adapters.js';
import { enqueuePaymentNotice } from './notification-outbox.js';
import { enqueueRefund } from './refund-records.js';
export type ProviderRefund={id:string;payment_id:string;amount:number;currency:string;status:string;receipt?:string|null};
export interface PaymentProvider {keyId:string;secret:string;assertConfigured?():void;order(amount:number,receipt:string):Promise<{id:string;amount:number;currency:string}>;payment(id:string):Promise<{id:string;order_id:string;amount:number;currency:string;status:string;amount_refunded?:number;captured?:boolean}>;
 findOrder?(receipt:string):Promise<{id:string;amount:number;currency:string;receipt:string}|null>;
 findCapturedPayment?(orderId:string):Promise<string|null>;
 refunds?(paymentId:string):Promise<ProviderRefund[]>;
 refund?(id:string):Promise<ProviderRefund>;
 createRefund?(paymentId:string,amount:number,operationId:string):Promise<ProviderRefund>;
}
export class RazorpayProvider implements PaymentProvider {
 constructor(public keyId:string,public secret:string){}
 assertConfigured(){requireThat(this.keyId.startsWith('rzp_test_')&&this.secret,'RAZORPAY_NOT_CONFIGURED','Razorpay test credentials required',503);}
 private request(path:string,body?:unknown,idempotency?:string){this.assertConfigured();return remote(`https://api.razorpay.com/v1/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString('base64')}`,'Content-Type':'application/json',...(idempotency?{'X-Refund-Idempotency':idempotency}:{})},body:body?JSON.stringify(body):undefined});}
 order(amount:number,receipt:string){return this.request('orders',{amount,currency:'INR',receipt});}
 payment(id:string){return this.request(`payments/${encodeURIComponent(id)}`);}
 async refunds(paymentId:string):Promise<ProviderRefund[]>{
  const list=await this.request(`payments/${encodeURIComponent(paymentId)}/refunds?count=100`);
  requireThat(Array.isArray(list.items)&&list.items.length<100,'PROVIDER_REJECTED','Refund listing could not be verified',502);
  return list.items;
 }
 refund(id:string):Promise<ProviderRefund>{return this.request(`refunds/${encodeURIComponent(id)}`);}
 createRefund(paymentId:string,amount:number,operationId:string):Promise<ProviderRefund>{
  return this.request(`payments/${encodeURIComponent(paymentId)}/refund`,{amount,receipt:operationId,speed:'normal'},operationId);
 }
 async findOrder(receipt:string){
  const list=await this.request('orders?'+new URLSearchParams({receipt,count:'10'}));
  const matches=list.items.filter((item:{receipt:string})=>item.receipt===receipt);
  return matches.length===1?matches[0]:null;
 }
 async findCapturedPayment(orderId:string){
  const list=await this.request(`orders/${encodeURIComponent(orderId)}/payments`);
  const matches=list.items.filter((item:{order_id:string;status:string})=>item.order_id===orderId&&item.status==='captured');
  return matches.length===1?matches[0].id:null;
 }
}
export class Payments {
 constructor(private engine:Engine,private provider:PaymentProvider){}
 async order(clinic:string,session:string,holdId:string){
  const e=this.engine;
  this.provider.assertConfigured?.();
  const claim=transaction(e.db,()=>{
   const hold=e.hold(clinic,session,holdId);
   e.consent(clinic,session);
   requireThat(['OTP_VERIFIED','PAYMENT_PENDING'].includes(hold.state),'OTP_REQUIRED');
   const existing=e.one('SELECT * FROM payments WHERE hold_id=?',holdId);
   if(existing)return {existing,amount:hold.fee};
   requireThat(!e.one('SELECT hold_id FROM payment_order_attempts WHERE hold_id=?',holdId),'ORDER_PENDING',undefined,409);
   e.run('INSERT INTO payment_order_attempts VALUES(?,?,?)',holdId,hold.fee,e.now());
   e.run("UPDATE holds SET state='PAYMENT_PENDING' WHERE id=?",holdId);
   return {amount:hold.fee};
  });
  if(claim.existing)return {keyId:this.provider.keyId,orderId:claim.existing.order_id,amount:claim.existing.amount,currency:'INR'};
  const order=await this.provider.order(claim.amount,holdId);
  requireThat(order.id&&order.amount===claim.amount&&order.currency==='INR','PROVIDER_ORDER_MISMATCH');
  transaction(e.db,()=>{
   const persisted=e.one('SELECT order_id FROM payments WHERE hold_id=?',holdId);
   if(persisted){requireThat(persisted.order_id===order.id,'PROVIDER_ORDER_MISMATCH');return;}
   e.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),clinic,holdId,order.id,null,claim.amount,'INR','CREATED',e.now());
   e.run('DELETE FROM payment_order_attempts WHERE hold_id=?',holdId);
  });
  e.hold(clinic,session,holdId);
  return {keyId:this.provider.keyId,orderId:order.id,amount:claim.amount,currency:'INR'};
 }
 async verify(clinic:string,session:string,input:{holdId:string;razorpay_order_id:string;razorpay_payment_id:string;razorpay_signature:string}){requireThat(equal(signature(this.provider.secret,`${input.razorpay_order_id}|${input.razorpay_payment_id}`),input.razorpay_signature),'INVALID_PAYMENT_SIGNATURE');return this.reconcile(clinic,session,input.holdId,input.razorpay_order_id,input.razorpay_payment_id);}
 async reconcile(clinic:string,session:string,holdId:string,orderId:string,paymentId:string,failedEvent=false,canApply:()=>boolean=()=>true){
  const e=this.engine;
  e.hold(clinic,session,holdId,false);
  const read=()=>e.one('SELECT * FROM payments WHERE hold_id=? AND clinic_id=? AND order_id=?',holdId,clinic,orderId);
  const payment=read();
  requireThat(payment,'PAYMENT_NOT_FOUND');
  if(['VERIFIED','REFUND_PENDING','REFUNDED'].includes(payment.state)){
   requireThat(failedEvent||payment.payment_id===paymentId,'PAYMENT_MISMATCH');
   return {state:payment.state};
  }
  const provider=await this.provider.payment(paymentId);
  requireThat(provider.id===paymentId&&provider.order_id===orderId&&provider.amount===payment.amount&&provider.currency==='INR'&&(provider.status==='captured'||(failedEvent&&provider.status==='failed')),'PAYMENT_NOT_CAPTURED');
  return transaction(e.db,()=>{
   requireThat(canApply(),'RECONCILIATION_LEASE_LOST');
   const current=read();
   requireThat(current,'PAYMENT_NOT_FOUND');
   if(['VERIFIED','REFUND_PENDING','REFUNDED'].includes(current.state)){
    requireThat(failedEvent||current.payment_id===paymentId,'PAYMENT_MISMATCH');
    return {state:current.state};
   }
   const hold=e.hold(clinic,session,holdId,false);
   if(provider.status==='failed'){
    e.run("UPDATE payments SET state='FAILED' WHERE id=? AND state='CREATED'",current.id);
    return {state:'FAILED'};
   }
   const eligible=hold.state==='PAYMENT_PENDING'&&hold.expires_at>e.now();
   e.run('UPDATE payments SET state=?,payment_id=? WHERE id=?',eligible?'VERIFIED':'REFUND_PENDING',paymentId,current.id);
   if(eligible)e.run("UPDATE holds SET state='PAYMENT_VERIFIED' WHERE id=?",holdId);
   if(eligible)enqueuePaymentNotice(e.db,holdId,'PAYMENT_CONFIRMED',e.now());
   else enqueueRefund(e.db,holdId,'EXPIRED_RESERVATION',e.now());
   e.audit(clinic,eligible?'PAYMENT_VERIFIED':'LATE_PAYMENT_RECONCILIATION',current.id);
   return {state:eligible?'PAYMENT_VERIFIED':'REFUND_PENDING'};
  });
 }
}
