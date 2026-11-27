import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { enqueuePaymentNotice } from './notification-outbox.js';

export type RefundReason='ELIGIBLE_CANCELLATION'|'EXPIRED_RESERVATION'|'BOOKING_NOT_CREATED';

/** Called in the transaction that commits an authoritative refund-pending transition. */
export function enqueueRefund(db:DB,holdId:string,reason:RefundReason,now:number){
 const p=db.prepare("SELECT * FROM payments WHERE hold_id=? AND state='REFUND_PENDING' AND payment_id IS NOT NULL").get(holdId);
 if(!p||p.currency!=='INR'||!Number.isSafeInteger(p.amount)||Number(p.amount)<100)return;
 const appointment=db.prepare('SELECT id,state FROM appointments WHERE hold_id=? AND clinic_id=?').get(holdId,p.clinic_id);
 if(appointment&&appointment.state!=='REFUND_PENDING')return;
 if(!appointment&&reason!=='EXPIRED_RESERVATION')return;
 db.prepare(`INSERT INTO refund_operations(id,payment_ref,clinic_id,appointment_id,amount,currency,reason,next_at,created_at)
  VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_ref) DO NOTHING`)
  .run(randomUUID(),p.id,p.clinic_id,appointment?.id??null,p.amount,p.currency,reason,now,now);
 enqueuePaymentNotice(db,holdId,'REFUND_PENDING',now);
}
