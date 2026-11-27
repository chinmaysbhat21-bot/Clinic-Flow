import express,{type Request,type Response,type NextFunction} from 'express';
import { randomUUID,randomBytes,createHash,scryptSync } from 'node:crypto';
import { z } from 'zod';
import * as contracts from '../../../packages/shared/src/index.js';
import { Engine,Fault,requireThat,equal,signature } from './core.js';
import { type DB,transaction } from './db.js';
import { GoogleAdapter,MockAdapter,googleCalendarId } from './adapters.js';
import { Payments,RazorpayProvider,type PaymentProvider } from './payments.js';
export function createApp(db:DB,options:{mockBase?:string;mockKey:string;webhookSecret?:string;otpSink?:(id:string,code:string,phone:string)=>void;provider?:PaymentProvider;now?:()=>number;origins?:string[]} ){
 const app=express();app.disable('x-powered-by');
 const engine:Engine=new Engine(db,clinic=>{
  const {adapter,config}=engine.clinic(clinic);
  if(adapter==='google')return new GoogleAdapter(process.env.GOOGLE_ACCESS_TOKEN??'',googleCalendarId(clinic,process.env.GOOGLE_CALENDARS_JSON,process.env.GOOGLE_CALENDAR_ID),config.timezone);
  return new MockAdapter(options.mockBase??'http://127.0.0.1:4000/mock',clinic,options.mockKey);
 },options.otpSink,options.now);
 const provider=options.provider??new RazorpayProvider(process.env.RAZORPAY_KEY_ID??'',process.env.RAZORPAY_KEY_SECRET??'');
 const payments=new Payments(engine,provider);
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 app.use((req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const origin=req.headers.origin;if(origin){if(!(options.origins??['http://localhost:5173','http://localhost:5174']).includes(origin))return next(new Fault('ORIGIN_NOT_ALLOWED','Origin not allowed',403));res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Clinic-Id, X-Session-Id');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');}if(req.method==='OPTIONS'){res.sendStatus(204);return;}next();});
 const limits=new Map<string,{count:number;reset:number}>();app.use((req,res,next)=>{const key=req.socket.remoteAddress??'unknown',now=Date.now();if(limits.size>10000)for(const [k,v] of limits)if(v.reset<now)limits.delete(k);let value=limits.get(key);if(!value||value.reset<now){value={count:0,reset:now+60000};limits.set(key,value);}if(++value.count>120)return next(new Fault('RATE_LIMIT','Try again later',429));next();});
 const ok=(res:Response,data:unknown,status=200)=>res.status(status).json({ok:true,data,requestId:res.locals.requestId});
 app.post('/api/payments/webhook',express.raw({type:'application/json',limit:'64kb',inflate:false}),async(req,res)=>{
  const secret=options.webhookSecret??process.env.RAZORPAY_WEBHOOK_SECRET;
  requireThat(secret,'WEBHOOK_NOT_CONFIGURED',undefined,503);
  requireThat(Buffer.isBuffer(req.body)&&equal(signature(secret,req.body),String(req.headers['x-razorpay-signature']??'')),'INVALID_WEBHOOK_SIGNATURE');
  const hash=createHash('sha256').update(req.body).digest('hex');
  const eventId=req.get('x-razorpay-event-id')??hash;
  let parsed:unknown;
  try {parsed=JSON.parse(req.body.toString('utf8'));} catch {throw new Fault('INVALID_WEBHOOK','Invalid webhook JSON');}
  const body=z.object({event:z.string(),payload:z.unknown().optional()}).parse(parsed);
  const prior=transaction(db,()=>{
   engine.run('INSERT OR IGNORE INTO payment_webhook_events VALUES(?,?,NULL)',eventId,hash);
   return engine.one('SELECT * FROM payment_webhook_events WHERE id=?',eventId)!;
  });
  requireThat(prior.body_hash===hash,'INVALID_WEBHOOK');
  if(prior.processed_at===null){
   if(body.event==='payment.captured'||body.event==='payment.failed'){
    const payload=z.object({payment:z.object({entity:z.object({id:z.string().min(1),order_id:z.string().min(1)})})}).parse(body.payload);
    const payment=payload.payment.entity;
    const row=engine.one('SELECT p.*,h.session_id FROM payments p JOIN holds h ON h.id=p.hold_id WHERE p.order_id=?',payment.order_id);
    requireThat(row,'PAYMENT_NOT_FOUND');
    await payments.reconcile(row.clinic_id,row.session_id,row.hold_id,row.order_id,payment.id,body.event==='payment.failed');
   }
   engine.run('UPDATE payment_webhook_events SET processed_at=? WHERE id=? AND processed_at IS NULL',engine.now(),eventId);
  }
  ok(res,{received:true});
 });
 app.use(express.json({limit:'32kb'}));
 app.get('/api/health',(_req,res)=>{db.prepare('SELECT 1').get();ok(res,{database:'sqlite',status:'ok',otp:'DEVELOPMENT_ONLY',notifications:'SIMULATED',googleConfigured:!!process.env.GOOGLE_ACCESS_TOKEN,razorpayConfigured:!!process.env.RAZORPAY_KEY_ID});});
 app.post('/api/sessions',(req,res)=>{const {clinicId}=z.object({clinicId:z.string()}).parse(req.body);engine.clinic(clinicId);const id=randomBytes(32).toString('hex');engine.run('INSERT INTO sessions VALUES(?,?,?,?)',id,clinicId,engine.now(),engine.now()+86400000);ok(res,{sessionId:id,clinicId,expiresAt:new Date(engine.now()+86400000).toISOString()},201);});
 app.get('/api/clinics/:id/config',(req,res)=>{const c=engine.clinic(String(req.params.id));ok(res,{id:c.id,name:c.name,...c.config});});
 app.get('/api/clinics/:id/doctors',(req,res)=>ok(res,engine.all('SELECT id,name,schedule FROM doctors WHERE clinic_id=? AND active=1',String(req.params.id)).map(d=>({...d,schedule:JSON.parse(d.schedule)}))));
 app.get('/api/clinics/:id/services',(req,res)=>ok(res,engine.all('SELECT * FROM services WHERE clinic_id=? AND active=1',String(req.params.id))));
 app.post('/api/admin/login',(req,res)=>{const input=z.object({email:z.email(),password:z.string().min(1).max(200)}).parse(req.body),admin=engine.one('SELECT * FROM admins WHERE email=?',input.email);requireThat(admin&&equal(admin.password_hash,scryptSync(input.password,admin.salt,64).toString('hex')),'INVALID_CREDENTIALS',undefined,401);const token=randomBytes(32).toString('hex');engine.run('INSERT INTO admin_sessions VALUES(?,?,?)',hash(token),admin.clinic_id,engine.now()+3600000);ok(res,{token,clinicId:admin.clinic_id,expiresIn:3600});});
 app.use('/api/admin',(req,res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,'');const a=token&&engine.one('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?',hash(token),engine.now());if(!a)return next(new Fault('ADMIN_AUTH_REQUIRED','Admin authentication required',401));res.locals.clinic=a.clinic_id;next();});
 const adminAppointment = ({id,reference,doctor_id,service_id,start,end,state}: Record<string,unknown>) => ({id,reference,doctor_id,service_id,start,end,state});
 app.get('/api/admin/appointments',(req,res)=>{const filter=z.object({state:contracts.BookingStatus.optional(),search:z.string().max(100).optional()}).parse(req.query);ok(res,engine.all('SELECT id,reference,doctor_id,service_id,start,end,state FROM appointments WHERE clinic_id=? AND (? IS NULL OR state=?) AND (? IS NULL OR reference LIKE ?) ORDER BY start LIMIT 200',res.locals.clinic,filter.state??null,filter.state??null,filter.search??null,`%${filter.search??''}%`));});
 app.get('/api/admin/overview',(_req,res)=>ok(res,engine.all('SELECT state,COUNT(*) AS count FROM appointments WHERE clinic_id=? GROUP BY state',res.locals.clinic)));
 app.get('/api/admin/reconciliation',(_req,res)=>ok(res,engine.all(`
  SELECT j.id,j.kind,j.status,j.attempts,j.next_at AS nextAttemptAt,j.last_error AS reason,a.reference AS bookingReference
  FROM reconciliation_jobs j LEFT JOIN appointments a ON a.hold_id=j.operation_ref AND a.clinic_id=j.clinic_id
  WHERE j.clinic_id=? AND j.status<>'DONE' AND (
   (j.kind='ORDER' AND EXISTS (SELECT 1 FROM payment_order_attempts t WHERE t.hold_id=j.operation_ref AND t.started_at=j.generation))
   OR (j.kind='CAPTURE' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state IN ('CREATED','FAILED')))
   OR (j.kind='REFUND' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state='REFUND_PENDING'))
   OR EXISTS (SELECT 1 FROM booking_operations o WHERE o.booking_key=j.operation_ref AND o.kind=j.kind AND o.started_at=j.generation)
  ) ORDER BY j.next_at LIMIT 200
 `,res.locals.clinic)));
 app.get('/api/admin/config',(_req,res)=>ok(res,engine.clinic(res.locals.clinic)));
 const schedule=z.object({days:z.array(z.number().int().min(0).max(6)).min(1),start:z.number().int().min(0).max(23),end:z.number().int().min(1).max(24)}).refine(s=>s.end>s.start);
 const configPatch=z.object({holdSeconds:z.number().int().min(60).max(900).optional(),operatingHours:z.object({start:z.number().int().min(0).max(23),end:z.number().int().min(1).max(24)}).refine(s=>s.end>s.start).optional(),languages:z.array(contracts.language).min(1).optional(),branding:z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).optional(),greeting:z.string().max(500).optional(),handoff:z.string().max(100).optional(),emergency:z.string().max(500).optional(),faqs:z.array(z.object({question:z.string().max(300),answer:z.string().max(1000)})).max(50).optional(),refundCutoffHours:z.number().int().min(0).max(720).optional()}).strict();
 app.patch('/api/admin/config',(req,res)=>{const c=engine.clinic(res.locals.clinic),patch=configPatch.parse(req.body);engine.run('UPDATE clinics SET config=? WHERE id=?',JSON.stringify({...c.config,...patch}),c.id);engine.audit(c.id,'CONFIG_UPDATED',c.id);ok(res,engine.clinic(c.id));});
 app.get('/api/admin/doctors',(_req,res)=>ok(res,engine.all('SELECT * FROM doctors WHERE clinic_id=?',res.locals.clinic).map(d=>({...d,schedule:JSON.parse(d.schedule)}))));
 app.post('/api/admin/doctors',(req,res)=>{const d=z.object({name:z.string().min(1).max(100),schedule,serviceIds:z.array(z.string()).min(1)}).parse(req.body);const id=randomUUID();transaction(db,()=>{for(const s of d.serviceIds)requireThat(engine.one('SELECT id FROM services WHERE id=? AND clinic_id=?',s,res.locals.clinic),'INVALID_SERVICE');engine.run('INSERT INTO doctors VALUES(?,?,?,?,?)',id,res.locals.clinic,d.name,1,JSON.stringify(d.schedule));for(const s of d.serviceIds)engine.run('INSERT INTO doctor_services VALUES(?,?)',id,s);});ok(res,{id},201);});
 app.patch('/api/admin/doctors/:id',(req,res)=>{const p=z.object({name:z.string().min(1).max(100).optional(),active:z.boolean().optional()}).strict().parse(req.body);const id=String(req.params.id),d=engine.one('SELECT * FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic);requireThat(d,'NOT_FOUND',undefined,404);engine.run('UPDATE doctors SET name=?,active=? WHERE id=?',p.name??d.name,p.active===undefined?d.active:Number(p.active),id);ok(res,{id});});
 app.patch('/api/admin/doctors/:id/availability',(req,res)=>{const s=schedule.parse(req.body);requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',String(req.params.id),res.locals.clinic),'NOT_FOUND',undefined,404);engine.run('UPDATE doctors SET schedule=? WHERE id=?',JSON.stringify(s),String(req.params.id));ok(res,{updated:true});});
 app.get('/api/admin/services',(_req,res)=>ok(res,engine.all('SELECT * FROM services WHERE clinic_id=?',res.locals.clinic)));
 const service=z.object({name:z.string().min(1).max(100),duration:z.number().int().min(5).max(240),fee:z.number().int().min(100).max(10000000),active:z.boolean().default(true)});
 app.post('/api/admin/services',(req,res)=>{const s=service.parse(req.body),id=randomUUID();engine.run('INSERT INTO services VALUES(?,?,?,?,?,?)',id,res.locals.clinic,s.name,s.duration,s.fee,Number(s.active));ok(res,{id},201);});
 app.patch('/api/admin/services/:id',(req,res)=>{const p=service.partial().parse(req.body),id=String(req.params.id),s=engine.one('SELECT * FROM services WHERE id=? AND clinic_id=?',id,res.locals.clinic);requireThat(s,'NOT_FOUND',undefined,404);engine.run('UPDATE services SET name=?,duration=?,fee=?,active=? WHERE id=?',p.name??s.name,p.duration??s.duration,p.fee??s.fee,p.active===undefined?s.active:Number(p.active),id);ok(res,{id});});
 app.post('/api/admin/blocks',(req,res)=>{const p=z.object({doctorId:z.string().optional(),start:z.iso.datetime(),end:z.iso.datetime(),reason:z.string().max(100)}).refine(s=>s.end>s.start).parse(req.body);if(p.doctorId)requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',p.doctorId,res.locals.clinic),'INVALID_DOCTOR');const id=randomUUID();engine.run('INSERT INTO blocks VALUES(?,?,?,?,?,?)',id,res.locals.clinic,p.doctorId??null,p.start,p.end,p.reason);ok(res,{id},201);});
 for(const [path,table] of [['payments','payments'],['audit-logs','audit'],['outbox','outbox'],['blocks','blocks']])app.get(`/api/admin/${path}`,(_req,res)=>ok(res,engine.all(`SELECT * FROM ${table} WHERE clinic_id=? LIMIT 200`,res.locals.clinic)));
 app.post('/api/admin/appointments/:id/:action',async(req,res)=>{const a=engine.one('SELECT * FROM appointments WHERE id=? AND clinic_id=?',String(req.params.id),res.locals.clinic);requireThat(a,'NOT_FOUND',undefined,404);if(req.params.action==='cancel')ok(res,adminAppointment(await engine.cancel(a.clinic_id,a.session_id,a.id)));else if(req.params.action==='reschedule'){const p=contracts.holdRequest.parse(req.body);const start=new Date(p.start).toISOString();if(a.state==='CONFIRMED'&&a.start===start&&a.doctor_id===p.doctorId&&a.service_id===p.serviceId){ok(res,adminAppointment(a));return;}requireThat(!engine.one('SELECT booking_key FROM booking_operations WHERE booking_key=?',a.hold_id),'RESCHEDULE_PENDING','Booking operation pending reconciliation',503);const h=await engine.reserve(a.clinic_id,a.session_id,p);ok(res,adminAppointment(await engine.reschedule(a.clinic_id,a.session_id,a.id,h.id)));}else throw new Fault('NOT_FOUND','Unknown action',404);});
 app.use('/api',(req,res,next)=>{const clinic=String(req.headers['x-clinic-id']??''),session=String(req.headers['x-session-id']??'');const s=engine.one('SELECT * FROM sessions WHERE id=? AND clinic_id=? AND expires_at>?',session,clinic,engine.now());if(!s)return next(new Fault('SESSION_REQUIRED','Valid clinic session headers required',401));res.locals.clinic=clinic;res.locals.session=session;next();});
 app.post('/api/consent',(req,res)=>{const p=contracts.consentRequest.parse(req.body);engine.run('INSERT INTO consents VALUES(?,?,?,?,?,?)',randomUUID(),res.locals.session,res.locals.clinic,1,Number(p.briefing),engine.now());ok(res,{recorded:true});});
 app.get('/api/slots',async(req,res)=>{const p=contracts.slotQuery.parse(req.query);ok(res,await engine.available(res.locals.clinic,p.doctorId,p.serviceId,p.date));});
 app.post('/api/holds',async(req,res)=>ok(res,await engine.reserve(res.locals.clinic,res.locals.session,contracts.holdRequest.parse(req.body)),201));
 app.delete('/api/holds/:id',(req,res)=>{transaction(db,()=>{const h=engine.hold(res.locals.clinic,res.locals.session,String(req.params.id),false);requireThat(['HELD','OTP_VERIFIED','EXPIRED','CANCELLED'].includes(h.state),'INVALID_STATE');engine.run("UPDATE holds SET state='CANCELLED' WHERE id=?",h.id);});ok(res,{state:'CANCELLED'});});
 app.post('/api/otp/send',(req,res)=>{requireThat(options.otpSink&&process.env.NODE_ENV!=='production','SMS_PROVIDER_NOT_CONFIGURED',undefined,503);const p=contracts.phoneRequest.parse(req.body);ok(res,engine.sendOtp(res.locals.clinic,res.locals.session,p.holdId,p.phone));});
 app.post('/api/otp/verify',(req,res)=>{const p=contracts.otpRequest.parse(req.body);ok(res,engine.verifyOtp(res.locals.clinic,res.locals.session,p.holdId,p.phone,p.code));});
 app.post('/api/payments/order',async(req,res)=>ok(res,await payments.order(res.locals.clinic,res.locals.session,contracts.holdIdRequest.parse(req.body).holdId)));
 app.post('/api/payments/verify',async(req,res)=>ok(res,await payments.verify(res.locals.clinic,res.locals.session,contracts.paymentVerifyRequest.parse(req.body))));
 app.post('/api/bookings/confirm',async(req,res)=>ok(res,await engine.confirm(res.locals.clinic,res.locals.session,contracts.holdIdRequest.parse(req.body).holdId)));
 app.get('/api/holds/:id',(req,res)=>ok(res,engine.hold(res.locals.clinic,res.locals.session,String(req.params.id),false)));
 app.get('/api/bookings/:id',(req,res)=>ok(res,engine.booking(res.locals.clinic,res.locals.session,String(req.params.id))));
 app.post('/api/bookings/:id/cancel',async(req,res)=>ok(res,await engine.cancel(res.locals.clinic,res.locals.session,String(req.params.id))));
 app.post('/api/bookings/:id/reschedule',async(req,res)=>ok(res,await engine.reschedule(res.locals.clinic,res.locals.session,String(req.params.id),contracts.holdIdRequest.parse(req.body).holdId)));
 app.post('/api/bookings/:id/briefing',(req,res)=>ok(res,engine.briefing(res.locals.clinic,res.locals.session,String(req.params.id),contracts.briefingRequest.parse(req.body).patientReportedSummary,process.env.BRIEFING_TEST_EMAIL)));
 app.get('/api/bookings/:id/calendar.ics',(req,res)=>{const a=engine.booking(res.locals.clinic,res.locals.session,String(req.params.id));requireThat(a.state==='CONFIRMED','BOOKING_NOT_CONFIRMED');const dt=(v:string)=>v.replace(/[-:]/g,'').replace(/\.\d{3}/,'');res.type('text/calendar').setHeader('Content-Disposition','attachment; filename="appointment.ics"');res.send(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Almost Humans//Booking//EN','BEGIN:VEVENT',`UID:${a.id}@almost-humans.invalid`,`DTSTAMP:${dt(new Date(engine.now()).toISOString())}`,`DTSTART:${dt(a.start)}`,`DTEND:${dt(a.end)}`,'SUMMARY:Clinic appointment','END:VEVENT','END:VCALENDAR',''].join('\r\n'));});
 app.post('/api/chat',(_req,_res)=>{throw new Fault('AI_MODULE_NOT_CONNECTED','Nandan must connect the conversational agent using the validated tool interface',501);});
 // Mock clinic management system: real HTTP boundary, state in separate tables.
 app.use('/mock',(req,_res,next)=>{if(!equal(String(req.headers['x-mock-key']??''),options.mockKey))return next(new Fault('MOCK_AUTH_REQUIRED','Mock authentication required',401));next();});
 app.get('/mock/:clinic/bookings/:id',(req,res)=>{
  const booking=engine.one('SELECT id,doctor_id AS doctorId,start,end,state FROM mock_bookings WHERE clinic_id=? AND id=?',String(req.params.clinic),String(req.params.id));
  res.json({booking:booking??null});
 });
 app.get('/mock/:clinic/busy',(req,res)=>{const p=z.object({doctorId:z.string(),start:z.iso.datetime(),end:z.iso.datetime()}).parse(req.query);res.json(engine.all("SELECT start,end FROM mock_bookings WHERE clinic_id=? AND doctor_id=? AND state!='CANCELLED' AND (state='CONFIRMED' OR expires_at>?) AND start<? AND end>?",String(req.params.clinic),p.doctorId,engine.now(),p.end,p.start));});
 app.post('/mock/:clinic/holds',(req,res)=>{const p=contracts.holdRequest.omit({serviceId:true}).extend({id:z.uuid(),end:z.iso.datetime(),expiresAt:z.iso.datetime()}).parse(req.body);transaction(db,()=>{requireThat(!engine.one("SELECT id FROM mock_bookings WHERE clinic_id=? AND doctor_id=? AND id!=? AND state!='CANCELLED' AND (state='CONFIRMED' OR expires_at>?) AND start<? AND end>?",String(req.params.clinic),p.doctorId,p.id,engine.now(),p.end,p.start),'MOCK_CONFLICT',undefined,409);engine.run('INSERT OR IGNORE INTO mock_bookings VALUES(?,?,?,?,?,?,?)',p.id,String(req.params.clinic),p.doctorId,p.start,p.end,'HELD',Date.parse(p.expiresAt));});res.json({id:p.id});});
 app.post('/mock/:clinic/patients',(req,res)=>{const p=z.object({id:z.uuid(),phone:z.string()}).parse(req.body);engine.run('INSERT OR IGNORE INTO mock_patients VALUES(?,?,?)',p.id,String(req.params.clinic),p.phone);res.json(engine.one('SELECT id FROM mock_patients WHERE clinic_id=? AND phone=?',String(req.params.clinic),p.phone));});
 app.post('/mock/:clinic/bookings/:id/confirm',(req,res)=>{const id=String(req.params.id),clinic=String(req.params.clinic);const b=engine.one('SELECT * FROM mock_bookings WHERE id=? AND clinic_id=?',id,clinic);requireThat(b&&b.state!=='CANCELLED','MOCK_NOT_FOUND',undefined,404);requireThat(b.state==='CONFIRMED'||b.expires_at>engine.now(),'MOCK_HOLD_EXPIRED');engine.run("UPDATE mock_bookings SET state='CONFIRMED' WHERE id=?",id);res.json({id});});
 app.patch('/mock/:clinic/bookings/:id',(req,res)=>{const p=z.object({doctorId:z.string(),start:z.iso.datetime(),end:z.iso.datetime()}).parse(req.body);const id=String(req.params.id),clinic=String(req.params.clinic);transaction(db,()=>{requireThat(engine.one("SELECT id FROM mock_bookings WHERE id=? AND clinic_id=? AND state='CONFIRMED'",id,clinic),'MOCK_NOT_FOUND',undefined,404);requireThat(!engine.one("SELECT id FROM mock_bookings WHERE clinic_id=? AND doctor_id=? AND id!=? AND state='CONFIRMED' AND start<? AND end>?",clinic,p.doctorId,id,p.end,p.start),'MOCK_CONFLICT');engine.run('UPDATE mock_bookings SET start=?,end=? WHERE id=?',p.start,p.end,id);});res.json({id});});
 app.delete('/mock/:clinic/bookings/:id',(req,res)=>{requireThat(engine.one('SELECT id FROM mock_bookings WHERE id=? AND clinic_id=?',String(req.params.id),String(req.params.clinic)),'MOCK_NOT_FOUND',undefined,404);engine.run("UPDATE mock_bookings SET state='CANCELLED' WHERE id=?",String(req.params.id));res.json({cancelled:true});});
 app.use((_req,_res,next)=>next(new Fault('NOT_FOUND','Endpoint not found',404)));
 app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{const validation=err instanceof z.ZodError;const fault=err instanceof Fault;res.status(validation?400:fault?err.status:500).json({ok:false,error:{code:validation?'VALIDATION_ERROR':fault?err.code:'INTERNAL_ERROR',message:validation?'Invalid request':fault?err.message:'Request could not be completed'},requestId:res.locals.requestId});});
 return {app,engine,payments,provider};
}
