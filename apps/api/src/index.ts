import { randomBytes } from 'node:crypto';
import { expireHolds,openDb,seed,transaction } from './db.js';
import { createApp } from './server.js';
import { configureOtpDelivery } from './otp-delivery.js';
import { ReconciliationWorker } from './reconciliation.js';
import { configureNotificationDelivery,NotificationWorker } from './notification-worker.js';
import { configureBrevo } from './brevo-notifications.js';
import { reminderMinutes } from './notification-outbox.js';
const otpDelivery=configureOtpDelivery(process.env.NODE_ENV,process.env.OTP_MODE);
const notificationProvider=process.env.NOTIFICATION_MODE==='brevo'
 ? configureBrevo(process.env.NODE_ENV,process.env)
 : configureNotificationDelivery(process.env.NODE_ENV,process.env.NOTIFICATION_MODE);
if(!['disabled','razorpay-test'].includes(process.env.REFUND_EXECUTION_MODE??'disabled'))throw new Error('Invalid REFUND_EXECUTION_MODE');
const notificationPollMs=Number(process.env.NOTIFICATION_POLL_MS??5000);
if(!Number.isSafeInteger(notificationPollMs)||notificationPollMs<1000||notificationPollMs>60000)throw new Error('NOTIFICATION_POLL_MS must be between 1000 and 60000');
reminderMinutes();
const pollMs=Number(process.env.RECONCILIATION_POLL_MS??5000);
if(!Number.isSafeInteger(pollMs)||pollMs<1000||pollMs>60000)throw new Error('RECONCILIATION_POLL_MS must be between 1000 and 60000');
const db=openDb(process.env.DATABASE_PATH??'data/clinic.db');seed(db,process.env.ADMIN_PASSWORD);
if(!process.env.ADMIN_PASSWORD)console.warn('ADMIN_PASSWORD absent: demo administrators are not provisioned. Set it before first seed.');
const {app,engine,payments,provider,refunds}=createApp(db,{mockKey:process.env.MOCK_API_KEY??randomBytes(32).toString('hex'),mockBase:process.env.MOCK_BASE_URL,origins:process.env.ALLOWED_ORIGINS?.split(','),otpSink:otpDelivery?.deliver.bind(otpDelivery)});
const worker=new ReconciliationWorker(engine,payments,provider,{pollMs},message=>console.log(message),refunds);
const notifications=notificationProvider?new NotificationWorker(db,notificationProvider,{pollMs:notificationPollMs},undefined,message=>console.log(message)):undefined;
const timer=setInterval(()=>{
 const now=Date.now();
 transaction(db,()=>expireHolds(db,now));
},30000);timer.unref();
const server=app.listen(Number(process.env.PORT??4000),'127.0.0.1',()=>{
 console.log(`API listening on http://127.0.0.1:${process.env.PORT??4000}`);
 worker.start();
 notifications?.start();
 refunds.start(pollMs);
});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{
 if(stopping)return;
 stopping=true;
 clearInterval(timer);
 await Promise.all([worker.stop(),notifications?.stop(),refunds.stop()]);
 server.close(()=>{db.close();});
});
