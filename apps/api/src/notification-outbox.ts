import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export const channels=['CONSOLE','EMAIL','SMS','WHATSAPP'] as const;
export type Channel=typeof channels[number];
export type NotificationEvent='CONFIRMATION'|'CANCELLATION'|'RESCHEDULE'|'REMINDER'|'PAYMENT_CONFIRMED'|'REFUND_PENDING'|'REFUND_COMPLETED'|'BRIEFING';

export function reminderMinutes(raw=process.env.NOTIFICATION_REMINDER_MINUTES):number[]{
 const values=(raw??'1440,60').split(',').map(Number);
 if(values.length>8||values.some(n=>!Number.isInteger(n)||n<1||n>10080))throw new Error('Invalid NOTIFICATION_REMINDER_MINUTES');
 return [...new Set(values)];
}

function enqueue(db:DB,input:{event:NotificationEvent;key:string;holdId:string;clinicId:string;appointmentId:string|null;kind:string;when:number;start?:string}){
 if(db.prepare('SELECT id FROM notification_jobs WHERE event_key=?').get(input.key))return;
 const id=randomUUID();
 const inserted=db.prepare('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?,?,?)').run(id,input.clinicId,input.appointmentId,input.kind,null,JSON.stringify(input.appointmentId?{bookingId:input.appointmentId}:{}),'PENDING',null);
 if(!inserted.changes)return;
 db.prepare('INSERT INTO notification_jobs(id,event_key,hold_id,event,expected_start,scheduled_at,next_at) VALUES(?,?,?,?,?,?,?)')
  .run(id,input.key,input.holdId,input.event,input.start??null,input.when,input.when);
}

/** Called inside the transaction that commits a booking change. */
export function enqueueBookingNotice(db:DB,clinicId:string,appointmentId:string,kind:string,now:number){
 const a=db.prepare('SELECT hold_id,start,state FROM appointments WHERE id=? AND clinic_id=?').get(appointmentId,clinicId);
 if(!a)return;
 const event=kind.startsWith('RESCHEDULE_')?'RESCHEDULE':kind as NotificationEvent;
 const holdId=String(a.hold_id),start=String(a.start);
 enqueue(db,{event,key:appointmentId+':'+kind,clinicId,appointmentId,kind,when:now,holdId,start});
 if(event==='CANCELLATION'||event==='RESCHEDULE'){
  db.prepare(`UPDATE notification_jobs SET status='SUPPRESSED',last_error='BOOKING_CHANGED'
   WHERE hold_id=? AND event='REMINDER' AND status='PENDING'`).run(holdId);
 }
 if(event==='CANCELLATION'||event==='RESCHEDULE'){
  // Only the current schedule should be advertised, even after several moves.
  db.prepare(`UPDATE notification_jobs SET status='SUPPRESSED',last_error='BOOKING_CHANGED'
   WHERE hold_id=? AND event IN ('CONFIRMATION','RESCHEDULE') AND status='PENDING' AND expected_start<>?`).run(holdId,start);
 }
 if((event==='CONFIRMATION'||event==='RESCHEDULE')&&a.state==='CONFIRMED'){
  for(const minutes of reminderMinutes()){
   const when=Date.parse(start)-minutes*60000;
   if(when<=now)continue;
   const key=`REMINDER:${kind}:${minutes}`;
   enqueue(db,{event:'REMINDER',key:appointmentId+':'+key,clinicId,appointmentId,kind:key,when,holdId,start});
  }
 }
}

/** Called inside the transaction that commits a verified payment or refund transition. */
export function enqueuePaymentNotice(db:DB,holdId:string,event:'PAYMENT_CONFIRMED'|'REFUND_PENDING'|'REFUND_COMPLETED',now:number){
 const payment=db.prepare('SELECT * FROM payments WHERE hold_id=?').get(holdId);
 const required={PAYMENT_CONFIRMED:'VERIFIED',REFUND_PENDING:'REFUND_PENDING',REFUND_COMPLETED:'REFUNDED'}[event];
 if(!payment||payment.state!==required)return;
 const appointment=db.prepare('SELECT id FROM appointments WHERE hold_id=? AND clinic_id=?').get(holdId,payment.clinic_id);
 enqueue(db,{event,key:holdId+':'+event,clinicId:String(payment.clinic_id),appointmentId:appointment?String(appointment.id):null,kind:event,when:now,holdId});
}
