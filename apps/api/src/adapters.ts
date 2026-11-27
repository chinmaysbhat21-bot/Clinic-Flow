import type { BookingAdapter,Slot } from '../../../packages/shared/src/index.js';
import { Fault,requireThat } from './core.js';
import type { GoogleOAuth } from './google-oauth.js';
export async function remote(url:string,init:RequestInit={}){let r:Response;try{r=await fetch(url,{...init,signal:AbortSignal.timeout(10000)});}catch{throw new Fault('PROVIDER_UNAVAILABLE','External service unavailable',503);}if(!r.ok)throw new Fault('PROVIDER_REJECTED','External service rejected the operation',502);return r.status===204?{}:await r.json();}
export class MockAdapter implements BookingAdapter {
 constructor(private base:string,private clinic:string,private key:string){}
 request(path:string,method='GET',body?:unknown){return remote(`${this.base}/${this.clinic}${path}`,{method,headers:{'Content-Type':'application/json','x-mock-key':this.key},body:body?JSON.stringify(body):undefined});}
 async getSlots(i:{doctorId:string;start:string;end:string}):Promise<Slot[]>{return this.request(`/busy?${new URLSearchParams(i)}`);}
 async holdSlot(i:Parameters<BookingAdapter['holdSlot']>[0]){return (await this.request('/holds','POST',i)).id;}
 async findOrCreatePatient(i:{id:string;phone:string}){return (await this.request('/patients','POST',i)).id;}
 async confirmBooking(i:Parameters<BookingAdapter['confirmBooking']>[0]){return (await this.request(`/bookings/${i.id}/confirm`,'POST',i)).id;}
 async rescheduleBooking(id:string,i:Slot & {doctorId:string}){await this.request(`/bookings/${id}`,'PATCH',i);}
 async cancelBooking(id:string){await this.request(`/bookings/${id}`,'DELETE');}
 async lookupBooking(id:string){return (await this.request(`/bookings/${encodeURIComponent(id)}`)).booking;}
}
type CalendarEvent = {
 id:string; status?:string; transparency?:string; etag?:string;
 start?:{dateTime?:string;date?:string}; end?:{dateTime?:string;date?:string};
 extendedProperties?:{private?:{bookingHold?:string;doctorId?:string}};
};

class CalendarFault extends Fault {
 constructor(readonly upstreamStatus:number){
  super('PROVIDER_REJECTED','Google Calendar rejected the operation',502);
 }
}

export function googleCalendarId(clinic:string,mapping:string|undefined,legacy:string|undefined):string {
 if(!mapping)return clinic==='harbor'?(legacy??''):'';
 let parsed:unknown;
 try{parsed=JSON.parse(mapping);}catch{throw new Fault('GOOGLE_NOT_CONFIGURED','Invalid clinic calendar configuration',503);}
 requireThat(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'GOOGLE_NOT_CONFIGURED','Invalid clinic calendar configuration',503);
 const map=parsed as Record<string,unknown>;
 const ids=Object.values(map);
 requireThat(ids.every(id=>typeof id==='string'&&id.trim()!==''&&id!=='primary')&&new Set(ids).size===ids.length,'GOOGLE_NOT_CONFIGURED','Calendar IDs must be explicit and unique',503);
 return Object.hasOwn(map,clinic)&&typeof map[clinic]==='string'?map[clinic]:'';
}

