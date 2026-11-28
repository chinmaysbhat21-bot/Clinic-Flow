import express,{type Request,type Response,type NextFunction} from 'express';
import { emailDestinationHash, notificationEmail } from './brevo-notifications.js';
import { channels } from './notification-outbox.js';
import { RefundWorker } from './refund-worker.js';
import { buildAdminSummary,findBlockWarnings,findConfigWarnings,findDeactivationWarnings,findDoctorScheduleWarnings,isValidTimeZone,LoginLimiter,resolveReconciliation } from './admin.js';
import { clinicHour } from './clinic-time.js';
import { randomUUID,randomBytes,createHash,scryptSync } from 'node:crypto';
import { z } from 'zod';
import * as contracts from '../../../packages/shared/src/index.js';
import { buildPatientBriefing, createAgent, GeminiIntentExtractor, type AgentState, type IntentExtractor } from '../../../packages/ai-agent/src/index.js';
import { Engine,Fault,requireThat,equal,signature } from './core.js';
import { type DB,transaction } from './db.js';
import { GoogleAdapter,MockAdapter,googleCalendarId } from './adapters.js';
import { googleAuth } from './google-oauth.js';
import { Payments,RazorpayProvider,type PaymentProvider } from './payments.js';
import { executeTool } from './tools.js';
export function createApp(db:DB,options:{mockBase?:string;mockKey:string;webhookSecret?:string;otpSink?:(id:string,code:string,phone:string)=>void;provider?:PaymentProvider;now?:()=>number;origins?:string[];intentExtractor?:IntentExtractor;briefingDestination?:string} ){
 const app=express();app.disable('x-powered-by');
 const google=googleAuth(process.env);
 const engine:Engine=new Engine(db,clinic=>{
  const {adapter,config}=engine.clinic(clinic);
  if(adapter==='google')return new GoogleAdapter(google,googleCalendarId(clinic,process.env.GOOGLE_CALENDARS_JSON,process.env.GOOGLE_CALENDAR_ID),config.timezone);
  return new MockAdapter(options.mockBase??'http://127.0.0.1:4000/mock',clinic,options.mockKey);
 },options.otpSink,options.now);
 const provider=options.provider??new RazorpayProvider(process.env.RAZORPAY_KEY_ID??'',process.env.RAZORPAY_KEY_SECRET??'');
 const payments=new Payments(engine,provider);
 const refunds=new RefundWorker(db,provider,process.env.REFUND_EXECUTION_MODE==='razorpay-test',engine.now);
 const loginLimiter=new LoginLimiter();
 const intentExtractor=options.intentExtractor??(process.env.LLM_PROVIDER==='gemini'&&process.env.GEMINI_API_KEY?new GeminiIntentExtractor(process.env.GEMINI_API_KEY,process.env.GEMINI_MODEL):undefined);
 const chatAgent=intentExtractor?createAgent({executeTool:(name,input,context)=>executeTool(engine,name as contracts.ToolName,input,context)},intentExtractor,{now:()=>new Date(engine.now()),timezone:'Asia/Kolkata',onExtractionFailure:diagnostic=>console.warn('[ai-agent] extraction failed',diagnostic)}):undefined;
 const chatStates=new Map<string,{state:AgentState;expiresAt:number}>();
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 app.use((req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const origin=req.headers.origin;if(origin){if(!(options.origins??['http://localhost:5173','http://localhost:5174']).includes(origin))return next(new Fault('ORIGIN_NOT_ALLOWED','Origin not allowed',403));res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Clinic-Id, X-Session-Id');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');}if(req.method==='OPTIONS'){res.sendStatus(204);return;}next();});
 const limits=new Map<string,{count:number;reset:number}>();app.use((req,res,next)=>{const key=req.socket.remoteAddress??'unknown',now=Date.now();if(limits.size>10000)for(const [k,v] of limits)if(v.reset<now)limits.delete(k);let value=limits.get(key);if(!value||value.reset<now){value={count:0,reset:now+60000};limits.set(key,value);}if(++value.count>120)return next(new Fault('RATE_LIMIT','Try again later',429));next();});
 const ok=(res:Response,data:unknown,status=200)=>res.status(status).json({ok:true,data,requestId:res.locals.requestId});
 const providerId=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
 const paymentEntity=z.object({id:providerId,order_id:providerId});
 const refundEntity=z.object({id:providerId,payment_id:providerId});
 app.post('/api/payments/webhook',express.raw({type:'application/json',limit:'64kb',inflate:false}),async(req:Request,res:Response)=>{
  const secret=options.webhookSecret??process.env.RAZORPAY_WEBHOOK_SECRET;
  requireThat(secret?.trim()&&!equal(secret,provider.secret),'WEBHOOK_NOT_CONFIGURED',undefined,503);
  const provided=req.get('x-razorpay-signature')??'';
  requireThat(Buffer.isBuffer(req.body)&&/^[0-9a-f]{64}$/i.test(provided)&&
   equal(signature(secret!,req.body),provided.toLowerCase()),'INVALID_WEBHOOK_SIGNATURE');
  const hash=createHash('sha256').update(req.body).digest('hex');
  const eventId=req.get('x-razorpay-event-id')??hash;
  requireThat(/^[A-Za-z0-9_-]{1,128}$/.test(eventId),'INVALID_WEBHOOK');
  let parsed:unknown;
  try {parsed=JSON.parse(req.body.toString('utf8'));} catch {throw new Fault('INVALID_WEBHOOK','Invalid webhook JSON');}
  const body=z.object({event:z.string().min(1).max(128),payload:z.unknown().optional()}).parse(parsed);
  let paymentId:string|null=null,orderId:string|null=null,refundId:string|null=null;
  if(['payment.captured','payment.failed','order.paid'].includes(body.event)){
   const payload=z.object({payment:z.object({entity:paymentEntity}),order:z.object({entity:z.object({id:providerId})}).optional()}).parse(body.payload);
   paymentId=payload.payment.entity.id;
   orderId=payload.payment.entity.order_id;
   if(body.event==='order.paid')requireThat(payload.order?.entity.id===orderId,'INVALID_WEBHOOK');
  }else if(['refund.created','refund.processed','refund.failed','refund.speed_changed'].includes(body.event)){
   const {refund}=z.object({refund:z.object({entity:refundEntity})}).parse(body.payload);
   paymentId=refund.entity.payment_id;
   refundId=refund.entity.id;
  }
  try{
   transaction(db,()=>{
    const prior=engine.one('SELECT body_hash,processed_at,event_type FROM payment_webhook_events WHERE id=?',eventId);
    if(prior)requireThat(prior.body_hash===hash,'INVALID_WEBHOOK');
    if(prior&&(prior.processed_at!==null||prior.event_type!==null))return;
    const now=engine.now();
    let clinicId:string|undefined;
    if(paymentId){
     const row=orderId
      ? engine.one('SELECT p.clinic_id FROM payments p JOIN holds h ON h.id=p.hold_id AND h.clinic_id=p.clinic_id WHERE p.order_id=?',orderId)
      : engine.one('SELECT p.clinic_id FROM payments p JOIN holds h ON h.id=p.hold_id AND h.clinic_id=p.clinic_id WHERE p.payment_id=?',paymentId);
     requireThat(row,'WEBHOOK_PAYMENT_UNMAPPED','Webhook payment mapping is not available',503);
     clinicId=String(row.clinic_id);
    }
    engine.run(`INSERT INTO payment_webhook_events(id,body_hash,processed_at,event_type,payment_id,order_id,refund_id)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET processed_at=excluded.processed_at,
     event_type=excluded.event_type,payment_id=excluded.payment_id,order_id=excluded.order_id,refund_id=excluded.refund_id`,
     eventId,hash,paymentId?null:now,body.event,paymentId,orderId,refundId);
    if(clinicId)engine.run(`INSERT INTO reconciliation_jobs(id,clinic_id,kind,operation_ref,generation,next_at)
     VALUES(?,?,'WEBHOOK',?,0,?)`,randomUUID(),clinicId,eventId,now);
   });
  }catch(error){
   if(error instanceof Fault)throw error;
   throw new Fault('WEBHOOK_PERSISTENCE_UNAVAILABLE','Webhook storage is unavailable',503);
  }
  ok(res,{received:true});
 },(err:unknown,_req:Request,_res:Response,next:NextFunction)=>{
  const type=(err as {type?:string})?.type;
  if(type==='entity.too.large')return next(new Fault('WEBHOOK_BODY_TOO_LARGE','Webhook body exceeds 64 KiB',413));
  if(type==='encoding.unsupported')return next(new Fault('WEBHOOK_ENCODING_UNSUPPORTED','Webhook body must be uncompressed',415));
  next(err);
 });
 app.use(express.json({limit:'32kb'}));
 app.get('/api/health',(_req,res)=>{db.prepare('SELECT 1').get();ok(res,{database:'sqlite',status:'ok',otp:'DEVELOPMENT_ONLY',notifications:'SIMULATED',googleConfigured:!!google,razorpayConfigured:!!process.env.RAZORPAY_KEY_ID});});
 app.post('/api/sessions',(req,res)=>{const {clinicId}=z.object({clinicId:z.string()}).parse(req.body);engine.clinic(clinicId);const id=randomBytes(32).toString('hex');engine.run('INSERT INTO sessions VALUES(?,?,?,?)',id,clinicId,engine.now(),engine.now()+86400000);ok(res,{sessionId:id,clinicId,expiresAt:new Date(engine.now()+86400000).toISOString()},201);});
 app.get('/api/clinics/:id/config',(req,res)=>{const c=engine.clinic(String(req.params.id));ok(res,{id:c.id,name:c.name,...c.config});});
 app.get('/api/clinics/:id/doctors',(req,res)=>ok(res,engine.all('SELECT id,name,specialization,schedule FROM doctors WHERE clinic_id=? AND active=1',String(req.params.id)).map(d=>({...d,schedule:JSON.parse(d.schedule)}))));
 app.get('/api/clinics/:id/services',(req,res)=>ok(res,engine.all('SELECT * FROM services WHERE clinic_id=? AND active=1',String(req.params.id))));

 // ── Admin authentication ──────────────────────────────────────────────────
 app.post('/api/admin/login',(req,res)=>{
  const input=z.object({email:z.email(),password:z.string().min(1).max(200)}).parse(req.body);
  const now=engine.now();
  loginLimiter.check(input.email,now);
  const admin=engine.one('SELECT * FROM admins WHERE email=?',input.email);
  if(!admin||!equal(admin.password_hash,scryptSync(input.password,admin.salt,64).toString('hex'))){
   loginLimiter.fail(input.email,now);
   throw new Fault('INVALID_CREDENTIALS','Invalid email or password',401);
  }
  loginLimiter.clear(input.email);
  const token=randomBytes(32).toString('hex');
  const adminId=String(admin.id),role=String(admin.role);
  engine.run('INSERT INTO admin_sessions(token_hash,clinic_id,expires_at,admin_id) VALUES(?,?,?,?)',hash(token),admin.clinic_id,now+3600000,adminId);
  engine.auditDetails(admin.clinic_id,'ADMIN_LOGIN',adminId,adminId);
  ok(res,{token,clinicId:admin.clinic_id,adminId,role,expiresIn:3600});
 });

 // ── Admin middleware: validate session and populate locals ────────────────
 app.use('/api/admin',(req,res,next)=>{
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization??'')?.[1];
  const a=token&&engine.one('SELECT s.*,a.role FROM admin_sessions s JOIN admins a ON a.id=s.admin_id AND a.clinic_id=s.clinic_id WHERE s.token_hash=? AND s.expires_at>?',hash(token),engine.now());
  if(!a)return next(new Fault('ADMIN_AUTH_REQUIRED','Admin authentication required',401));
  res.locals.clinic=a.clinic_id;
  res.locals.adminId=String(a.admin_id);
  res.locals.adminRole=String(a.role);
  res.locals.adminTokenHash=a.token_hash;
  next();
 });

 // ── Admin logout ──────────────────────────────────────────────────────────
 app.delete('/api/admin/session',(req,res)=>{
  engine.run('DELETE FROM admin_sessions WHERE token_hash=?',res.locals.adminTokenHash);
  engine.auditDetails(res.locals.clinic,'ADMIN_LOGOUT',res.locals.adminId,res.locals.adminId);
  ok(res,{loggedOut:true});
 });

 // ── Admin appointments ────────────────────────────────────────────────────
 const adminAppointment=({id,reference,doctor_id,service_id,start,end,state}:Record<string,unknown>)=>({id,reference,doctor_id,service_id,start,end,state});
 app.get('/api/admin/appointments',(req,res)=>{
  const filter=z.object({
   state:contracts.BookingStatus.optional(),
   search:z.string().max(100).optional(),
   from:z.iso.date().optional(),
   to:z.iso.date().optional(),
   doctorId:z.string().optional(),
  }).refine(q=>!q.from||!q.to||q.from<=q.to).parse(req.query);
  const zone=engine.clinic(res.locals.clinic).config.timezone;
  const fromMs=filter.from?clinicHour(filter.from,0,zone):null;
  const toMs=filter.to?clinicHour(filter.to,24,zone):null;
  requireThat(fromMs!==undefined&&toMs!==undefined,'INVALID_DATE_RANGE');
  ok(res,engine.all(
   `SELECT id,reference,doctor_id,service_id,start,end,state FROM appointments
    WHERE clinic_id=?
    AND (? IS NULL OR state=?)
    AND (? IS NULL OR reference LIKE ?)
    AND (? IS NULL OR doctor_id=?)
    AND (? IS NULL OR start>=?)
    AND (? IS NULL OR start<?)
    ORDER BY start LIMIT 200`,
   res.locals.clinic,
   filter.state??null,filter.state??null,
   filter.search??null,`%${filter.search??''}%`,
   filter.doctorId??null,filter.doctorId??null,
   fromMs===null?null:fromMs,fromMs===null?null:new Date(fromMs).toISOString(),
   toMs===null?null:toMs,toMs===null?null:new Date(toMs).toISOString(),
  ));
 });
 app.get('/api/admin/appointments/:id',(req,res)=>{
  const a=engine.one(`SELECT a.*,b.summary AS patientBriefing FROM appointments a
   LEFT JOIN briefings b ON b.appointment_id=a.id AND b.clinic_id=a.clinic_id AND a.state='CONFIRMED' AND 1=(
    SELECT CASE WHEN c.booking=1 AND c.briefing=1 THEN 1 ELSE 0 END FROM consents c
    WHERE c.clinic_id=a.clinic_id AND c.session_id=a.session_id ORDER BY c.created_at DESC,c.rowid DESC LIMIT 1)
   WHERE a.id=? AND a.clinic_id=?`,String(req.params.id),res.locals.clinic);
  requireThat(a,'NOT_FOUND',undefined,404);
  ok(res,contracts.adminAppointmentDetail.parse({...a,patientBriefing:a.patientBriefing??undefined}));
 });

 // ── Admin overview / summary ──────────────────────────────────────────────
 app.get('/api/admin/overview',(_req,res)=>ok(res,engine.all('SELECT state,COUNT(*) AS count FROM appointments WHERE clinic_id=? GROUP BY state',res.locals.clinic)));
 app.get('/api/admin/summary',(_req,res)=>ok(res,buildAdminSummary(engine,res.locals.clinic)));

 // ── Reconciliation ────────────────────────────────────────────────────────
 app.get('/api/admin/reconciliation',(_req,res)=>ok(res,engine.all(`
  SELECT j.id,j.kind,j.status,j.attempts,j.next_at AS nextAttemptAt,j.last_error AS reason,a.reference AS bookingReference
  FROM reconciliation_jobs j LEFT JOIN appointments a ON a.hold_id=j.operation_ref AND a.clinic_id=j.clinic_id
  WHERE j.clinic_id=? AND j.status<>'DONE' AND (
   (j.kind='ORDER' AND EXISTS (SELECT 1 FROM payment_order_attempts t WHERE t.hold_id=j.operation_ref AND t.started_at=j.generation))
   OR (j.kind='CAPTURE' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state IN ('CREATED','FAILED')))
   OR j.kind='WEBHOOK'
   OR (j.kind='REFUND' AND EXISTS (SELECT 1 FROM payments p WHERE p.hold_id=j.operation_ref AND p.state='REFUND_PENDING'))
   OR EXISTS (SELECT 1 FROM booking_operations o WHERE o.booking_key=j.operation_ref AND o.kind=j.kind AND o.started_at=j.generation)
  ) ORDER BY j.next_at LIMIT 200
 `,res.locals.clinic)));

 app.post('/api/admin/reconciliation/:id/resolve',async(req,res)=>{
  const p=z.object({reason:z.string().min(1).max(500)}).parse(req.body);
  ok(res,await resolveReconciliation(engine,payments,provider,refunds,res.locals.clinic,res.locals.adminId,String(req.params.id),{action:'RESOLVE',reason:p.reason}));
 });
 app.post('/api/admin/reconciliation/:id/requeue',async(req,res)=>{
  const p=z.object({reason:z.string().min(1).max(500)}).parse(req.body);
  ok(res,await resolveReconciliation(engine,payments,provider,refunds,res.locals.clinic,res.locals.adminId,String(req.params.id),{action:'REQUEUE',reason:p.reason}));
 });

 // ── Config ────────────────────────────────────────────────────────────────
 app.get('/api/admin/config',(_req,res)=>ok(res,engine.clinic(res.locals.clinic)));
 const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
 const breakRule=z.object({start:time,end:time,days:z.array(z.number().int().min(0).max(6)).optional()}).refine(b=>b.start<b.end);
 const holidayRule=z.object({date:z.iso.date(),reason:z.string().max(100).optional()});
 const schedule=z.object({days:z.array(z.number().int().min(0).max(6)).min(1),start:z.number().int().min(0).max(23),end:z.number().int().min(1).max(24),breaks:z.array(breakRule).optional()}).refine(s=>s.end>s.start);
 const configPatch=z.object({
  holdSeconds:z.number().int().min(60).max(900).optional(),
  operatingHours:z.object({start:z.number().int().min(0).max(23),end:z.number().int().min(1).max(24)}).refine(s=>s.end>s.start).optional(),
  languages:z.array(contracts.language).min(1).optional(),
  branding:z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).optional(),
  greeting:z.string().max(500).optional(),
  handoff:z.string().max(100).optional(),
  emergency:z.string().max(500).optional(),
  faqs:z.array(z.object({question:z.string().max(300),answer:z.string().max(1000)})).max(50).optional(),
  refundCutoffHours:z.number().int().min(0).max(720).optional(),
  timezone:z.string().optional(),
  holidays:z.array(holidayRule).max(100).optional(),
  breaks:z.array(breakRule).max(50).optional(),
 }).strict();
 app.patch('/api/admin/config',(req,res)=>{
  const c=engine.clinic(res.locals.clinic),patch=configPatch.parse(req.body);
  if(patch.timezone!==undefined)requireThat(isValidTimeZone(patch.timezone),'INVALID_TIMEZONE','Invalid IANA timezone');
  engine.run('UPDATE clinics SET config=? WHERE id=?',JSON.stringify({...c.config,...patch}),c.id);
  engine.auditDetails(c.id,'CONFIG_UPDATED',c.id,res.locals.adminId,{fields:Object.keys(patch)});
  const warnings=findConfigWarnings(engine,c.id);
  ok(res,{...engine.clinic(c.id),warnings});
 });

 // ── Doctors ───────────────────────────────────────────────────────────────
 app.get('/api/admin/doctors',(_req,res)=>ok(res,engine.all('SELECT * FROM doctors WHERE clinic_id=?',res.locals.clinic).map(d=>({...d,schedule:JSON.parse(d.schedule)}))));
 app.post('/api/admin/doctors',(req,res)=>{
  const d=z.object({name:z.string().min(1).max(100),specialization:z.string().max(100).default(''),schedule,serviceIds:z.array(z.string()).min(1)}).parse(req.body);
  const id=randomUUID();
  transaction(db,()=>{
   for(const s of d.serviceIds)requireThat(engine.one('SELECT id FROM services WHERE id=? AND clinic_id=?',s,res.locals.clinic),'INVALID_SERVICE');
   engine.run('INSERT INTO doctors(id,clinic_id,name,active,schedule,specialization) VALUES(?,?,?,?,?,?)',id,res.locals.clinic,d.name,1,JSON.stringify(d.schedule),d.specialization);
   for(const s of d.serviceIds)engine.run('INSERT INTO doctor_services VALUES(?,?)',id,s);
  });
  engine.auditDetails(res.locals.clinic,'DOCTOR_CREATED',id,res.locals.adminId,{name:d.name});
  ok(res,{id},201);
 });
 app.patch('/api/admin/doctors/:id',(req,res)=>{
  const p=z.object({name:z.string().min(1).max(100).optional(),specialization:z.string().max(100).optional(),active:z.boolean().optional()}).strict().parse(req.body);
  const id=String(req.params.id),d=engine.one('SELECT * FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic);
  requireThat(d,'NOT_FOUND',undefined,404);
  engine.run('UPDATE doctors SET name=?,specialization=?,active=? WHERE id=?',p.name??d.name,p.specialization??d.specialization,p.active===undefined?d.active:Number(p.active),id);
  engine.auditDetails(res.locals.clinic,'DOCTOR_UPDATED',id,res.locals.adminId,{fields:Object.keys(p)});
  const warnings=p.active===false?findDeactivationWarnings(engine,res.locals.clinic,'doctor_id',id,'DOCTOR_DEACTIVATED'):[];
  ok(res,{id,warnings});
 });
 app.patch('/api/admin/doctors/:id/availability',(req,res)=>{
  const s=schedule.parse(req.body);
  const id=String(req.params.id);
  requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic),'NOT_FOUND',undefined,404);
  engine.run('UPDATE doctors SET schedule=? WHERE id=?',JSON.stringify(s),id);
  engine.auditDetails(res.locals.clinic,'DOCTOR_SCHEDULE_UPDATED',id,res.locals.adminId);
  const warnings=findDoctorScheduleWarnings(engine,res.locals.clinic,id,s);
  ok(res,{updated:true,warnings});
 });
 app.get('/api/admin/doctors/:id/services',(req,res)=>{
  const id=String(req.params.id);
  requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic),'NOT_FOUND',undefined,404);
  ok(res,engine.all('SELECT s.* FROM services s JOIN doctor_services ds ON ds.service_id=s.id WHERE ds.doctor_id=?',id));
 });
 app.post('/api/admin/doctors/:id/services',(req,res)=>{
  const id=String(req.params.id);
  requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic),'NOT_FOUND',undefined,404);
  const {serviceId}=z.object({serviceId:z.string()}).parse(req.body);
  requireThat(engine.one('SELECT id FROM services WHERE id=? AND clinic_id=?',serviceId,res.locals.clinic),'INVALID_SERVICE');
  engine.run('INSERT OR IGNORE INTO doctor_services VALUES(?,?)',id,serviceId);
  engine.auditDetails(res.locals.clinic,'DOCTOR_SERVICE_ASSIGNED',id,res.locals.adminId,{serviceId});
  ok(res,{assigned:true});
 });
 app.delete('/api/admin/doctors/:id/services/:serviceId',(req,res)=>{
  const id=String(req.params.id),serviceId=String(req.params.serviceId);
  requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',id,res.locals.clinic),'NOT_FOUND',undefined,404);
  engine.run('DELETE FROM doctor_services WHERE doctor_id=? AND service_id=?',id,serviceId);
  engine.auditDetails(res.locals.clinic,'DOCTOR_SERVICE_UNASSIGNED',id,res.locals.adminId,{serviceId});
  ok(res,{unassigned:true});
 });

 // ── Services ──────────────────────────────────────────────────────────────
 app.get('/api/admin/services',(_req,res)=>ok(res,engine.all('SELECT * FROM services WHERE clinic_id=?',res.locals.clinic)));
 const serviceFields=z.object({name:z.string().min(1).max(100),duration:z.number().int().min(5).max(240),fee:z.number().int().min(100).max(10000000),active:z.boolean(),description:z.string().max(500)});
 const serviceSchema=serviceFields.extend({active:z.boolean().default(true),description:z.string().max(500).default('')});
 app.post('/api/admin/services',(req,res)=>{
  const s=serviceSchema.parse(req.body),id=randomUUID();
  engine.run('INSERT INTO services(id,clinic_id,name,duration,fee,active,description) VALUES(?,?,?,?,?,?,?)',id,res.locals.clinic,s.name,s.duration,s.fee,Number(s.active),s.description);
  engine.auditDetails(res.locals.clinic,'SERVICE_CREATED',id,res.locals.adminId,{name:s.name});
  ok(res,{id},201);
 });
 app.patch('/api/admin/services/:id',(req,res)=>{
  const p=serviceFields.partial().parse(req.body),id=String(req.params.id);
  const s=engine.one('SELECT * FROM services WHERE id=? AND clinic_id=?',id,res.locals.clinic);
  requireThat(s,'NOT_FOUND',undefined,404);
  engine.run('UPDATE services SET name=?,duration=?,fee=?,active=?,description=? WHERE id=?',p.name??s.name,p.duration??s.duration,p.fee??s.fee,p.active===undefined?s.active:Number(p.active),p.description??s.description,id);
  engine.auditDetails(res.locals.clinic,'SERVICE_UPDATED',id,res.locals.adminId,{fields:Object.keys(p)});
  const warnings=p.active===false?findDeactivationWarnings(engine,res.locals.clinic,'service_id',id,'SERVICE_DEACTIVATED'):[];
  ok(res,{id,warnings});
 });

 // ── Blocks ────────────────────────────────────────────────────────────────
 app.post('/api/admin/blocks',(req,res)=>{
  const p=z.object({doctorId:z.string().optional(),start:z.iso.datetime(),end:z.iso.datetime(),reason:z.string().max(100)}).refine(s=>s.end>s.start).parse(req.body);
  if(p.doctorId)requireThat(engine.one('SELECT id FROM doctors WHERE id=? AND clinic_id=?',p.doctorId,res.locals.clinic),'INVALID_DOCTOR');
  const id=randomUUID();
  engine.run('INSERT INTO blocks VALUES(?,?,?,?,?,?)',id,res.locals.clinic,p.doctorId??null,p.start,p.end,p.reason);
  engine.auditDetails(res.locals.clinic,'BLOCK_CREATED',id,res.locals.adminId);
  const warnings=findBlockWarnings(engine,res.locals.clinic,p.doctorId,p.start,p.end);
  ok(res,{id,warnings},201);
 });
 app.delete('/api/admin/blocks/:id',(req,res)=>{
  const id=String(req.params.id);
  requireThat(engine.one('SELECT id FROM blocks WHERE id=? AND clinic_id=?',id,res.locals.clinic),'NOT_FOUND',undefined,404);
  engine.run('DELETE FROM blocks WHERE id=? AND clinic_id=?',id,res.locals.clinic);
  engine.auditDetails(res.locals.clinic,'BLOCK_DELETED',id,res.locals.adminId);
  ok(res,{deleted:true});
 });

 // ── Read-only admin lists ──────────────────────────────────────────────────
 for(const [path,table] of [['payments','payments'],['blocks','blocks']])app.get(`/api/admin/${path}`,(_req,res)=>ok(res,engine.all(`SELECT * FROM ${table} WHERE clinic_id=? LIMIT 200`,res.locals.clinic)));
 app.get('/api/admin/audit-logs',(_req,res)=>ok(res,engine.all(`
  SELECT a.*,d.actor_id FROM audit a LEFT JOIN audit_details d ON d.audit_id=a.id
  WHERE a.clinic_id=? ORDER BY a.created_at DESC,a.id LIMIT 200
 `,res.locals.clinic)));
 app.get('/api/admin/outbox',(_req,res)=>ok(res,engine.all(`
  SELECT o.id,o.clinic_id,o.appointment_id,o.kind,NULL AS destination,o.payload,
   COALESCE(j.status,o.status) AS status,j.last_error AS error
  FROM outbox o LEFT JOIN notification_jobs j ON j.id=o.id WHERE o.clinic_id=? LIMIT 200
 `,res.locals.clinic)));
 app.get('/api/admin/notifications',(_req,res)=>ok(res,engine.all(`
  SELECT j.id,j.event,j.channel,j.status,j.attempts,j.scheduled_at AS scheduledAt,
   CASE WHEN j.status='PENDING' THEN j.next_at ELSE NULL END AS nextAttemptAt,
   j.last_error AS reason,a.reference AS bookingReference
  FROM notification_jobs j JOIN outbox o ON o.id=j.id
  LEFT JOIN appointments a ON a.id=o.appointment_id AND a.clinic_id=o.clinic_id
  WHERE o.clinic_id=? ORDER BY j.scheduled_at DESC,j.id LIMIT 200
 `,res.locals.clinic)));
 app.get('/api/admin/refunds',(_req,res)=>ok(res,engine.all(`
  SELECT r.id,r.amount,r.currency,r.reason,r.status,r.attempts,r.last_error AS reviewReason,
   r.created_at AS createdAt,r.completed_at AS completedAt,a.reference AS bookingReference
  FROM refund_operations r LEFT JOIN appointments a ON a.id=r.appointment_id AND a.clinic_id=r.clinic_id
  WHERE r.clinic_id=? ORDER BY r.created_at DESC,r.id LIMIT 200
 `,res.locals.clinic)));

 // ── Admin appointment actions ─────────────────────────────────────────────
 app.post('/api/admin/appointments/:id/:action',async(req,res)=>{const a=engine.one('SELECT * FROM appointments WHERE id=? AND clinic_id=?',String(req.params.id),res.locals.clinic);requireThat(a,'NOT_FOUND',undefined,404);if(req.params.action==='cancel')ok(res,adminAppointment(await engine.cancel(a.clinic_id,a.session_id,a.id)));else if(req.params.action==='reschedule'){const p=contracts.holdRequest.parse(req.body);const start=new Date(p.start).toISOString();if(a.state==='CONFIRMED'&&a.start===start&&a.doctor_id===p.doctorId&&a.service_id===p.serviceId){ok(res,adminAppointment(a));return;}requireThat(!engine.one('SELECT booking_key FROM booking_operations WHERE booking_key=?',a.hold_id),'RESCHEDULE_PENDING','Booking operation pending reconciliation',503);const h=await engine.reserve(a.clinic_id,a.session_id,p);ok(res,adminAppointment(await engine.reschedule(a.clinic_id,a.session_id,a.id,h.id)));}else throw new Fault('NOT_FOUND','Unknown action',404);});

 // ── Patient session middleware ─────────────────────────────────────────────
 app.use('/api',(req,res,next)=>{const clinic=String(req.headers['x-clinic-id']??''),session=String(req.headers['x-session-id']??'');const s=engine.one('SELECT * FROM sessions WHERE id=? AND clinic_id=? AND expires_at>?',session,clinic,engine.now());if(!s)return next(new Fault('SESSION_REQUIRED','Valid clinic session headers required',401));res.locals.clinic=clinic;res.locals.session=session;next();});
 app.post('/api/consent',(req,res)=>{const p=contracts.consentRequest.parse(req.body);engine.run('INSERT INTO consents VALUES(?,?,?,?,?,?)',randomUUID(),res.locals.session,res.locals.clinic,1,Number(p.briefing),engine.now());ok(res,{recorded:true});});
 app.post('/api/notification-preferences',(req,res)=>{
  const {email,...p}=z.object({enabled:z.boolean(),channel:z.enum(channels).default('CONSOLE'),
   language:contracts.language.default('en'),email:notificationEmail.optional()}).strict().parse(req.body);
  const destination=p.enabled&&p.channel==='EMAIL'&&email?emailDestinationHash(email):null;
  engine.run(`INSERT INTO notification_preferences(session_id,clinic_id,enabled,channel,language,email_destination_hash) VALUES(?,?,?,?,?,?)
   ON CONFLICT(session_id) DO UPDATE SET enabled=excluded.enabled,channel=excluded.channel,language=excluded.language,email_destination_hash=excluded.email_destination_hash
   WHERE notification_preferences.clinic_id=excluded.clinic_id`,res.locals.session,res.locals.clinic,Number(p.enabled),p.channel,p.language,destination);
  ok(res,p);
 });
 app.get('/api/slots',async(req,res)=>{const p=contracts.slotQuery.parse(req.query);ok(res,await engine.available(res.locals.clinic,p.doctorId,p.serviceId,p.date));});
 app.post('/api/holds',async(req,res)=>ok(res,await engine.reserve(res.locals.clinic,res.locals.session,contracts.holdRequest.parse(req.body)),201));
 app.delete('/api/holds/:id',(req,res)=>{transaction(db,()=>{const h=engine.hold(res.locals.clinic,res.locals.session,String(req.params.id),false);requireThat(['HELD','OTP_VERIFIED','EXPIRED','CANCELLED'].includes(h.state),'INVALID_STATE');engine.run("UPDATE holds SET state='CANCELLED' WHERE id=?",h.id);});ok(res,{state:'CANCELLED'});});
 app.post('/api/otp/send',(req,res)=>{requireThat(options.otpSink&&process.env.NODE_ENV!=='production','SMS_PROVIDER_NOT_CONFIGURED',undefined,503);const p=contracts.phoneRequest.parse(req.body);ok(res,engine.sendOtp(res.locals.clinic,res.locals.session,p.holdId,p.phone));});
 app.post('/api/otp/verify',(req,res)=>{const p=contracts.otpRequest.parse(req.body);ok(res,engine.verifyOtp(res.locals.clinic,res.locals.session,p.holdId,p.phone,p.code));});
 app.post('/api/payments/order',async(req,res)=>ok(res,await payments.order(res.locals.clinic,res.locals.session,contracts.holdIdRequest.parse(req.body).holdId)));
 app.post('/api/payments/verify',async(req,res)=>ok(res,await payments.verify(res.locals.clinic,res.locals.session,contracts.paymentVerifyRequest.parse(req.body))));
 app.post('/api/bookings/confirm',async(req,res)=>{
  const {holdId}=contracts.holdIdRequest.parse(req.body);
  const booking=await engine.confirm(res.locals.clinic,res.locals.session,holdId);
  ok(res,contracts.patientAppointmentConfirmation.parse(booking));
 });
 app.get('/api/holds/:id',(req,res)=>ok(res,engine.hold(res.locals.clinic,res.locals.session,String(req.params.id),false)));
 app.get('/api/holds/:id/refund',(req,res)=>{
  const hold=engine.hold(res.locals.clinic,res.locals.session,String(req.params.id),false);
  const refund=engine.one(`SELECT r.status,r.amount,r.currency,r.completed_at AS completedAt
   FROM refund_operations r JOIN payments p ON p.id=r.payment_ref AND p.clinic_id=r.clinic_id
   WHERE p.clinic_id=? AND p.hold_id=?`,hold.clinic_id,hold.id);
  const payment=engine.one('SELECT state,currency,amount FROM payments WHERE clinic_id=? AND hold_id=?',hold.clinic_id,hold.id);
  ok(res,refund??(payment?.state==='REFUND_PENDING'?
   {status:'MANUAL',amount:payment.amount,currency:payment.currency,completedAt:null}:
   {status:'NOT_APPLICABLE',amount:null,currency:null,completedAt:null}));
 });
 app.get('/api/bookings/:id',(req,res)=>ok(res,engine.booking(res.locals.clinic,res.locals.session,String(req.params.id))));
 app.post('/api/bookings/:id/cancel',async(req,res)=>ok(res,await engine.cancel(res.locals.clinic,res.locals.session,String(req.params.id))));
 app.post('/api/bookings/:id/reschedule',async(req,res)=>ok(res,await engine.reschedule(res.locals.clinic,res.locals.session,String(req.params.id),contracts.holdIdRequest.parse(req.body).holdId)));
 app.post('/api/bookings/:id/briefing',(req,res)=>ok(res,engine.briefing(res.locals.clinic,res.locals.session,String(req.params.id),contracts.briefingRequest.parse(req.body).patientReportedSummary,process.env.BRIEFING_TEST_EMAIL)));
 app.get('/api/bookings/:id/calendar.ics',(req,res)=>{const a=engine.booking(res.locals.clinic,res.locals.session,String(req.params.id));requireThat(a.state==='CONFIRMED','BOOKING_NOT_CONFIRMED');const dt=(v:string)=>v.replace(/[-:]/g,'').replace(/\.\d{3}/,'');res.type('text/calendar').setHeader('Content-Disposition','attachment; filename="appointment.ics"');res.send(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Almost Humans//Booking//EN','BEGIN:VEVENT',`UID:${a.id}@almost-humans.invalid`,`DTSTAMP:${dt(new Date(engine.now()).toISOString())}`,`DTSTART:${dt(a.start)}`,`DTEND:${dt(a.end)}`,'SUMMARY:Clinic appointment','END:VEVENT','END:VCALENDAR',''].join('\r\n'));});
 app.post('/api/chat',async(req,res,next)=>{try{requireThat(chatAgent,'AI_MODULE_NOT_CONNECTED','Conversational agent provider is not configured',501);const input=z.object({message:z.string().trim().min(1).max(4000),language:contracts.language}).strict().parse(req.body);const now=engine.now();for(const [key,value] of chatStates)if(value.expiresAt<=now)chatStates.delete(key);const key=`${res.locals.clinic}:${res.locals.session}`;const prior=chatStates.get(key)?.state;const result=await chatAgent.handle(input,{clinicId:res.locals.clinic,sessionId:res.locals.session},prior);if(result.briefingCandidate){try{engine.consent(res.locals.clinic,res.locals.session,true);const bookings=engine.all("SELECT id FROM appointments WHERE clinic_id=? AND session_id=? AND state='CONFIRMED' LIMIT 2",res.locals.clinic,res.locals.session);if(bookings.length===1){const [booking]=bookings;const briefing=buildPatientBriefing({patientReportedConcern:result.briefingCandidate,bookingConfirmed:true,consentRecorded:true});if(briefing)engine.briefing(res.locals.clinic,res.locals.session,booking.id,`${briefing.concern}\n\n${briefing.disclaimer}`,options.briefingDestination??process.env.BRIEFING_TEST_EMAIL);}}catch{/* Optional briefing is dropped unless both backend consent and a confirmed booking are present. */}}const actions=result.actions.map(action=>contracts.ChatAction.parse(action));if(chatStates.size>=10000&&!chatStates.has(key))chatStates.delete(chatStates.keys().next().value!);chatStates.set(key,{state:result.state,expiresAt:now+86400000});ok(res,{message:result.message,language:result.language,actions});}catch(error){next(error);}});
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
 return {app,engine,payments,provider,refunds};
}
