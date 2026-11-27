import { randomUUID } from 'node:crypto';
import { type DB, transaction } from './db.js';

type Operation = 'CONFIRM' | 'CANCEL' | 'RESCHEDULE';
type Evidence =
 | { kind: 'ORDER'; clinicId: string; holdId: string; orderId: string; amount: number; currency: 'INR'; receipt: string }
 | { kind: Operation; clinicId: string; holdId: string; outcome: 'applied' | 'not-applied'; externalId?: string };

/** Run offline, after checking authoritative provider records and stopping all API writers. */
export function reconcileOffline(db: DB, evidence: Evidence, now = Date.now()) {
 return transaction(db, () => {
  const hold = db.prepare('SELECT * FROM holds WHERE id=? AND clinic_id=?').get(evidence.holdId, evidence.clinicId);
  if (!hold) throw new Error('Unknown clinic hold');
  if (evidence.kind === 'ORDER') {
   const attempt = db.prepare('SELECT amount FROM payment_order_attempts WHERE hold_id=?').get(hold.id);
   if (!attempt || !evidence.orderId || evidence.receipt !== hold.id || evidence.currency !== 'INR' || evidence.amount !== attempt.amount) throw new Error('Order evidence does not match the pending attempt');
   db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), evidence.clinicId, hold.id, evidence.orderId, null, evidence.amount, 'INR', 'CREATED', now);
   db.prepare('DELETE FROM payment_order_attempts WHERE hold_id=?').run(hold.id);
  } else {
   const operation = db.prepare('SELECT * FROM booking_operations WHERE booking_key=? AND kind=?').get(hold.id, evidence.kind);
   const appointment = db.prepare('SELECT * FROM appointments WHERE hold_id=? AND clinic_id=?').get(hold.id, evidence.clinicId);
   if (!operation || !appointment) throw new Error('No matching pending booking operation');
   if (evidence.kind === 'CONFIRM') {
    if (evidence.outcome === 'applied') {
     if (!evidence.externalId) throw new Error('External booking ID is required');
     db.prepare("UPDATE appointments SET state='CONFIRMED',external_id=? WHERE id=?").run(evidence.externalId, appointment.id);
     db.prepare("UPDATE holds SET state='CONFIRMED' WHERE id=?").run(hold.id);
    } else {
     db.prepare("UPDATE appointments SET state='REFUND_PENDING' WHERE id=?").run(appointment.id);
     db.prepare("UPDATE holds SET state='CANCELLED' WHERE id=?").run(hold.id);
     db.prepare("UPDATE payments SET state='REFUND_PENDING' WHERE hold_id=? AND state='VERIFIED'").run(hold.id);
    }
   } else if (evidence.kind === 'CANCEL' && evidence.outcome === 'applied') {
    const clinic = db.prepare('SELECT config FROM clinics WHERE id=?').get(evidence.clinicId);
    const cutoff = JSON.parse(String(clinic?.config)).refundCutoffHours;
    const refundable = Date.parse(String(appointment.start)) - Number(operation.started_at) >= cutoff * 3600000;
    db.prepare('UPDATE appointments SET state=? WHERE id=?').run(refundable ? 'REFUND_PENDING' : 'CANCELLED', appointment.id);
    if (refundable) db.prepare("UPDATE payments SET state='REFUND_PENDING' WHERE hold_id=?").run(hold.id);
   } else if (evidence.kind === 'RESCHEDULE') {
    const replacement = db.prepare('SELECT * FROM holds WHERE id=? AND clinic_id=? AND session_id=?').get(operation.replacement_id, evidence.clinicId, hold.session_id);
    if (!replacement) throw new Error('Replacement hold is missing');
    if (evidence.outcome === 'applied') {
     const overlap = db.prepare("SELECT id FROM appointments WHERE doctor_id=? AND id<>? AND state IN ('CONFIRMED','CONFIRMATION_PENDING') AND start<? AND end>?").get(replacement.doctor_id, appointment.id, replacement.end, replacement.start);
     const held = db.prepare("SELECT id FROM holds WHERE doctor_id=? AND id<>? AND state NOT IN ('CANCELLED','EXPIRED','CONFIRMED') AND expires_at>? AND start<? AND end>?").get(replacement.doctor_id, replacement.id, now, replacement.end, replacement.start);
     if (overlap || held) throw new Error('Replacement now conflicts. Resolve the provider conflict first.');
     db.prepare('UPDATE appointments SET start=?,end=? WHERE id=?').run(replacement.start, replacement.end, appointment.id);
     db.prepare('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), evidence.clinicId, appointment.id, `RESCHEDULE_${replacement.id}`, null, JSON.stringify({bookingId:appointment.id}), 'SIMULATED', null);
    }
    db.prepare('UPDATE holds SET state=? WHERE id=?').run(evidence.outcome === 'applied' ? 'CONFIRMED' : 'CANCELLED', replacement.id);
   }
   db.prepare('DELETE FROM booking_operations WHERE booking_key=?').run(hold.id);
  }
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(), evidence.clinicId, `RECONCILED_${evidence.kind}`, hold.id, now);
 });
}
