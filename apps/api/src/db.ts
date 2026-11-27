import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID,scryptSync } from 'node:crypto';
import { enqueueRefund } from './refund-records.js';
function ensureColumn(db:DatabaseSync,table:string,column:string,definition:string){
 const cols=db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;
 if(!cols.some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
export function openDb(path:string){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(`
 CREATE TABLE IF NOT EXISTS clinics(id TEXT PRIMARY KEY,name TEXT NOT NULL,adapter TEXT NOT NULL,config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'OWNER');
 CREATE TABLE IF NOT EXISTS doctors(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,schedule TEXT NOT NULL,specialization TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),name TEXT NOT NULL,duration INTEGER NOT NULL CHECK(duration>0),fee INTEGER NOT NULL CHECK(fee>=0),active INTEGER NOT NULL DEFAULT 1,description TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS doctor_services(doctor_id TEXT REFERENCES doctors(id),service_id TEXT REFERENCES services(id),PRIMARY KEY(doctor_id,service_id));
 CREATE TABLE IF NOT EXISTS blocks(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,doctor_id TEXT,start TEXT NOT NULL,end TEXT NOT NULL,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL REFERENCES clinics(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,expires_at INTEGER NOT NULL,admin_id TEXT REFERENCES admins(id));
 CREATE TABLE IF NOT EXISTS consents(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),clinic_id TEXT NOT NULL,booking INTEGER NOT NULL,briefing INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,phone TEXT NOT NULL,UNIQUE(clinic_id,phone));
 CREATE TABLE IF NOT EXISTS holds(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,session_id TEXT NOT NULL,doctor_id TEXT NOT NULL,service_id TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,fee INTEGER NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL,phone TEXT,external_id TEXT);
 CREATE INDEX IF NOT EXISTS holds_overlap ON holds(doctor_id,start,end,expires_at);
 CREATE TABLE IF NOT EXISTS otps(hold_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,phone TEXT NOT NULL,hash TEXT NOT NULL,salt TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,hold_id TEXT UNIQUE NOT NULL,order_id TEXT UNIQUE NOT NULL,payment_id TEXT UNIQUE,amount INTEGER NOT NULL,currency TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS payment_order_attempts(
  hold_id TEXT PRIMARY KEY REFERENCES holds(id), amount INTEGER NOT NULL, started_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS payment_webhook_events(
  id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, processed_at INTEGER
 );
 CREATE TABLE IF NOT EXISTS refund_operations(
  id TEXT PRIMARY KEY, payment_ref TEXT NOT NULL UNIQUE REFERENCES payments(id),
  clinic_id TEXT NOT NULL REFERENCES clinics(id), appointment_id TEXT REFERENCES appointments(id),
  amount INTEGER NOT NULL CHECK(amount>=100), currency TEXT NOT NULL CHECK(currency='INR'),
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  provider_refund_id TEXT UNIQUE, approved_at INTEGER, submitted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT, last_error TEXT,
  created_at INTEGER NOT NULL, completed_at INTEGER
 );
 CREATE INDEX IF NOT EXISTS refund_due ON refund_operations(status,next_at,lease_until);
 CREATE TABLE IF NOT EXISTS booking_operations(
  booking_key TEXT PRIMARY KEY REFERENCES holds(id), kind TEXT NOT NULL,
  replacement_id TEXT REFERENCES holds(id), started_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS reconciliation_jobs(
  id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id),
  kind TEXT NOT NULL, operation_ref TEXT NOT NULL, generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, last_error TEXT, lease_until INTEGER, lease_token TEXT,
  UNIQUE(kind,operation_ref,generation)
 );
 CREATE INDEX IF NOT EXISTS reconciliation_due ON reconciliation_jobs(status,next_at,lease_until);
 CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,clinic_id TEXT NOT NULL,session_id TEXT NOT NULL,hold_id TEXT UNIQUE NOT NULL,doctor_id TEXT NOT NULL,service_id TEXT NOT NULL,patient_id TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,state TEXT NOT NULL,external_id TEXT,created_at INTEGER NOT NULL,fee INTEGER,duration INTEGER);
 CREATE INDEX IF NOT EXISTS appointments_overlap ON appointments(doctor_id,start,end,state);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,appointment_id TEXT,kind TEXT NOT NULL,destination TEXT,payload TEXT NOT NULL,status TEXT NOT NULL,error TEXT,UNIQUE(appointment_id,kind));
 CREATE TABLE IF NOT EXISTS notification_preferences(
  session_id TEXT PRIMARY KEY REFERENCES sessions(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), channel TEXT NOT NULL, language TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS notification_jobs(
  id TEXT PRIMARY KEY REFERENCES outbox(id), event_key TEXT NOT NULL UNIQUE,
  hold_id TEXT NOT NULL REFERENCES holds(id), event TEXT NOT NULL, channel TEXT,
  expected_start TEXT, scheduled_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER, provider_key TEXT, last_error TEXT
 );
 CREATE INDEX IF NOT EXISTS notification_due ON notification_jobs(status,next_at,lease_until);
 CREATE TABLE IF NOT EXISTS briefings(appointment_id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,summary TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_details(audit_id TEXT PRIMARY KEY REFERENCES audit(id),actor_id TEXT,metadata TEXT);
 CREATE TABLE IF NOT EXISTS mock_patients(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,phone TEXT NOT NULL,UNIQUE(clinic_id,phone));
 CREATE TABLE IF NOT EXISTS mock_bookings(id TEXT PRIMARY KEY,clinic_id TEXT NOT NULL,doctor_id TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER);
 INSERT OR IGNORE INTO booking_operations(booking_key,kind,replacement_id,started_at)
 SELECT a.hold_id,'CONFIRM',NULL,a.created_at FROM appointments a JOIN holds h ON h.id=a.hold_id
 WHERE a.state='CONFIRMATION_PENDING';
 `);
 transaction(db,()=>{
 ensureColumn(db,'admins','role',"TEXT NOT NULL DEFAULT 'OWNER'");
 ensureColumn(db,'admin_sessions','admin_id','TEXT REFERENCES admins(id)');
 ensureColumn(db,'doctors','specialization',"TEXT NOT NULL DEFAULT ''");
 ensureColumn(db,'services','description',"TEXT NOT NULL DEFAULT ''");
 ensureColumn(db,'appointments','fee','INTEGER');
 ensureColumn(db,'appointments','duration','INTEGER');
 });
 return db;
}
export type DB=ReturnType<typeof openDb>;
/** Call inside a write transaction. Confirmation claims retain their reservation. */
export function expireHolds(db:DB, now:number, holdId?:string) {
 const eligible = `SELECT id FROM holds
  WHERE expires_at<=? AND (? IS NULL OR id=?)
  AND state IN ('HELD','OTP_VERIFIED','PAYMENT_PENDING','PAYMENT_VERIFIED')
  AND NOT EXISTS (SELECT 1 FROM booking_operations WHERE booking_key=holds.id OR replacement_id=holds.id)
  AND NOT EXISTS (SELECT 1 FROM appointments WHERE hold_id=holds.id)`;
 const args = [now, holdId ?? null, holdId ?? null] as const;
 const expired=db.prepare(`UPDATE payments SET state='REFUND_PENDING' WHERE state='VERIFIED' AND hold_id IN (${eligible}) RETURNING hold_id`).all(...args);
 for(const payment of expired)enqueueRefund(db,String(payment.hold_id),'EXPIRED_RESERVATION',now);
 db.prepare(`UPDATE holds SET state='EXPIRED' WHERE id IN (${eligible})`).run(...args);
}
export function transaction<T>(db:DB,fn:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function seed(db:DB,password?:string){
 if(db.prepare('SELECT id FROM clinics LIMIT 1').get()){
 if(password)for(const row of db.prepare('SELECT id FROM clinics').all()){const id=String(row.id),email=`${id}@demo.invalid`;if(!db.prepare('SELECT id FROM admins WHERE email=?').get(email)){const salt=randomUUID();db.prepare('INSERT INTO admins(id,clinic_id,email,salt,password_hash,role) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,email,salt,scryptSync(password,salt,64).toString('hex'),'OWNER');}}return;}
 transaction(db,()=>{for(const [id,name,adapter,color] of [['lotus','Lotus Dental Demo','mock','#247c74'],['harbor','Harbor Medical Demo','google','#2255aa']]){
 const config={timezone:'Asia/Kolkata',holdSeconds:300,operatingHours:{start:9,end:17},languages:['en','kn','hi'],branding:{color},greeting:`Welcome to ${name}`,handoff:'+910000000000',emergency:'For an emergency, contact local emergency services.',faqs:[{question:'Is this a demo?',answer:'Yes. Use fictional patient data only.'}],refundCutoffHours:24};
 db.prepare('INSERT INTO clinics VALUES(?,?,?,?)').run(id,name,adapter,JSON.stringify(config));
 db.prepare('INSERT INTO doctors(id,clinic_id,name,active,schedule,specialization) VALUES(?,?,?,?,?,?)').run(`${id}-doctor`,id,id==='lotus'?'Dr Demo Meera':'Dr Demo Arjun',1,JSON.stringify({days:[1,2,3,4,5,6],start:9,end:17}),'');
 db.prepare('INSERT INTO services(id,clinic_id,name,duration,fee,active,description) VALUES(?,?,?,?,?,?,?)').run(`${id}-consult`,id,'Consultation',30,50000,1,'');
 db.prepare('INSERT INTO doctor_services VALUES(?,?)').run(`${id}-doctor`,`${id}-consult`);
 if(password){const salt=randomUUID();db.prepare('INSERT INTO admins(id,clinic_id,email,salt,password_hash,role) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,`${id}@demo.invalid`,salt,scryptSync(password,salt,64).toString('hex'),'OWNER');}
 }});
}
