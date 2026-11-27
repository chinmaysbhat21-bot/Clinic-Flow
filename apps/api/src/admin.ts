import { clinicDate,clinicHour,clinicTime } from './clinic-time.js';
import { Engine,Fault,requireThat } from './core.js';
import { transaction } from './db.js';
import { Payments,type PaymentProvider } from './payments.js';
import { applyProviderEvidence } from './recovery.js';
import type { RefundWorker } from './refund-worker.js';

export type AdminWarning={bookingId:string;reference:string;start:string;end:string;reason:string};
type BreakRule={start:string;end:string;days?:number[]};
type HolidayRule={date:string;reason?:string};

export function isValidTimeZone(timezone:string):boolean{
 try{new Intl.DateTimeFormat(undefined,{timeZone:timezone});return true;}catch{return false;}
}

export class LoginLimiter {
 private attempts=new Map<string,{count:number;reset:number}>();
 constructor(private maxAttempts=10,private windowMs=900000){}
 check(key:string,now:number){
  if(this.attempts.size>10000)for(const [k,v] of this.attempts)if(v.reset<=now)this.attempts.delete(k);
  const current=this.attempts.get(key);
  if(current&&current.reset>now&&current.count>=this.maxAttempts)throw new Fault('RATE_LIMIT','Too many login attempts; try again later',429);
 }
 fail(key:string,now:number){
  const current=this.attempts.get(key);
  if(!current||current.reset<=now)this.attempts.set(key,{count:1,reset:now+this.windowMs});
  else current.count++;
 }
 clear(key:string){this.attempts.delete(key);}
}

function appointmentOutsideSchedule(startIso:string,endIso:string,timezone:string,
 operatingHours:{start:number;end:number},schedule:{days:number[];start:number;end:number},
 breaks:BreakRule[],holidays:HolidayRule[]):string|null{
 const startMs=Date.parse(startIso),endMs=Date.parse(endIso);
 const date=clinicDate(startMs,timezone);
 if(holidays.some(h=>h.date===date))return 'HOLIDAY_CONFLICT';
 const day=new Date(`${date}T00:00:00Z`).getUTCDay();
 if(!schedule.days.includes(day))return 'DAY_UNAVAILABLE';
 const openHour=Math.max(operatingHours.start,schedule.start),closeHour=Math.min(operatingHours.end,schedule.end);
 const openMs=clinicHour(date,openHour,timezone),closeMs=clinicHour(date,closeHour,timezone);
 if(openMs===undefined||closeMs===undefined||startMs<openMs||endMs>closeMs)return 'OUTSIDE_HOURS';
 for(const b of breaks){
  if(Array.isArray(b.days)&&!b.days.includes(day))continue;
  const bStart=clinicTime(date,b.start,timezone),bEnd=clinicTime(date,b.end,timezone);
  if(bStart!==undefined&&bEnd!==undefined&&bStart<endMs&&bEnd>startMs)return 'BREAK_CONFLICT';
 }
 return null;
}

export function findConfigWarnings(engine:Engine,clinicId:string):AdminWarning[]{
 const c=engine.clinic(clinicId),now=engine.now();
 const doctors=new Map(engine.all('SELECT id,schedule FROM doctors WHERE clinic_id=?',clinicId).map(d=>[String(d.id),JSON.parse(String(d.schedule))]));
 const clinicBreaks:BreakRule[]=Array.isArray(c.config.breaks)?c.config.breaks:[];
 const holidays:HolidayRule[]=Array.isArray(c.config.holidays)?c.config.holidays:[];
 const rows=engine.all("SELECT id,reference,doctor_id,start,end FROM appointments WHERE clinic_id=? AND state IN ('CONFIRMED','CONFIRMATION_PENDING')",clinicId);
 const warnings:AdminWarning[]=[];
 for(const a of rows){
  if(Date.parse(String(a.end))<=now)continue;
  const schedule=doctors.get(String(a.doctor_id));
  if(!schedule)continue;
  const docBreaks:BreakRule[]=Array.isArray(schedule.breaks)?schedule.breaks:[];
  const reason=appointmentOutsideSchedule(String(a.start),String(a.end),c.config.timezone,c.config.operatingHours,schedule,[...clinicBreaks,...docBreaks],holidays);
  if(reason)warnings.push({bookingId:String(a.id),reference:String(a.reference),start:String(a.start),end:String(a.end),reason});
 }
 return warnings;
}

