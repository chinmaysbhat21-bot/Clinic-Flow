import { randomUUID } from 'node:crypto';
import { Engine,equal,requireThat,signature } from './core.js';
import { remote } from './adapters.js';
export interface PaymentProvider {keyId:string;secret:string;order(amount:number,receipt:string):Promise<{id:string;amount:number;currency:string}>;payment(id:string):Promise<{id:string;order_id:string;amount:number;currency:string;status:string}>}
export class RazorpayProvider implements PaymentProvider {
 constructor(public keyId:string,public secret:string){}
 private request(path:string,body?:unknown){requireThat(this.keyId.startsWith('rzp_test_')&&this.secret,'RAZORPAY_NOT_CONFIGURED','Razorpay test credentials required',503);return remote(`https://api.razorpay.com/v1/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString('base64')}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
 order(amount:number,receipt:string){return this.request('orders',{amount,currency:'INR',receipt});}
 payment(id:string){return this.request(`payments/${encodeURIComponent(id)}`);}
}
export class Payments {
 private orders=new Set<string>();
 constructor(private engine:Engine,private provider:PaymentProvider){}
 async order(clinic:string,session:string,holdId:string){const e=this.engine,h=e.hold(clinic,session,holdId);e.consent(clinic,session);requireThat(h.state==='OTP_VERIFIED'||h.state==='PAYMENT_PENDING','OTP_REQUIRED');let p=e.one('SELECT * FROM payments WHERE hold_id=?',holdId);
 if(!p){requireThat(!this.orders.has(holdId),'ORDER_PENDING',undefined,409);this.orders.add(holdId);try{const order=await this.provider.order(h.fee,holdId);requireThat(order.amount===h.fee&&order.currency==='INR','PROVIDER_ORDER_MISMATCH');e.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),clinic,holdId,order.id,null,h.fee,'INR','CREATED',e.now());p=e.one('SELECT * FROM payments WHERE hold_id=?',holdId)!;}finally{this.orders.delete(holdId);}}
 e.run("UPDATE holds SET state='PAYMENT_PENDING' WHERE id=?",holdId);return {keyId:this.provider.keyId,orderId:p.order_id,amount:p.amount,currency:'INR'};}
 async verify(clinic:string,session:string,input:{holdId:string;razorpay_order_id:string;razorpay_payment_id:string;razorpay_signature:string}){requireThat(equal(signature(this.provider.secret,`${input.razorpay_order_id}|${input.razorpay_payment_id}`),input.razorpay_signature),'INVALID_PAYMENT_SIGNATURE');return this.reconcile(clinic,session,input.holdId,input.razorpay_order_id,input.razorpay_payment_id);}
 async reconcile(clinic:string,session:string,holdId:string,orderId:string,paymentId:string){const e=this.engine,h=e.hold(clinic,session,holdId,false),p=e.one('SELECT * FROM payments WHERE hold_id=? AND clinic_id=? AND order_id=?',holdId,clinic,orderId);requireThat(p,'PAYMENT_NOT_FOUND');if(['VERIFIED','REFUND_PENDING','REFUNDED'].includes(p.state)){requireThat(p.payment_id===paymentId,'PAYMENT_MISMATCH');return {state:p.state};}
 const provider=await this.provider.payment(paymentId);requireThat(provider.id===paymentId&&provider.order_id===p.order_id&&provider.amount===p.amount&&provider.currency==='INR'&&provider.status==='captured','PAYMENT_NOT_CAPTURED');
 const current=e.hold(clinic,session,holdId,false);const expired=current.expires_at<=e.now()||['CANCELLED','EXPIRED'].includes(current.state);e.run('UPDATE payments SET state=?,payment_id=? WHERE id=?',expired?'REFUND_PENDING':'VERIFIED',paymentId,p.id);if(!expired)e.run("UPDATE holds SET state='PAYMENT_VERIFIED' WHERE id=?",holdId);e.audit(clinic,expired?'LATE_PAYMENT_RECONCILIATION':'PAYMENT_VERIFIED',p.id);return {state:expired?'REFUND_PENDING':'PAYMENT_VERIFIED'};
 }
}
