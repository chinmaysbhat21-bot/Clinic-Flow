import { randomUUID } from 'node:crypto';
import { Engine } from './core.js';
import { transaction } from './db.js';
import { Payments, type PaymentProvider } from './payments.js';
import { RefundWorker } from './refund-worker.js';
import { applyProviderEvidence } from './recovery.js';

type Kind = 'WEBHOOK' | 'ORDER' | 'CAPTURE' | 'REFUND' | 'CONFIRM' | 'CANCEL' | 'RESCHEDULE';
type Job = {id:string;clinic_id:string;kind:Kind;operation_ref:string;generation:number;attempts:number;lease_token:string};
type Outcome = 'DONE' | 'RETRY' | 'MANUAL';
export type WorkerOptions = {pollMs:number; leaseMs:number; graceMs:number; maxAttempts:number; retryMs:number};
const defaults: WorkerOptions = {pollMs:5000,leaseMs:60000,graceMs:30000,maxAttempts:12,retryMs:15000};

export class ReconciliationWorker {
 private timer?: ReturnType<typeof setInterval>;
 private active?: Promise<void>;
 private options: WorkerOptions;

 constructor(private engine:Engine, private payments:Payments, private provider:PaymentProvider,
  options:Partial<WorkerOptions>={}, private log:(message:string)=>void=()=>{},
  private refunds=new RefundWorker(engine.db,provider,false,engine.now)) {
  this.options={...defaults,...options};
 }

 start(){
  if(this.timer)return;
  const tick=()=>{
   if(this.active)return;
   this.active=this.runOnce().then(()=>{},()=>this.log('reconciliation_tick_failed')).finally(()=>{this.active=undefined;});
  };
  this.timer=setInterval(tick,this.options.pollMs);
  tick();
 }

 async stop(){
  clearInterval(this.timer);
  this.timer=undefined;
  await this.active;
 }

 private claim():Job|undefined {
  const e=this.engine, now=e.now(), {graceMs,maxAttempts,leaseMs}=this.options;
  return transaction(e.db,()=>{
   // Discover jobs from the existing durable sources, including records left by older API versions.
   e.run(`INSERT OR IGNORE INTO reconciliation_jobs(id,clinic_id,kind,operation_ref,generation,next_at)
    SELECT lower(hex(randomblob(16))),clinic_id,kind,ref,generation,?
    FROM (
     SELECT h.clinic_id,'ORDER' AS kind,a.hold_id AS ref,a.started_at AS generation FROM payment_order_attempts a JOIN holds h ON h.id=a.hold_id
     UNION ALL SELECT clinic_id,'CAPTURE',hold_id,created_at FROM payments WHERE state IN ('CREATED','FAILED')
     UNION ALL SELECT clinic_id,'REFUND',hold_id,created_at FROM payments WHERE state='REFUND_PENDING'
     UNION ALL SELECT h.clinic_id,o.kind,o.booking_key,o.started_at FROM booking_operations o JOIN holds h ON h.id=o.booking_key
    ) WHERE generation<=?`,now,now-graceMs);
   e.run(`UPDATE reconciliation_jobs SET status='MANUAL',last_error='RETRY_LIMIT',lease_token=NULL,lease_until=NULL
    WHERE attempts>=? AND (status='PENDING' OR (status='RUNNING' AND lease_until<=?))`,maxAttempts,now);
   return e.one(`UPDATE reconciliation_jobs SET status='RUNNING',attempts=attempts+1,lease_token=?,lease_until=?
    WHERE id=(SELECT id FROM reconciliation_jobs WHERE next_at<=? AND
     (status='PENDING' OR (status='RUNNING' AND lease_until<=?)) ORDER BY next_at,id LIMIT 1)
    RETURNING *`,randomUUID(),now+leaseMs,now,now) as Job|undefined;
  });
 }

 private owns(job:Job){
  return !!this.engine.one("SELECT id FROM reconciliation_jobs WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>?",job.id,job.lease_token,this.engine.now());
 }

 async runOnce():Promise<boolean>{
  const job=this.claim();
  if(!job)return false;
  let outcome:Outcome, reason:string|null=null;
  try { outcome=await this.process(job); }
  catch { outcome='RETRY'; reason='PROVIDER_OR_STATE_UNAVAILABLE'; }
  if(outcome==='RETRY'&&job.attempts>=this.options.maxAttempts){outcome='MANUAL';reason='RETRY_LIMIT';}
  if(outcome==='MANUAL')reason??='OPERATOR_REVIEW_REQUIRED';
  if(outcome==='RETRY')reason??='EVIDENCE_PENDING';
  const delay=Math.min(3600000,this.options.retryMs*2**Math.min(job.attempts-1,16));
  const e=this.engine;
  const updated=transaction(e.db,()=>{
   const changed=e.run(`UPDATE reconciliation_jobs SET status=?,next_at=?,last_error=?,lease_until=NULL,lease_token=NULL
   WHERE id=? AND lease_token=? AND lease_until>?`,outcome==='RETRY'?'PENDING':outcome,e.now()+delay,reason,job.id,job.lease_token,e.now());
   if(changed.changes&&job.kind==='WEBHOOK'&&outcome==='DONE'){
    e.run('UPDATE payment_webhook_events SET processed_at=? WHERE id=? AND processed_at IS NULL',e.now(),job.operation_ref);
   }
   return changed;
  });
  if(updated.changes)this.log(JSON.stringify({event:'reconciliation_attempt',jobId:job.id,kind:job.kind,outcome,attempt:job.attempts}));
  return true;
 }

