import { randomUUID } from 'node:crypto';
import { type DB,transaction } from './db.js';
import type { Channel,NotificationEvent } from './notification-outbox.js';

export type NotificationMessage={id:string;clinicId:string;channel:Channel;language:string;audience:'PATIENT'|'CLINIC';event:NotificationEvent;text:string};
export type DeliveryResult='SIMULATED'|'DELIVERED'|'RETRY'|'AMBIGUOUS'|'PERMANENT';
export interface NotificationProvider {
 readonly key:string;
 readonly channels:readonly Channel[];
 readonly idempotent:boolean;
 deliver(message:NotificationMessage,signal:AbortSignal):Promise<DeliveryResult>;
}

export function configureNotificationDelivery(environment:string|undefined,mode:string|undefined,write:(line:string)=>void=console.log):NotificationProvider|undefined{
 if(!mode||mode==='disabled')return undefined;
 if(mode!=='development-console'||environment!=='development')throw new Error('Console notification delivery requires NODE_ENV=development');
 return {
  key:'development-console',channels:['CONSOLE'],idempotent:false,
  async deliver(message){
   write(JSON.stringify({event:'notification_simulated',id:message.id,kind:message.event,text:message.text}));
   return 'SIMULATED';
  },
 };
}

const templates:Record<NotificationEvent,string>={
 CONFIRMATION:'Your appointment is confirmed.',
 CANCELLATION:'Your appointment was cancelled.',
 RESCHEDULE:'Your appointment has moved.',
 REMINDER:'Your appointment is coming up.',
 PAYMENT_CONFIRMED:'Your payment was verified.',
 REFUND_PENDING:'Your refund is pending review.',
 REFUND_COMPLETED:'Your refund was confirmed by the payment provider.',
 REFUND_REVIEW:'Your refund needs clinic assistance. Please contact the clinic.',
 BRIEFING:'A consented appointment briefing is available to clinic staff.',
};
type Options={pollMs:number;leaseMs:number;retryMs:number;maxAttempts:number;staleReminderMs:number};
type Job={id:string;clinic_id:string;event:NotificationEvent;hold_id:string;expected_start:string|null;
 scheduled_at:number;attempts:number;lease_token:string;channel:Channel;language:string;timezone:string};
type Terminal='SIMULATED'|'DELIVERED'|'MANUAL'|'SUPPRESSED';

export class NotificationWorker {
 private timer?:ReturnType<typeof setInterval>;
 private active?:Promise<void>;
 private options:Options;
 constructor(private db:DB,private provider:NotificationProvider,options:Partial<Options>={},
  private now=()=>Date.now(),private log:(line:string)=>void=()=>{}){
  this.options={pollMs:5000,leaseMs:60000,retryMs:15000,maxAttempts:8,staleReminderMs:900000,...options};
 }

 start(){
  if(this.timer)return;
  const tick=()=>{
   if(!this.active)this.active=this.runOnce().then(()=>{},()=>this.log('{"event":"notification_tick_failed"}')).finally(()=>{this.active=undefined;});
  };
  this.timer=setInterval(tick,this.options.pollMs);
  tick();
 }
 async stop(){
  clearInterval(this.timer);
  this.timer=undefined;
  await this.active;
 }

 private suppress(id:string,status:Terminal,reason:string){
  this.db.prepare('UPDATE notification_jobs SET status=?,last_error=?,lease_token=NULL,lease_until=NULL WHERE id=?').run(status,reason,id);
 }

