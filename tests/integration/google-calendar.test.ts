import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleAdapter, googleCalendarId } from '../../apps/api/src/adapters.js';
import { clinicDate, clinicHour } from '../../apps/api/src/clinic-time.js';
import { openDb, seed } from '../../apps/api/src/db.js';
import { Engine } from '../../apps/api/src/core.js';
import { Payments, type PaymentProvider } from '../../apps/api/src/payments.js';
import { ReconciliationWorker } from '../../apps/api/src/reconciliation.js';

function calendarFixture(){
 const events=new Map<string,Record<string,unknown>>();
 const requests:{method:string;path:string;body:Record<string,unknown>}[]=[];
 let lose:string|undefined, failure:number|undefined;
 let busy:{start:string;end:string}[]=[];
 const request:typeof fetch=async(input,options)=>{
  const url=new URL(String(input));
  const method=options?.method??'GET';
  const body=JSON.parse(String(options?.body??'{}'));
  requests.push({method,path:url.pathname,body});
  if(failure)return Response.json({}, {status:failure});
  if(url.pathname.endsWith('/freeBusy'))return Response.json({calendars:{'lotus-calendar':{busy}}});
  const id=url.pathname.split('/').at(-1)!;
  if(method==='GET'&&id==='events')return Response.json({items:[...events.values()]});
  if(method==='GET')return events.has(id)?Response.json(events.get(id)):Response.json({}, {status:404});
  let event:Record<string,unknown>;
  if(method==='POST'){
   if(events.has(body.id))return Response.json({}, {status:409});
   event={...body,status:'confirmed'};
   events.set(body.id,event);
  }else if(method==='PATCH'){
   event={...events.get(id),...body};
   events.set(id,event);
  }else{
   event={id,status:'cancelled'};
   events.set(id,event);
  }
  if(lose===method){lose=undefined;throw new Error('Response lost after provider write');}
  return method==='DELETE'?new Response(null,{status:204}):Response.json(event);
 };
 return {events,requests,lose:(method:string)=>{lose=method;},fail:(status:number)=>{failure=status;},
  setBusy:(slots:typeof busy)=>{busy=slots;},adapter:new GoogleAdapter('fictional-token','lotus-calendar','America/New_York',request)};
}