export class GoogleAdapter implements BookingAdapter {
 constructor(private token:string|GoogleOAuth,private calendar:string,private timezone='Asia/Kolkata',private fetcher=fetch){}
 private async request<T>(path:string,method='GET',body?:unknown,etag?:string):Promise<T>{
  requireThat(this.token&&this.calendar,'GOOGLE_NOT_CONFIGURED','Google Calendar credentials are required',503);
  const send=async(token:string)=>{
   try{
    return await this.fetcher(`https://www.googleapis.com/calendar/v3${path}`,{
     method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},
     body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000),
    });
   }catch{throw new Fault('PROVIDER_UNAVAILABLE','Google Calendar unavailable',503);}
  };
  const auth=this.token;
  const token=typeof auth==='string'?auth:await auth.accessToken();
  let response=await send(token);
  // A definite authentication rejection is safe to retry. A timeout or 5xx is ambiguous.
  if(response.status===401&&typeof auth!=='string'){
   await response.body?.cancel().catch(()=>{});
   response=await send(await auth.accessToken(token));
  }
  if(!response.ok)throw new CalendarFault(response.status);
  return (response.status===204?undefined:await response.json()) as T;
 }
 private events(){return `/calendars/${encodeURIComponent(this.calendar)}/events`;}
 private event(id:string){return `${this.events()}/${encodeURIComponent(id)}`;}
 confirmationLookupId(holdId:string){return holdId.replaceAll('-','');}
 private async readEvent(id:string){
  try{return await this.request<CalendarEvent>(this.event(id));}
  catch(error){if(error instanceof CalendarFault&&[404,410].includes(error.upstreamStatus))return null;throw error;}
 }
 private normalizeBooking(id:string,event:CalendarEvent|null){
  if(!event||event.id!==id)return null;
  if(event.status==='cancelled')return {id,doctorId:'',start:'',end:'',state:'CANCELLED'};
  const meta=event.extendedProperties?.private;
  if(event.status!=='confirmed'||!meta?.bookingHold||this.confirmationLookupId(meta.bookingHold)!==id||!event.start?.dateTime||!event.end?.dateTime)return null;
  return {id,doctorId:meta.doctorId??'',start:new Date(event.start.dateTime).toISOString(),end:new Date(event.end.dateTime).toISOString(),state:'CONFIRMED'};
 }
 async lookupBooking(id:string){return this.normalizeBooking(id,await this.readEvent(id));}
 async getSlots(input:{doctorId:string;start:string;end:string}):Promise<Slot[]>{
  const response=await this.request<{calendars:Record<string,{busy:Slot[];errors?:unknown[]}>}>('/freeBusy','POST',{
   timeMin:input.start,timeMax:input.end,timeZone:'UTC',items:[{id:this.calendar}],
  });
  const result=response.calendars?.[this.calendar];
  requireThat(result&&!result.errors?.length&&Array.isArray(result.busy),'GOOGLE_AVAILABILITY_FAILED',undefined,503);
  return result.busy.map(slot=>({start:new Date(slot.start).toISOString(),end:new Date(slot.end).toISOString()}));
 }
 async holdSlot(input:Parameters<BookingAdapter['holdSlot']>[0]){return input.id;}
 async findOrCreatePatient(input:{id:string;phone:string}){return input.id;}
 private dates(input:Slot){return {start:{dateTime:input.start,timeZone:this.timezone},end:{dateTime:input.end,timeZone:this.timezone}};}
 async confirmBooking(input:Parameters<BookingAdapter['confirmBooking']>[0]){
  const id=this.confirmationLookupId(input.id);
  const matching=(record:CalendarEvent|null)=>{
   const event=this.normalizeBooking(id,record);
   requireThat(event?.state==='CONFIRMED'&&event.start===input.start&&event.end===input.end&&event.doctorId===input.doctorId,'PROVIDER_REJECTED','Calendar event does not match the booking',502);
   return event.id;
  };
  const existing=await this.readEvent(id);
  if(existing)return matching(existing);
  requireThat(!(await this.getSlots(input)).length,'PROVIDER_REJECTED','Calendar time became busy',502);
  try{
   const event=await this.request<CalendarEvent>(this.events(),'POST',{
    id,summary:'Clinic appointment',...this.dates(input),
    extendedProperties:{private:{bookingHold:input.id,doctorId:input.doctorId}},
   });
   return matching(event);
  }catch(error){
   if(error instanceof CalendarFault&&error.upstreamStatus===409)return matching(await this.readEvent(id));
   throw error;
  }
 }
 async rescheduleBooking(id:string,input:Slot & {doctorId:string}){
  const event=await this.readEvent(id);
  const current=this.normalizeBooking(id,event);
  requireThat(current?.state==='CONFIRMED'&&(!current.doctorId||current.doctorId===input.doctorId),'PROVIDER_REJECTED','Calendar event is unavailable',502);
  if(current.start===input.start&&current.end===input.end)return;
  const query=new URLSearchParams({timeMin:input.start,timeMax:input.end,singleEvents:'true',showDeleted:'false'});
  const list=await this.request<{items:CalendarEvent[];nextPageToken?:string}>(this.events()+'?'+query);
  requireThat(!list.nextPageToken&&Array.isArray(list.items)&&!list.items.some(event=>event.id!==id&&event.status!=='cancelled'&&event.transparency!=='transparent'),'PROVIDER_REJECTED','Calendar time is busy or could not be verified',502);
  const hold=event?.extendedProperties?.private?.bookingHold;
  requireThat(hold&&this.confirmationLookupId(hold)===id,'PROVIDER_REJECTED','Calendar event ownership could not be verified',502);
  await this.request(this.event(id),'PATCH',{...this.dates(input),
   extendedProperties:{private:{bookingHold:hold,doctorId:input.doctorId}},
  },event?.etag);
 }
 async cancelBooking(id:string){
  const event=await this.readEvent(id);
  const current=this.normalizeBooking(id,event);
  if(current?.state==='CANCELLED')return;
  requireThat(current?.state==='CONFIRMED','PROVIDER_REJECTED','Calendar event could not be verified for cancellation',502);
  await this.request(this.event(id),'DELETE',undefined,event?.etag);
 }
}