 private claim():Job|'SKIPPED'|undefined{
  const db=this.db,now=this.now();
  return transaction(db,()=>{
   const candidate=db.prepare(`SELECT j.*,o.clinic_id,p.enabled,p.channel AS preferred_channel,p.language,
     json_extract(c.config,'$.timezone') AS timezone,
     a.state AS booking_state,a.start AS booking_start,pay.state AS payment_state,
     (SELECT booking FROM consents WHERE clinic_id=o.clinic_id AND session_id=h.session_id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS consent,
     (SELECT briefing FROM consents WHERE clinic_id=o.clinic_id AND session_id=h.session_id ORDER BY created_at DESC,rowid DESC LIMIT 1) AS briefing,
     EXISTS(SELECT 1 FROM booking_operations WHERE booking_key=h.id) AS booking_operation
    FROM notification_jobs j JOIN outbox o ON o.id=j.id JOIN holds h ON h.id=j.hold_id AND h.clinic_id=o.clinic_id
    JOIN clinics c ON c.id=o.clinic_id
    LEFT JOIN notification_preferences p ON p.session_id=h.session_id AND p.clinic_id=o.clinic_id
    LEFT JOIN appointments a ON a.id=o.appointment_id AND a.clinic_id=o.clinic_id
    LEFT JOIN payments pay ON pay.hold_id=h.id AND pay.clinic_id=o.clinic_id
    WHERE (j.status='PENDING' AND j.next_at<=?) OR (j.status='RUNNING' AND j.lease_until<=?)
    ORDER BY j.next_at,j.id LIMIT 1`).get(now,now);
   if(!candidate)return undefined;
   const id=String(candidate.id),event=candidate.event as NotificationEvent;
   const channel=candidate.preferred_channel as Channel;
   const skip=(state:Terminal,reason:string)=>{this.suppress(id,state,reason);return 'SKIPPED' as const;};
   if((candidate.status==='RUNNING'||candidate.last_error==='AMBIGUOUS_DELIVERY')&&
    (!this.provider.idempotent||candidate.provider_key!==this.provider.key||channel!==candidate.channel)){
    return skip('MANUAL','AMBIGUOUS_DELIVERY');
   }
   if(candidate.enabled!==1||candidate.consent!==1||(event==='BRIEFING'&&candidate.briefing!==1)){
    return skip('SUPPRESSED','CONSENT_OR_PREFERENCE_MISSING');
   }
   if(event==='REMINDER'&&(now-Number(candidate.scheduled_at)>this.options.staleReminderMs||Date.parse(String(candidate.booking_start))<=now)){
    return skip('SUPPRESSED','STALE_REMINDER');
   }
   if(['CONFIRMATION','RESCHEDULE','REMINDER','BRIEFING'].includes(event)&&
    (candidate.booking_state!=='CONFIRMED'||candidate.booking_operation===1||candidate.expected_start!==candidate.booking_start)){
    return skip('SUPPRESSED','BOOKING_CHANGED');
   }
   if(event==='CANCELLATION'&&!['CANCELLED','REFUND_PENDING','REFUNDED'].includes(String(candidate.booking_state))){
    return skip('SUPPRESSED','BOOKING_CHANGED');
   }
   const paymentState:Partial<Record<NotificationEvent,string>>={PAYMENT_CONFIRMED:'VERIFIED',REFUND_PENDING:'REFUND_PENDING',REFUND_COMPLETED:'REFUNDED',REFUND_REVIEW:'REFUND_PENDING'};
   if(paymentState[event]&&paymentState[event]!==candidate.payment_state)return skip('SUPPRESSED','PAYMENT_CHANGED');
   if(!this.provider.channels.includes(channel)||(event==='BRIEFING'&&channel!=='CONSOLE')){
    return skip('MANUAL','CHANNEL_UNAVAILABLE');
   }
   if(Number(candidate.attempts)>=this.options.maxAttempts)return skip('MANUAL','RETRY_LIMIT');
   return db.prepare(`UPDATE notification_jobs SET status='RUNNING',attempts=attempts+1,channel=?,lease_token=?,lease_until=?,provider_key=?
     WHERE id=? RETURNING *,? AS clinic_id,? AS language,? AS timezone`)
    .get(channel,randomUUID(),now+this.options.leaseMs,this.provider.key,id,candidate.clinic_id,candidate.language,candidate.timezone) as Job|undefined;
  });
 }

 private message(job:Job):NotificationMessage{
  const includeTime=['CONFIRMATION','RESCHEDULE','REMINDER'].includes(job.event)&&job.expected_start;
  const time=includeTime?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:job.timezone}).format(new Date(job.expected_start!)):'';
  return {id:job.id,clinicId:job.clinic_id,channel:job.channel,language:job.language,audience:job.event==='BRIEFING'?'CLINIC':'PATIENT',
   event:job.event,text:templates[job.event]+(time?` ${time} (${job.timezone}).`:'')};
 }

 async runOnce():Promise<boolean>{
  const job=this.claim();
  if(!job)return false;
  if(job==='SKIPPED')return true;
  let result:DeliveryResult;
  const controller=new AbortController();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   result=await Promise.race([
    this.provider.deliver(this.message(job),controller.signal),
    new Promise<DeliveryResult>(resolve=>{
     timeout=setTimeout(()=>{controller.abort();resolve('AMBIGUOUS');},Math.max(1,Math.min(10000,this.options.leaseMs-1)));
    }),
   ]);
  }catch{result='AMBIGUOUS';}
  finally{clearTimeout(timeout);}
  const retryable=result==='RETRY'||(result==='AMBIGUOUS'&&this.provider.idempotent);
  const retry=retryable&&job.attempts<this.options.maxAttempts;
  const status=retry?'PENDING':result==='DELIVERED'||result==='SIMULATED'?result:'MANUAL';
  const reason=result==='AMBIGUOUS'?'AMBIGUOUS_DELIVERY':retry?'PROVIDER_RETRY':retryable?'RETRY_LIMIT':result==='PERMANENT'?'PROVIDER_REJECTED':null;
  const now=this.now(),delay=Math.min(3600000,this.options.retryMs*2**Math.min(job.attempts-1,16));
  const changed=this.db.prepare(`UPDATE notification_jobs SET status=?,last_error=?,next_at=?,lease_token=NULL,lease_until=NULL
   WHERE id=? AND lease_token=? AND lease_until>?`).run(status,reason,now+delay,job.id,job.lease_token,now);
  if(changed.changes)this.log(JSON.stringify({event:'notification_attempt',id:job.id,kind:job.event,status,attempt:job.attempts}));
  return true;
 }
}
