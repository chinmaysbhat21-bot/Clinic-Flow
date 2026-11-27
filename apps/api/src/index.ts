import { randomBytes } from 'node:crypto';
import { expireHolds,openDb,seed,transaction } from './db.js';
import { createApp } from './server.js';
import { configureOtpDelivery } from './otp-delivery.js';
const otpDelivery=configureOtpDelivery(process.env.NODE_ENV,process.env.OTP_MODE);
const db=openDb(process.env.DATABASE_PATH??'data/clinic.db');seed(db,process.env.ADMIN_PASSWORD);
if(!process.env.ADMIN_PASSWORD)console.warn('ADMIN_PASSWORD absent: demo administrators are not provisioned. Set it before first seed.');
const {app}=createApp(db,{mockKey:process.env.MOCK_API_KEY??randomBytes(32).toString('hex'),mockBase:process.env.MOCK_BASE_URL,origins:process.env.ALLOWED_ORIGINS?.split(','),otpSink:otpDelivery?.deliver.bind(otpDelivery)});
const timer=setInterval(()=>{
 const now=Date.now();
 transaction(db,()=>expireHolds(db,now));
},30000);timer.unref();
const server=app.listen(Number(process.env.PORT??4000),'127.0.0.1',()=>console.log(`API listening on http://127.0.0.1:${process.env.PORT??4000}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{clearInterval(timer);server.close(()=>{db.close();process.exit(0);});});
