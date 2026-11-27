import { randomUUID } from 'node:crypto';
import { type DB,transaction } from './db.js';
import { type PaymentProvider,type ProviderRefund } from './payments.js';
import { enqueuePaymentNotice } from './notification-outbox.js';

const selectOperation=`SELECT r.*,p.hold_id,p.order_id,p.payment_id,p.amount AS captured_amount,
 p.currency AS payment_currency,p.state AS payment_state,a.state AS appointment_state
 FROM refund_operations r JOIN payments p ON p.id=r.payment_ref AND p.clinic_id=r.clinic_id
 LEFT JOIN appointments a ON a.id=r.appointment_id AND a.hold_id=p.hold_id AND a.clinic_id=r.clinic_id`;
type Operation={id:string;clinic_id:string;appointment_id:string|null;appointment_state:string|null;status:string;amount:number;currency:string;
 payment_id:string;payment_currency:string;payment_state:string;captured_amount:number;order_id:string;hold_id:string;
 provider_refund_id:string|null;submitted_at:number|null;approved_at:number|null;lease_token:string|null;attempts:number};
type ProviderPayment=Awaited<ReturnType<PaymentProvider['payment']>>;
type Result='DONE'|'RETRY'|'MANUAL';

function safe(db:DB,row:Operation){
 return row.payment_state==='REFUND_PENDING'&&row.payment_id&&row.amount===row.captured_amount&&
  row.currency==='INR'&&row.payment_currency==='INR'&&Number.isSafeInteger(row.amount)&&row.amount>=100&&
  (!row.appointment_id||row.appointment_state==='REFUND_PENDING')&&
  !db.prepare('SELECT booking_key FROM booking_operations WHERE booking_key=?').get(row.hold_id);
}

/** Offline authorization for one operation. There is deliberately no public submission endpoint. */
export function approveRefund(db:DB,clinicId:string,id:string,now=Date.now()){
 return transaction(db,()=>{
  const row=db.prepare(selectOperation+" WHERE r.id=? AND r.clinic_id=?").get(id,clinicId) as Operation|undefined;
  if(!row||row.status!=='PENDING'||row.submitted_at!==null||!safe(db,row))throw new Error('Refund operation is not eligible for approval');
  db.prepare('UPDATE refund_operations SET approved_at=COALESCE(approved_at,?),next_at=? WHERE id=?').run(now,now,id);
 });
}

export class RefundWorker {
 private timer?:ReturnType<typeof setInterval>;
 private active?:Promise<boolean>;
 constructor(private db:DB,private provider:PaymentProvider,private execute:boolean,
  private now=()=>Date.now(),private leaseMs=60000,private maxAttempts=12){}

 start(pollMs=5000){
  if(this.timer)return;
  const tick=()=>{
   if(!this.active)this.active=this.runOnce().catch(()=>{
    console.error('{"event":"refund_worker_tick_failed"}');return false;
   }).finally(()=>{this.active=undefined;});
  };
  this.timer=setInterval(tick,pollMs);
  tick();
 }
 async stop(){clearInterval(this.timer);this.timer=undefined;await this.active;}