export function findDoctorScheduleWarnings(engine:Engine,clinicId:string,doctorId:string,schedule:{days:number[];start:number;end:number;breaks?:BreakRule[]}):AdminWarning[]{
 const c=engine.clinic(clinicId),now=engine.now();
 const clinicBreaks:BreakRule[]=Array.isArray(c.config.breaks)?c.config.breaks:[];
 const docBreaks:BreakRule[]=Array.isArray(schedule.breaks)?schedule.breaks:[];
 const holidays:HolidayRule[]=Array.isArray(c.config.holidays)?c.config.holidays:[];
 const rows=engine.all("SELECT id,reference,start,end FROM appointments WHERE clinic_id=? AND doctor_id=? AND state IN ('CONFIRMED','CONFIRMATION_PENDING')",clinicId,doctorId);
 const warnings:AdminWarning[]=[];
 for(const a of rows){
  if(Date.parse(String(a.end))<=now)continue;
  const reason=appointmentOutsideSchedule(String(a.start),String(a.end),c.config.timezone,c.config.operatingHours,schedule,[...clinicBreaks,...docBreaks],holidays);
  if(reason)warnings.push({bookingId:String(a.id),reference:String(a.reference),start:String(a.start),end:String(a.end),reason});
 }
 return warnings;
}

export function findDeactivationWarnings(engine:Engine,clinicId:string,column:'doctor_id'|'service_id',entityId:string,reason:string):AdminWarning[]{
 const now=engine.now();
 return engine.all(`SELECT id,reference,start,end FROM appointments WHERE clinic_id=? AND ${column}=? AND state IN ('CONFIRMED','CONFIRMATION_PENDING')`,clinicId,entityId)
  .filter(a=>Date.parse(String(a.end))>now)
  .map(a=>({bookingId:String(a.id),reference:String(a.reference),start:String(a.start),end:String(a.end),reason}));
}

export function findBlockWarnings(engine:Engine,clinicId:string,doctorId:string|undefined,start:string,end:string):AdminWarning[]{
 const now=engine.now();
 return engine.all("SELECT id,reference,start,end FROM appointments WHERE clinic_id=? AND (? IS NULL OR doctor_id=?) AND state IN ('CONFIRMED','CONFIRMATION_PENDING') AND start<? AND end>?",clinicId,doctorId??null,doctorId??null,end,start)
  .filter(a=>Date.parse(String(a.end))>now)
  .map(a=>({bookingId:String(a.id),reference:String(a.reference),start:String(a.start),end:String(a.end),reason:'BLOCK_CONFLICT'}));
}