test('Google provider uses clinic mapping, canonical UTC, minimal event metadata and deterministic IDs',async()=>{
 const f=calendarFixture(),id=randomUUID();
 const input={id,doctorId:'lotus-doctor',start:'2026-12-01T14:00:00.000Z',end:'2026-12-01T14:30:00.000Z',patientId:'private-patient'};
 assert.equal(googleCalendarId('lotus','{"lotus":"lotus-calendar","harbor":"harbor-calendar"}',undefined),'lotus-calendar');
 assert.equal(googleCalendarId('unknown','{"lotus":"lotus-calendar"}','legacy'),'');
 assert.equal(googleCalendarId('harbor',undefined,'legacy'),'legacy');
 assert.throws(()=>googleCalendarId('lotus','{"lotus":"shared","harbor":"shared"}',undefined),{code:'GOOGLE_NOT_CONFIGURED'});
 f.setBusy([{start:'2026-12-01T09:00:00-05:00',end:'2026-12-01T09:30:00-05:00'}]);
 assert.deepEqual(await f.adapter.getSlots(input),[{start:input.start,end:input.end}]);
 await assert.rejects(f.adapter.confirmBooking(input),{code:'PROVIDER_REJECTED'});
 f.setBusy([]);
 const external=await f.adapter.confirmBooking(input);
 assert.equal(await f.adapter.confirmBooking(input),external);
 assert.equal(f.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/events')).length,1);
 assert.equal(external,id.replaceAll('-',''));
 const event=f.events.get(external)!;
 assert.equal(event.summary,'Clinic appointment');
 assert.deepEqual(event.start,{dateTime:input.start,timeZone:'America/New_York'});
 assert.equal(JSON.stringify(event).includes(input.patientId),false);
 f.fail(403);
 await assert.rejects(f.adapter.lookupBooking(external),{code:'PROVIDER_REJECTED'});
 f.fail(503);
 await assert.rejects(f.adapter.getSlots(input),{code:'PROVIDER_REJECTED'});
});

test('clinic timezone observes seasonal offsets and does not offer missing DST boundaries',()=>{
 assert.equal(clinicHour('2026-12-01',9,'America/New_York'),Date.parse('2026-12-01T14:00:00Z'));
 assert.equal(clinicHour('2026-07-01',9,'America/New_York'),Date.parse('2026-07-01T13:00:00Z'));
 assert.equal(clinicHour('2026-03-08',2,'America/New_York'),undefined);
 assert.equal(clinicDate(Date.parse('2026-12-01T01:00:00Z'),'America/New_York'),'2026-11-30');
});

test('worker recovers Google create, move and delete after lost responses and preserves quarantine',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clinic-google-'));
 const path=join(dir,'clinic.db');
 let db=openDb(path);
 const f=calendarFixture();
 let now=Date.parse('2026-12-01T00:00:00Z');
 const session=randomUUID();
 const provider:PaymentProvider={keyId:'fixture',secret:'fixture',order:async()=>{throw Error('No payment call');},payment:async()=>{throw Error('No payment call');}};
 const engineFor=()=>new Engine(db,()=>f.adapter,undefined,()=>now);
 try{
  seed(db);
  let e=engineFor();
  e.run("UPDATE clinics SET adapter='google', config=json_set(config,'$.timezone','America/New_York') WHERE id='lotus'");
  e.run('INSERT INTO sessions VALUES(?,?,?,?)',session,'lotus',now,now+7*86400000);
  e.run('INSERT INTO consents VALUES(?,?,?,?,?,?)',randomUUID(),session,'lotus',1,0,now);
  const input={doctorId:'lotus-doctor',serviceId:'lotus-consult',start:'2026-12-01T14:00:00.000Z'};
  const hold=await e.reserve('lotus',session,input);
  e.run("UPDATE holds SET phone=?,state='PAYMENT_VERIFIED' WHERE id=?",'+12025550123',hold.id);
  e.run('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),'lotus',hold.id,'fixture-order','fixture-payment',hold.fee,'INR','VERIFIED',now);
  f.lose('POST');
  // Lose the event insert response, not the freeBusy response.
  await assert.rejects(e.confirm('lotus',session,hold.id),{code:'CONFIRMATION_PENDING'});
  db.close();
  db=openDb(path);
  e=engineFor();
  const worker=new ReconciliationWorker(e,new Payments(e,provider),provider,{graceMs:0});
  assert.equal(await worker.runOnce(),true);
  const booking=await e.confirm('lotus',session,hold.id);
  assert.equal(booking.state,'CONFIRMED');
  assert.equal(f.events.size,1);
  const target={...input,start:'2026-12-04T14:00:00.000Z'};
  const replacement=await e.reserve('lotus',session,target);
  f.lose('PATCH');
  await assert.rejects(e.reschedule('lotus',session,booking.id,replacement.id),{code:'RESCHEDULE_PENDING'});
  now+=86400001;
  assert.equal(e.slots('lotus',input.doctorId,input.serviceId,'2026-12-04').some(slot=>slot.start===target.start),false);
  assert.equal(await worker.runOnce(),true);
  assert.equal(e.booking('lotus',session,booking.id).start,target.start);
  f.lose('DELETE');
  await assert.rejects(e.cancel('lotus',session,booking.id),{code:'PROVIDER_UNAVAILABLE'});
  assert.equal(await worker.runOnce(),true);
  assert.equal(e.booking('lotus',session,booking.id).state,'REFUND_PENDING');
  assert.equal(e.all('SELECT id FROM appointments').length,1);
  assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);
  assert.equal(f.requests.filter(r=>r.method==='DELETE').length,1);
 }finally{db.close();rmSync(dir,{recursive:true});}
});