 private row(id:string){return this.db.prepare(selectOperation+' WHERE r.id=?').get(id) as Operation|undefined;}
 private owns(job:Operation){
  return !!this.db.prepare("SELECT id FROM refund_operations WHERE id=? AND lease_token=? AND lease_until>? AND status='PROCESSING'")
   .get(job.id,job.lease_token,this.now());
 }
 private claim(){
  const db=this.db,now=this.now();
  return transaction(db,()=>{
   const exhausted=db.prepare(`UPDATE refund_operations SET status='MANUAL',last_error='RETRY_LIMIT',lease_token=NULL,lease_until=NULL
    WHERE status='PROCESSING' AND COALESCE(lease_until,0)<=? AND attempts>=? RETURNING id`).all(now,this.maxAttempts);
   for(const item of exhausted){
    const row=this.row(String(item.id));
    if(row)enqueuePaymentNotice(db,row.hold_id,'REFUND_REVIEW',now);
   }
   const claim=db.prepare(`UPDATE refund_operations SET attempts=attempts+1,status='PROCESSING',lease_until=?,lease_token=?
    WHERE id=(SELECT id FROM refund_operations WHERE next_at<=? AND COALESCE(lease_until,0)<=? AND attempts<?
     AND ((status='PENDING' AND approved_at IS NOT NULL AND ?=1) OR (status='PROCESSING' AND (submitted_at IS NOT NULL OR ?=1)))
     ORDER BY next_at,id LIMIT 1) RETURNING id`).get(now+this.leaseMs,randomUUID(),now,now,this.maxAttempts,Number(this.execute),Number(this.execute));
   return claim?this.row(String(claim.id)):undefined;
  });
 }
 private paymentMatches(row:Operation,payment:ProviderPayment){
  return payment.id===row.payment_id&&payment.order_id===row.order_id&&payment.amount===row.captured_amount&&payment.currency===row.currency&&
   (payment.status==='captured'||(payment.status==='refunded'&&payment.captured===true));
 }
 private refundMatches(row:Operation,refund:ProviderRefund){
  return refund.id&&refund.payment_id===row.payment_id&&refund.amount===row.amount&&refund.currency===row.currency&&
   (row.provider_refund_id?refund.id===row.provider_refund_id:refund.receipt===row.id);
 }
 private apply(row:Operation,refund:ProviderRefund,payment:ProviderPayment,guard?:()=>boolean):Result{
  return transaction(this.db,()=>{
   const current=this.row(row.id);
   if(!current||current.status==='COMPLETED')return 'DONE';
   if(guard&&!guard())return 'RETRY';
   if(!safe(this.db,current)||current.submitted_at===null||!this.paymentMatches(current,payment)||!this.refundMatches(current,refund))return 'MANUAL';
   if(refund.status==='failed')return 'MANUAL';
   if(!['pending','processed'].includes(refund.status))return 'MANUAL';
   this.db.prepare('UPDATE refund_operations SET provider_refund_id=? WHERE id=?').run(refund.id,current.id);
   if(refund.status==='pending'||payment.amount_refunded!==current.amount)return 'RETRY';
   this.db.prepare("UPDATE payments SET state='REFUNDED' WHERE id=(SELECT payment_ref FROM refund_operations WHERE id=?) AND state='REFUND_PENDING'").run(current.id);
   if(current.appointment_id)this.db.prepare("UPDATE appointments SET state='REFUNDED' WHERE id=? AND clinic_id=? AND state='REFUND_PENDING'").run(current.appointment_id,current.clinic_id);
   this.db.prepare("UPDATE refund_operations SET status='COMPLETED',completed_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?").run(this.now(),current.id);
   enqueuePaymentNotice(this.db,current.hold_id,'REFUND_COMPLETED',this.now());
   this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),current.clinic_id,'REFUND_COMPLETED',current.id,this.now());
   return 'DONE';
  });
 }

 private async process(row:Operation):Promise<Result>{
  if(!safe(this.db,row)||!this.provider.refunds||!this.provider.refund)return 'MANUAL';
  if(row.provider_refund_id){
   const refund=await this.provider.refund(row.provider_refund_id);
   const payment=await this.provider.payment(row.payment_id);
   return this.apply(row,refund,payment,()=>this.owns(row));
  }
  const refunds=await this.provider.refunds(row.payment_id);
  const matches=refunds.filter(refund=>refund.receipt===row.id);
  if(matches.length===1&&refunds.length===1&&row.submitted_at!==null){
   const refund=await this.provider.refund(matches[0].id);
   const payment=await this.provider.payment(row.payment_id);
   return this.apply(row,refund,payment,()=>this.owns(row));
  }
  if(refunds.length)return 'MANUAL';
  // A missing response is never retried as a write. Future attempts only read provider evidence.
  if(row.submitted_at!==null)return 'RETRY';
  if(!this.execute||row.approved_at===null||!this.provider.createRefund)return 'MANUAL';
  const payment=await this.provider.payment(row.payment_id);
  if(!this.paymentMatches(row,payment)||payment.status!=='captured'||payment.amount_refunded!==0)return 'MANUAL';
  const submitted=transaction(this.db,()=>{
   const current=this.row(row.id);
   if(!current||!this.owns(row)||!safe(this.db,current)||current.submitted_at!==null||current.approved_at===null)return false;
   return !!this.db.prepare('UPDATE refund_operations SET submitted_at=? WHERE id=? AND submitted_at IS NULL').run(this.now(),row.id).changes;
  });
  if(!submitted)return 'RETRY';
  const response=await this.provider.createRefund(row.payment_id,row.amount,row.id);
  if(!this.refundMatches(row,response))return 'MANUAL';
  const refund=await this.provider.refund(response.id);
  const captured=await this.provider.payment(row.payment_id);
  return this.apply(row,refund,captured,()=>this.owns(row));
 }

 async runOnce(){
  const row=this.claim();
  if(!row)return false;
  let outcome:Result;
  try{outcome=await this.process(row);}catch{outcome='RETRY';}
  const retry=outcome==='RETRY'&&row.attempts<this.maxAttempts;
  const delay=Math.min(3600000,15000*2**Math.min(row.attempts-1,12));
  if(outcome!=='DONE')transaction(this.db,()=>{
   const change=this.db.prepare(`UPDATE refund_operations SET status=?,next_at=?,last_error=?,lease_token=NULL,lease_until=NULL
    WHERE id=? AND lease_token=? AND lease_until>?`).run(retry?'PROCESSING':'MANUAL',this.now()+delay,
    retry?'EVIDENCE_PENDING':outcome==='MANUAL'?'PROVIDER_OR_ELIGIBILITY_REVIEW':'RETRY_LIMIT',row.id,row.lease_token,this.now());
   if(change.changes&&!retry)enqueuePaymentNotice(this.db,row.hold_id,'REFUND_REVIEW',this.now());
  });
  return true;
 }

 async webhook(paymentId:string,refundId:string){
  const row=this.db.prepare(selectOperation+" WHERE p.payment_id=? AND r.submitted_at IS NOT NULL").get(paymentId) as Operation|undefined;
  if(!row||row.status==='COMPLETED'||!this.provider.refund)return;
  const refund=await this.provider.refund(refundId);
  if(refund.id!==refundId||!this.refundMatches(row,refund))return;
  const payment=await this.provider.payment(paymentId);
  const result=this.apply(row,refund,payment);
  if(result==='MANUAL')transaction(this.db,()=>{
   const change=this.db.prepare(`UPDATE refund_operations SET status='MANUAL',last_error='PROVIDER_OR_ELIGIBILITY_REVIEW',
    lease_token=NULL,lease_until=NULL WHERE id=? AND status<>'COMPLETED'`).run(row.id);
   if(change.changes)enqueuePaymentNotice(this.db,row.hold_id,'REFUND_REVIEW',this.now());
  });
 }
}