export function buildAdminSummary(engine:Engine,clinicId:string){
 const c=engine.clinic(clinicId),now=engine.now();
 const timezone=String(c.config.timezone);
 const todayDate=clinicDate(now,timezone);
 const appts=engine.all('SELECT start,state FROM appointments WHERE clinic_id=?',clinicId);
 const today={date:todayDate,total:0,confirmed:0,pending:0,cancelled:0,refundPending:0,refunded:0};
 const upcoming={confirmed:0,pending:0};
 const totals={confirmed:0,pending:0,cancelled:0,refundPending:0,refunded:0};
 for(const a of appts){
  const state=String(a.state),startMs=Date.parse(String(a.start));
  const isToday=clinicDate(startMs,timezone)===todayDate;
  if(isToday)today.total++;
  if(state==='CONFIRMED'){totals.confirmed++;if(isToday)today.confirmed++;if(startMs>=now)upcoming.confirmed++;}
  else if(state==='CONFIRMATION_PENDING'){totals.pending++;if(isToday)today.pending++;if(startMs>=now)upcoming.pending++;}
  else if(state==='CANCELLED'){totals.cancelled++;if(isToday)today.cancelled++;}
  else if(state==='REFUND_PENDING'){totals.refundPending++;if(isToday)today.refundPending++;}
  else if(state==='REFUNDED'){totals.refunded++;if(isToday)today.refunded++;}
 }
 const reconciliationRow=engine.one(`
  SELECT
   SUM(CASE WHEN j.status IN ('PENDING','RUNNING') THEN 1 ELSE 0 END) AS pending,
   SUM(CASE WHEN j.status='MANUAL' THEN 1 ELSE 0 END) AS manual,
   COUNT(*) AS total
  FROM reconciliation_jobs j
  WHERE j.clinic_id=? AND j.status<>'DONE' AND (
   (j.kind='ORDER' AND EXISTS (SELECT 1 FROM payment_order_attempts t WHERE t.hold_id=j.operation_ref AND t.started_at=j.generation))
   OR (j.kind='CAPTURE' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state IN ('CREATED','FAILED')))
   OR (j.kind='REFUND' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state='REFUND_PENDING'))
   OR EXISTS (SELECT 1 FROM booking_operations o WHERE o.booking_key=j.operation_ref AND o.kind=j.kind AND o.started_at=j.generation)
  )`,clinicId);
 const notifRow=engine.one(`
  SELECT
   SUM(CASE WHEN j.status IN ('PENDING','RUNNING') THEN 1 ELSE 0 END) AS pending,
   SUM(CASE WHEN j.status='SIMULATED' THEN 1 ELSE 0 END) AS simulated,
   SUM(CASE WHEN j.status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
   SUM(CASE WHEN j.status='SUPPRESSED' THEN 1 ELSE 0 END) AS suppressed,
   SUM(CASE WHEN j.status='MANUAL' THEN 1 ELSE 0 END) AS failedManual
  FROM notification_jobs j JOIN outbox o ON o.id=j.id WHERE o.clinic_id=?`,clinicId);
 const payRow=engine.one(`
  SELECT
   SUM(CASE WHEN state='VERIFIED' THEN 1 ELSE 0 END) AS verifiedCount,
   COALESCE(SUM(CASE WHEN state='VERIFIED' THEN amount ELSE 0 END),0) AS verifiedAmount,
   SUM(CASE WHEN state='REFUND_PENDING' THEN 1 ELSE 0 END) AS pendingRefundCount,
   COALESCE(SUM(CASE WHEN state='REFUND_PENDING' THEN amount ELSE 0 END),0) AS pendingRefundAmount,
   SUM(CASE WHEN state='REFUNDED' THEN 1 ELSE 0 END) AS refundedCount,
   COALESCE(SUM(CASE WHEN state='REFUNDED' THEN amount ELSE 0 END),0) AS refundedAmount,
   SUM(CASE WHEN state='CREATED' THEN 1 ELSE 0 END) AS createdCount,
   SUM(CASE WHEN state='FAILED' THEN 1 ELSE 0 END) AS failedCount
  FROM payments WHERE clinic_id=?`,clinicId);
 const refundOpRow=engine.one(`
  SELECT
   SUM(CASE WHEN status IN ('PENDING','PROCESSING','MANUAL') THEN 1 ELSE 0 END) AS pendingCount,
   COALESCE(SUM(CASE WHEN status IN ('PENDING','PROCESSING','MANUAL') THEN amount ELSE 0 END),0) AS pendingAmount,
   SUM(CASE WHEN status='MANUAL' THEN 1 ELSE 0 END) AS manualCount
  FROM refund_operations WHERE clinic_id=?`,clinicId);
 return {
  today,
  upcoming,
  totals,
  reconciliation:{
   pending:Number(reconciliationRow?.pending??0),
   manual:Number(reconciliationRow?.manual??0),
   total:Number(reconciliationRow?.total??0),
  },
  notifications:{
   pending:Number(notifRow?.pending??0),
   simulated:Number(notifRow?.simulated??0),
   delivered:Number(notifRow?.delivered??0),
   suppressed:Number(notifRow?.suppressed??0),
   failedManual:Number(notifRow?.failedManual??0),
  },
  finance:{
   currency:'INR' as const,
   verifiedPayments:{count:Number(payRow?.verifiedCount??0),amount:Number(payRow?.verifiedAmount??0)},
   pendingRefunds:{count:Number(payRow?.pendingRefundCount??0),amount:Number(payRow?.pendingRefundAmount??0)},
   completedRefunds:{count:Number(payRow?.refundedCount??0),amount:Number(payRow?.refundedAmount??0)},
   refundOperations:{
    pendingCount:Number(refundOpRow?.pendingCount??0),
    pendingAmount:Number(refundOpRow?.pendingAmount??0),
    manualCount:Number(refundOpRow?.manualCount??0),
   },
   createdPaymentsCount:Number(payRow?.createdCount??0),
   failedPaymentsCount:Number(payRow?.failedCount??0),
  },
 };
}

