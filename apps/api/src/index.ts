import { randomBytes } from 'node:crypto';
import { expireHolds,openDb,seed,transaction } from './db.js';
import { createApp } from './server.js';
const db=openDb(process.env.DATABASE_PATH??'data/clinic.db');seed(db,process.env.ADMIN_PASSWORD);
if(!process.env.ADMIN_PASSWORD)console.warn('ADMIN_PASSWORD absent: demo administrators are not provisioned. Set it before first seed.');
const developmentOtps=new Map<string,{code:string;expires:number}>();
const {app}=createApp(db,{mockKey:process.env.MOCK_API_KEY??randomBytes(32).toString('hex'),mockBase:process.env.MOCK_BASE_URL,origins:process.env.ALLOWED_ORIGINS?.split(','),otpSink:(id,code)=>{developmentOtps.set(id,{code,expires:Date.now()+180000});}});
// Deliberately no HTTP endpoint or logging for OTP secrets. Inspect developmentOtps with a local debugger.
const timer=setInterval(()=>{
 const now=Date.now();
 for(const [id,value] of developmentOtps)if(value.expires<=now)developmentOtps.delete(id);
 transaction(db,()=>expireHolds(db,now));
},30000);timer.unref();
const server=app.listen(Number(process.env.PORT??4000),'127.0.0.1',()=>console.log(`API listening on http://127.0.0.1:${process.env.PORT??4000}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{clearInterval(timer);server.close(()=>{db.close();process.exit(0);});});
