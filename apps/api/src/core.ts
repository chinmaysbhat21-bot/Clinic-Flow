import { randomUUID,randomInt,scryptSync,timingSafeEqual,createHmac } from 'node:crypto';
import { transaction,type DB } from './db.js';
import type { BookingAdapter,Slot } from '../../../packages/shared/src/index.js';
export class Fault extends Error {constructor(public code:string,message:string,public status=400){super(message);}}
export function requireThat(ok:unknown,code:string,message=code,status=400):asserts ok {if(!ok)throw new Fault(code,message,status);}
export function equal(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export type Row=Record<string,any>;
export class Engine {
 constructor(public db:DB,public adapters:(clinic:string)=>BookingAdapter,public otpSink:(hold:string,code:string)=>void=()=>{},public now=()=>Date.now()){}
 one(sql:string,...args:any[]):Row|undefined{return this.db.prepare(sql).get(...args) as Row|undefined;}
 all(sql:string,...args:any[]):Row[]{return this.db.prepare(sql).all(...args) as Row[];}
 run(sql:string,...args:any[]){return this.db.prepare(sql).run(...args);}
 clinic(id:string){const c=this.one('SELECT * FROM clinics WHERE id=?',id);requireThat(c,'NOT_FOUND','Clinic not found',404);return {...c,config:JSON.parse(c.config)} as Row;}
 audit(clinic:string,action:string,id:string){this.run('INSERT INTO audit VALUES(?,?,?,?,?)',randomUUID(),clinic,action,id,this.now());}
 consent(clinic:string,session:string,briefing=false){const record=this.one('SELECT * FROM consents WHERE clinic_id=? AND session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',clinic,session);requireThat(record?.booking&&(!briefing||record.briefing),'CONSENT_REQUIRED');}
 hold(clinic:string,session:string,id:string,active=true){const h=this.one('SELECT * FROM holds WHERE id=? AND clinic_id=? AND session_id=?',id,clinic,session);requireThat(h,'NOT_FOUND','Hold not found',404);if(active)requireThat(h.expires_at>this.now()&&!['EXPIRED','CANCELLED'].includes(h.state),'HOLD_EXPIRED');return h;}
 booking(clinic:string,session:string,id:string){const a=this.one('SELECT * FROM appointments WHERE id=? AND clinic_id=? AND session_id=?',id,clinic,session);requireThat(a,'NOT_FOUND','Booking not found',404);return a;}
 slots(clinic:string,doctorId:string,serviceId:string,date:string):Slot[]{
 const c=this.clinic(clinic);const d=this.one('SELECT * FROM doctors WHERE id=? AND clinic_id=? AND active=1',doctorId,clinic);const s=this.one('SELECT * FROM services WHERE id=? AND clinic_id=? AND active=1',serviceId,clinic);
 requireThat(d&&s&&this.one('SELECT 1 FROM doctor_services WHERE doctor_id=? AND service_id=?',doctorId,serviceId),'INVALID_SELECTION');
 const schedule=JSON.parse(d.schedule);const day=new Date(`${date}T12:00:00+05:30`).getUTCDay();if(!schedule.days.includes(day))return [];
 const startHour=Math.max(schedule.start,c.config.operatingHours.start),endHour=Math.min(schedule.end,c.config.operatingHours.end);
 const base=Date.parse(`${date}T00:00:00+05:30`);const slots:Slot[]=[];
 for(let t=base+startHour*3600000;t+s.duration*60000<=base+endHour*3600000;t+=s.duration*60000){
 const start=new Date(t).toISOString(),end=new Date(t+s.duration*60000).toISOString();
 if(t<=this.now())continue;
 if(this.one('SELECT 1 FROM blocks WHERE clinic_id=? AND (doctor_id IS NULL OR doctor_id=?) AND start<? AND end>?',clinic,doctorId,end,start))continue;
 if(this.one("SELECT 1 FROM appointments WHERE doctor_id=? AND state IN ('CONFIRMED','CONFIRMATION_PENDING') AND start<? AND end>?",doctorId,end,start))continue;
 if(this.one("SELECT 1 FROM holds WHERE doctor_id=? AND state NOT IN ('CANCELLED','EXPIRED','CONFIRMED') AND expires_at>? AND start<? AND end>?",doctorId,this.now(),end,start))continue;
 slots.push({start,end});}return slots;
 }
 async available(clinic:string,doctor:string,service:string,date:string){const local=this.slots(clinic,doctor,service,date);if(!local.length)return [];
 const busy=await this.adapters(clinic).getSlots({doctorId:doctor,start:local[0].start,end:local.at(-1)!.end});return local.filter(s=>!busy.some(b=>b.start<s.end&&b.end>s.start));}
 async reserve(clinic:string,session:string,input:{doctorId:string;serviceId:string;start:string}):Promise<Row>{
 this.consent(clinic,session);const date=new Date(Date.parse(input.start)+19800000).toISOString().slice(0,10);const start=new Date(input.start).toISOString();
 const candidate=(await this.available(clinic,input.doctorId,input.serviceId,date)).find(s=>s.start===start);requireThat(candidate,'SLOT_UNAVAILABLE',undefined,409);
 const h=transaction(this.db,()=>{requireThat(this.slots(clinic,input.doctorId,input.serviceId,date).some(s=>s.start===start),'SLOT_UNAVAILABLE',undefined,409);const s=this.one('SELECT fee FROM services WHERE id=?',input.serviceId)!;const id=randomUUID(),expires=this.now()+this.clinic(clinic).config.holdSeconds*1000;
 this.run('INSERT INTO holds(id,clinic_id,session_id,doctor_id,service_id,start,end,fee,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?)',id,clinic,session,input.doctorId,input.serviceId,start,candidate.end,s.fee,expires,'HELD');return this.hold(clinic,session,id);});
 try{const external=await this.adapters(clinic).holdSlot({id:h.id,doctorId:h.doctor_id,start:h.start,end:h.end,expiresAt:new Date(h.expires_at).toISOString()});this.run('UPDATE holds SET external_id=? WHERE id=?',external,h.id);return {...h,external_id:external};}catch(e){this.run("UPDATE holds SET state='CANCELLED' WHERE id=?",h.id);throw e;}
 }
 sendOtp(clinic:string,session:string,id:string,phone:string){const h=this.hold(clinic,session,id);requireThat(['HELD','OTP_VERIFIED'].includes(h.state),'INVALID_STATE');const prior=this.one('SELECT * FROM otps WHERE hold_id=?',id);requireThat(!prior||this.now()-prior.sent_at>=60000,'OTP_COOLDOWN',undefined,429);
 const code=String(randomInt(100000,1000000)),salt=randomUUID();this.run('INSERT OR REPLACE INTO otps VALUES(?,?,?,?,?,?,0,?,0)',id,session,phone,scryptSync(code,salt,32).toString('hex'),salt,this.now()+180000,this.now());this.run("UPDATE holds SET state='HELD',phone=NULL WHERE id=?",id);this.otpSink(id,code);return {delivery:'DEVELOPMENT_OUTBOX',expiresIn:180};}
 verifyOtp(clinic:string,session:string,id:string,phone:string,code:string){this.hold(clinic,session,id);const otp=this.one('SELECT * FROM otps WHERE hold_id=? AND session_id=? AND phone=?',id,session,phone);requireThat(otp&&!otp.consumed&&otp.expires_at>this.now()&&otp.attempts<5,'OTP_INVALID_OR_EXPIRED');this.run('UPDATE otps SET attempts=attempts+1 WHERE hold_id=?',id);requireThat(equal(otp.hash,scryptSync(code,otp.salt,32).toString('hex')),'OTP_INVALID_OR_EXPIRED');this.run('UPDATE otps SET consumed=1 WHERE hold_id=?',id);this.run("UPDATE holds SET state='OTP_VERIFIED',phone=? WHERE id=?",phone,id);return {state:'OTP_VERIFIED'};}
 async confirm(clinic:string,session:string,id:string){
 const before=this.hold(clinic,session,id,false);if(before.expires_at<=this.now()&&before.state==='PAYMENT_VERIFIED'){this.run("UPDATE payments SET state='REFUND_PENDING' WHERE hold_id=? AND state='VERIFIED'",id);this.run("UPDATE holds SET state='EXPIRED' WHERE id=?",id);}
 const existing=this.one('SELECT * FROM appointments WHERE hold_id=? AND clinic_id=? AND session_id=?',id,clinic,session);if(existing?.state==='CONFIRMED')return existing;
 const a=transaction(this.db,()=>{const h=this.hold(clinic,session,id,!existing);this.consent(clinic,session);requireThat(h.phone&&this.one("SELECT id FROM payments WHERE hold_id=? AND state='VERIFIED'",id),'VERIFICATION_REQUIRED');
 if(existing){requireThat(existing.state==='CONFIRMATION_PENDING','INVALID_STATE');return existing;}
 requireThat(h.state==='PAYMENT_VERIFIED','VERIFICATION_REQUIRED');const patient=this.one('SELECT * FROM patients WHERE clinic_id=? AND phone=?',clinic,h.phone);const patientId=patient?.id??randomUUID();if(!patient)this.run('INSERT INTO patients VALUES(?,?,?)',patientId,clinic,h.phone);
 const bookingId=randomUUID();this.run('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',bookingId,`AH-${randomUUID().slice(0,8).toUpperCase()}`,clinic,session,id,h.doctor_id,h.service_id,patientId,h.start,h.end,'CONFIRMATION_PENDING',null,this.now());
 this.run("UPDATE holds SET state='CONFIRMATION_PENDING' WHERE id=?",id);return this.booking(clinic,session,bookingId);});
 try{const patient=this.one('SELECT * FROM patients WHERE id=?',a.patient_id)!;const adapter=this.adapters(clinic);const patientId=await adapter.findOrCreatePatient({id:patient.id,phone:patient.phone});const external=await adapter.confirmBooking({id,doctorId:a.doctor_id,start:a.start,end:a.end,patientId});
 transaction(this.db,()=>{this.run("UPDATE appointments SET state='CONFIRMED',external_id=? WHERE id=?",external,a.id);this.run("UPDATE holds SET state='CONFIRMED' WHERE id=?",id);this.notify(clinic,a.id,'CONFIRMATION');this.audit(clinic,'BOOKING_CONFIRMED',a.id);});return this.booking(clinic,session,a.id);
 }catch{throw new Fault('CONFIRMATION_PENDING','Payment retained; retry confirmation with the same hold ID',503);}
 }
 notify(clinic:string,id:string,kind:string){this.run('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?,?,?)',randomUUID(),clinic,id,kind,null,JSON.stringify({bookingId:id}),'SIMULATED',null);}
 async cancel(clinic:string,session:string,id:string){const a=this.booking(clinic,session,id);if(['CANCELLED','REFUND_PENDING'].includes(a.state))return a;requireThat(a.state==='CONFIRMED','INVALID_STATE');await this.adapters(clinic).cancelBooking(a.external_id);
 return transaction(this.db,()=>{const refundable=Date.parse(a.start)-this.now()>=this.clinic(clinic).config.refundCutoffHours*3600000;this.run('UPDATE appointments SET state=? WHERE id=?',refundable?'REFUND_PENDING':'CANCELLED',id);if(refundable)this.run("UPDATE payments SET state='REFUND_PENDING' WHERE hold_id=?",a.hold_id);this.notify(clinic,id,'CANCELLATION');this.audit(clinic,'BOOKING_CANCELLED',id);return this.booking(clinic,session,id);});}
 async reschedule(clinic:string,session:string,id:string,holdId:string){const a=this.booking(clinic,session,id),h=this.hold(clinic,session,holdId);requireThat(a.state==='CONFIRMED'&&a.doctor_id===h.doctor_id&&a.service_id===h.service_id,'INVALID_RESCHEDULE');requireThat(this.one('SELECT amount FROM payments WHERE hold_id=?',a.hold_id)?.amount===h.fee,'RESCHEDULE_FEE_CHANGED');
 // Pin the replacement while the external update is in flight. Original stays occupied.
 this.run("UPDATE holds SET expires_at=?,state='CONFIRMATION_PENDING' WHERE id=?",this.now()+86400000,holdId);
 try{await this.adapters(clinic).rescheduleBooking(a.external_id,{doctorId:h.doctor_id,start:h.start,end:h.end});}catch{throw new Fault('RESCHEDULE_PENDING','Original booking retained; replacement retained for reconciliation',503);}
 transaction(this.db,()=>{this.run('UPDATE appointments SET start=?,end=? WHERE id=?',h.start,h.end,id);this.run("UPDATE holds SET state='CONFIRMED' WHERE id=?",holdId);this.notify(clinic,id,`RESCHEDULE_${holdId}`);this.audit(clinic,'BOOKING_RESCHEDULED',id);});return this.booking(clinic,session,id);}
 briefing(clinic:string,session:string,id:string,summary:string,destination?:string){const a=this.booking(clinic,session,id);requireThat(a.state==='CONFIRMED','BOOKING_NOT_CONFIRMED');this.consent(clinic,session,true);requireThat(destination,'BRIEFING_DESTINATION_NOT_CONFIGURED');requireThat(this.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',a.doctor_id,clinic),'INVALID_DOCTOR');transaction(this.db,()=>{this.run('INSERT OR IGNORE INTO briefings VALUES(?,?,?,?)',id,clinic,summary,this.now());this.run('INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,?,?,?)',randomUUID(),clinic,id,'BRIEFING',destination,JSON.stringify({bookingId:id}),'SIMULATED',null);});return {status:'SIMULATED',delivered:false};}
}
export function signature(secret:string,message:string){return createHmac('sha256',secret).update(message).digest('hex');}