 private async process(job:Job):Promise<Outcome>{
  const e=this.engine, ref=job.operation_ref;
  if(job.kind==='WEBHOOK'){
   const receipt=e.one('SELECT * FROM payment_webhook_events WHERE id=?',ref);
   if(!receipt?.event_type||!receipt.payment_id)return 'MANUAL';
   if(receipt.processed_at!==null)return 'DONE';
   if(receipt.refund_id){
    const payment=e.one('SELECT id FROM payments WHERE payment_id=? AND clinic_id=?',receipt.payment_id,job.clinic_id);
    if(!payment)return 'MANUAL';
    return this.refunds.webhook(receipt.payment_id,receipt.refund_id,()=>this.owns(job));
   }
   const payment=e.one(`SELECT p.hold_id,h.session_id FROM payments p
    JOIN holds h ON h.id=p.hold_id AND h.clinic_id=p.clinic_id
    WHERE p.order_id=? AND p.clinic_id=?`,receipt.order_id,job.clinic_id);
   if(!payment)return 'MANUAL';
   await this.payments.reconcile(job.clinic_id,payment.session_id,payment.hold_id,receipt.order_id,
    receipt.payment_id,receipt.event_type==='payment.failed',()=>this.owns(job));
   return 'DONE';
  }
  const hold=e.one('SELECT * FROM holds WHERE id=? AND clinic_id=?',ref,job.clinic_id);
  if(!hold)return 'DONE';
  if(job.kind==='ORDER'){
   const attempt=e.one('SELECT * FROM payment_order_attempts WHERE hold_id=? AND started_at=?',ref,job.generation);
   if(!attempt)return 'DONE';
   if(!this.provider.findOrder)return 'MANUAL';
   const order=await this.provider.findOrder(ref);
   if(!order)return 'RETRY';
   if(!order.id||order.receipt!==ref||order.amount!==attempt.amount||order.currency!=='INR')return 'MANUAL';
   return transaction(e.db,()=>{
    if(!this.owns(job))return 'RETRY';
    if(e.one('SELECT hold_id FROM payment_order_attempts WHERE hold_id=? AND started_at=?',ref,job.generation)){
     applyProviderEvidence(e.db,{kind:'ORDER',clinicId:job.clinic_id,holdId:ref,orderId:order.id,amount:order.amount,currency:'INR',receipt:order.receipt},e.now());
    }
    return 'DONE';
   });
  }
  if(job.kind==='CAPTURE'||job.kind==='REFUND'){
   const payment=e.one('SELECT * FROM payments WHERE clinic_id=? AND hold_id=?',job.clinic_id,ref);
   if(!payment)return 'DONE';
   if(job.kind==='REFUND')return payment.state==='REFUND_PENDING'?'MANUAL':'DONE';
   if(!['CREATED','FAILED'].includes(payment.state))return 'DONE';
   if(!this.provider.findCapturedPayment)return 'MANUAL';
   const id=await this.provider.findCapturedPayment(payment.order_id);
   if(!id)return 'RETRY';
   await this.payments.reconcile(job.clinic_id,hold.session_id,ref,payment.order_id,id,false,()=>this.owns(job));
   return 'DONE';
  }
  const kind=job.kind;
  const operation=e.one('SELECT * FROM booking_operations WHERE booking_key=? AND kind=? AND started_at=?',ref,kind,job.generation);
  if(!operation)return 'DONE';
  const appointment=e.one('SELECT * FROM appointments WHERE hold_id=? AND clinic_id=?',ref,job.clinic_id);
  const replacement=kind==='RESCHEDULE'?e.one('SELECT * FROM holds WHERE id=? AND clinic_id=? AND session_id=?',operation.replacement_id,job.clinic_id,hold.session_id):null;
  if(!appointment||(kind==='RESCHEDULE'&&!replacement))return 'MANUAL';
  const adapter=e.adapters(job.clinic_id);
  if(!adapter.lookupBooking)return 'MANUAL';
  // Only positive evidence can complete an operation. A missing or unchanged record may mean the write is still in flight.
  const externalId=kind==='CONFIRM'?(adapter.confirmationLookupId?.(ref)??ref):appointment.external_id;
  if(!externalId)return 'MANUAL';
  const remote=await adapter.lookupBooking(externalId);
  if(!remote)return 'RETRY';
  const expected=replacement??appointment;
  if(remote.id!==externalId||(kind!=='CANCEL'&&remote.doctorId!==expected.doctor_id))return 'MANUAL';
  const applied=kind==='CANCEL'?remote.state==='CANCELLED':
   remote.state==='CONFIRMED'&&remote.start===expected.start&&remote.end===expected.end;
  if(!applied)return 'RETRY';
  return transaction(e.db,()=>{
   if(!this.owns(job))return 'RETRY';
   const current=e.one('SELECT * FROM booking_operations WHERE booking_key=? AND kind=? AND started_at=?',ref,kind,job.generation);
   if(!current||current.replacement_id!==operation.replacement_id)return 'DONE';
   applyProviderEvidence(e.db,{kind,clinicId:job.clinic_id,holdId:ref,outcome:'applied',externalId},e.now());
   return 'DONE';
  });
 }
}