export async function resolveReconciliation(engine:Engine,payments:Payments,provider:PaymentProvider,
 refunds:RefundWorker,clinicId:string,adminId:string|null,jobId:string,
 input:{action:'REQUEUE'|'RESOLVE';reason:string}){
 const job=engine.one('SELECT * FROM reconciliation_jobs WHERE id=? AND clinic_id=?',jobId,clinicId);
 requireThat(job,'NOT_FOUND','Reconciliation job not found',404);
 requireThat(job.status==='MANUAL','INVALID_STATE','Only manual reconciliation jobs can be changed');
 const ref=String(job.operation_ref),kind=String(job.kind),gen=Number(job.generation),now=engine.now();
 const hold=engine.one('SELECT * FROM holds WHERE id=? AND clinic_id=?',ref,clinicId);
 requireThat(hold,'NOT_FOUND','Referenced hold not found',404);

 const reject=(code:string,message:string,status=409):never=>{
  engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_REJECTED',jobId,adminId,{kind,reasonProvided:true,code});
  throw new Fault(code,message,status);
 };

 if(input.action==='REQUEUE'){
  transaction(engine.db,()=>{
   const active=kind==='ORDER'?engine.one('SELECT hold_id FROM payment_order_attempts WHERE hold_id=? AND started_at=?',ref,gen)
    :kind==='CAPTURE'?engine.one("SELECT id FROM payments WHERE hold_id=? AND clinic_id=? AND state IN ('CREATED','FAILED')",ref,clinicId)
    :kind==='REFUND'?engine.one("SELECT id FROM payments WHERE hold_id=? AND clinic_id=? AND state='REFUND_PENDING'",ref,clinicId)
    :engine.one('SELECT booking_key FROM booking_operations WHERE booking_key=? AND kind=? AND started_at=?',ref,kind,gen);
   requireThat(active,'INVALID_STATE','Operation is no longer pending');
   engine.run("UPDATE reconciliation_jobs SET status='PENDING',attempts=0,next_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND clinic_id=?",now,jobId,clinicId);
   if(kind==='REFUND'){
    const pay=engine.one('SELECT id FROM payments WHERE hold_id=? AND clinic_id=?',ref,clinicId);
    if(pay)engine.run("UPDATE refund_operations SET status='PROCESSING',attempts=0,next_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE payment_ref=? AND status='MANUAL' AND submitted_at IS NOT NULL",now,pay.id);
   }
   engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_REQUEUED',jobId,adminId,{kind,reasonProvided:true});
  });
  return {jobId,kind,status:'PENDING',resolution:'REQUEUED'};
 }

 if(kind==='ORDER'){
  const attempt=engine.one('SELECT * FROM payment_order_attempts WHERE hold_id=? AND started_at=?',ref,gen);
  requireThat(attempt,'INVALID_STATE','Order attempt is no longer pending');
  if(!provider.findOrder)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Payment provider does not support order lookup',503);
  const order=await provider.findOrder(ref);
  if(!order||!order.id||order.receipt!==ref||order.amount!==attempt.amount||order.currency!=='INR'){
   return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Authoritative provider order evidence not found');
  }
  transaction(engine.db,()=>{
   const current=engine.one('SELECT hold_id FROM payment_order_attempts WHERE hold_id=? AND started_at=?',ref,gen);
   requireThat(current,'INVALID_STATE','Order attempt already resolved');
   applyProviderEvidence(engine.db,{kind:'ORDER',clinicId,holdId:ref,orderId:order.id,amount:order.amount,currency:'INR',receipt:order.receipt},engine.now());
   engine.run("UPDATE reconciliation_jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?",jobId);
   engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_RESOLVED',jobId,adminId,{kind,outcome:'applied',reasonProvided:true});
  });
  return {jobId,kind,status:'DONE',resolution:'APPLIED'};
 }

 if(kind==='CAPTURE'){
  const pay=engine.one("SELECT * FROM payments WHERE hold_id=? AND clinic_id=? AND state IN ('CREATED','FAILED')",ref,clinicId);
  requireThat(pay,'INVALID_STATE','Capture is no longer pending');
  if(!provider.findCapturedPayment)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Payment provider does not support capture lookup',503);
  const paymentId=await provider.findCapturedPayment(String(pay.order_id));
  if(!paymentId)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Captured provider payment not found');
  await payments.reconcile(clinicId,String(hold.session_id),ref,String(pay.order_id),paymentId,false);
  transaction(engine.db,()=>{
   engine.run("UPDATE reconciliation_jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?",jobId);
   engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_RESOLVED',jobId,adminId,{kind,outcome:'applied',reasonProvided:true});
  });
  return {jobId,kind,status:'DONE',resolution:'APPLIED'};
 }

 if(kind==='REFUND'){
  const pay=engine.one('SELECT * FROM payments WHERE hold_id=? AND clinic_id=?',ref,clinicId);
  requireThat(pay,'INVALID_STATE','Payment not found');
  if(pay.state==='REFUNDED'){
   transaction(engine.db,()=>{
    engine.run("UPDATE reconciliation_jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?",jobId);
    engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_RESOLVED',jobId,adminId,{kind,outcome:'already_refunded',reasonProvided:true});
   });
   return {jobId,kind,status:'DONE',resolution:'APPLIED'};
  }
  const op=engine.one('SELECT * FROM refund_operations WHERE payment_ref=? AND clinic_id=?',pay.id,clinicId);
  if(!op||op.submitted_at===null)return reject('REFUND_USE_OPERATOR_WORKFLOW','Unsubmitted refunds must follow the offline refund approval workflow');
  const refundId=op.provider_refund_id??(await provider.refunds?.(pay.payment_id))?.find(r=>r.receipt===op.id)?.id;
  if(!refundId)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Matching provider refund not found');
  await refunds.webhook(pay.payment_id,refundId);
  const updatedOp=engine.one('SELECT status FROM refund_operations WHERE id=?',op.id);
  const updatedPay=engine.one('SELECT state FROM payments WHERE id=?',pay.id);
  if(updatedPay?.state==='REFUNDED'&&updatedOp?.status==='COMPLETED'){
   transaction(engine.db,()=>{
    engine.run("UPDATE reconciliation_jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?",jobId);
    engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_RESOLVED',jobId,adminId,{kind,outcome:'refund_completed',reasonProvided:true});
   });
   return {jobId,kind,status:'DONE',resolution:'APPLIED'};
  }
  return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Authoritative processed provider refund evidence is not yet available');
 }

 const operation=engine.one('SELECT * FROM booking_operations WHERE booking_key=? AND kind=? AND started_at=?',ref,kind,gen);
 requireThat(operation,'INVALID_STATE','Booking operation is no longer pending');
 const appointment=engine.one('SELECT * FROM appointments WHERE hold_id=? AND clinic_id=?',ref,clinicId);
 const replacement=kind==='RESCHEDULE'?engine.one('SELECT * FROM holds WHERE id=? AND clinic_id=? AND session_id=?',operation.replacement_id,clinicId,hold.session_id):null;
 requireThat(appointment&&(kind!=='RESCHEDULE'||replacement),'INVALID_STATE','Referenced booking state is incomplete');
 const adapter=engine.adapters(clinicId);
 if(!adapter.lookupBooking)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Clinic adapter does not support booking lookup',503);
 const externalId=kind==='CONFIRM'?(adapter.confirmationLookupId?.(ref)??ref):appointment.external_id;
 if(!externalId)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','External booking identifier missing');
 const remote=await adapter.lookupBooking(String(externalId));
 const expected=replacement??appointment;
 const applied=remote&&remote.id===externalId&&(kind==='CANCEL'
  ?remote.state==='CANCELLED'
  :remote.state==='CONFIRMED'&&remote.doctorId===expected.doctor_id&&remote.start===expected.start&&remote.end===expected.end);
 const outcome=applied?'applied':null;
 if(!outcome)return reject('RECONCILIATION_EVIDENCE_UNAVAILABLE','Authoritative provider booking state could not confirm resolution');

 transaction(engine.db,()=>{
  const current=engine.one('SELECT * FROM booking_operations WHERE booking_key=? AND kind=? AND started_at=?',ref,kind,gen);
  requireThat(current,'INVALID_STATE','Booking operation already resolved');
  applyProviderEvidence(engine.db,{kind:kind as 'CONFIRM'|'CANCEL'|'RESCHEDULE',clinicId,holdId:ref,outcome,externalId:String(externalId)},engine.now());
  engine.run("UPDATE reconciliation_jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?",jobId);
  engine.auditDetails(clinicId,'MANUAL_RECONCILIATION_RESOLVED',jobId,adminId,{kind,outcome,reasonProvided:true});
 });
 return {jobId,kind,status:'DONE',resolution:'APPLIED'};
}
