import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {openDb,seed} from '../apps/api/src/db.js';
import {createApp} from '../apps/api/src/server.js';
import {configureOtpDelivery} from '../apps/api/src/otp-delivery.js';
if(process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) throw new Error('Demo requires Razorpay Test Mode');
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) throw new Error('Set a local ADMIN_PASSWORD of at least 12 characters');
const otpDelivery = configureOtpDelivery('development', 'development-console')!;
const db=openDb(':memory:');
seed(db,password);
const session=randomUUID(), patient=randomUUID(), hold=randomUUID(), appointment=randomUUID();
const start=new Date(Date.now()+86400000).toISOString(), end=new Date(Date.parse(start)+1800000).toISOString();
db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(session,'lotus',Date.now(),Date.parse(end));
db.prepare('INSERT INTO patients VALUES(?,?,?)').run(patient,'lotus','+19995550100');
db.prepare('INSERT INTO holds(id,clinic_id,session_id,doctor_id,service_id,start,end,fee,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(hold,'lotus',session,'lotus-doctor','lotus-consult',start,end,50000,Date.parse(end),'CONFIRMED');
db.prepare('INSERT INTO appointments(id,reference,clinic_id,session_id,hold_id,doctor_id,service_id,patient_id,start,end,state,created_at,fee,duration) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
 .run(appointment,'DEMO-ADMIN-001','lotus',session,hold,'lotus-doctor','lotus-consult',patient,start,end,'CONFIRMED',Date.now(),50000,30);
const {app,engine}=createApp(db,{mockKey:randomUUID(),otpSink:otpDelivery?.deliver.bind(otpDelivery),origins:['http://localhost:5174','http://127.0.0.1:5174','http://localhost:5173','http://127.0.0.1:5173']});
db.prepare('INSERT INTO consents VALUES(?,?,?,?,?,?)').run(randomUUID(),session,'lotus',1,1,Date.now());
engine.briefing('lotus',session,appointment,'Demo patient reports tooth sensitivity with cold drinks over the last three days.','fixture@example.invalid');
const page = readFileSync(new URL('./index.html', import.meta.url));
const site = createServer((req, res) => {
 if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404).end(); return; }
 res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
}).listen(5180, '127.0.0.1', () => console.log('Demo website: http://127.0.0.1:5180/'));
const api=app.listen(4000,'127.0.0.1');
await import('../apps/admin/serve.mjs');
process.on('SIGINT',()=>{site.close();api.close();db.close();process.exit(0);});
