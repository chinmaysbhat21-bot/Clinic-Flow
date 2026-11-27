import type { BookingAdapter,Slot } from '../../../packages/shared/src/index.js';
import { Fault,requireThat } from './core.js';
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
}
export class GoogleAdapter implements BookingAdapter {
 constructor(private token:string,private calendar:string){}
 private request(path:string,method='GET',body?:unknown){requireThat(this.token&&this.calendar,'GOOGLE_NOT_CONFIGURED','Google Calendar credentials are required',503);return remote(`https://www.googleapis.com/calendar/v3${path}`,{method,headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
 private events(){return `/calendars/${encodeURIComponent(this.calendar)}/events`;}
 async getSlots(i:{doctorId:string;start:string;end:string}):Promise<Slot[]>{const r=await this.request('/freeBusy','POST',{timeMin:i.start,timeMax:i.end,items:[{id:this.calendar}]});const c=r.calendars?.[this.calendar];requireThat(c&&!c.errors,'GOOGLE_AVAILABILITY_FAILED',undefined,503);return c.busy;}
 async holdSlot(i:Parameters<BookingAdapter['holdSlot']>[0]){return i.id;} // Backend is the reservation authority.
 async findOrCreatePatient(i:{id:string;phone:string}){return i.id;}
 async confirmBooking(i:Parameters<BookingAdapter['confirmBooking']>[0]){const id=i.id.replaceAll('-','');try{const existing=await this.request(`${this.events()}/${id}`);return existing.id;}catch(e){if(!(e instanceof Fault)||e.code!=='PROVIDER_REJECTED')throw e;}
 const event=await this.request(this.events(),'POST',{id,summary:'Clinic appointment',start:{dateTime:i.start},end:{dateTime:i.end},extendedProperties:{private:{bookingHold:i.id}}});return event.id;}
 async rescheduleBooking(id:string,i:Slot & {doctorId:string}){await this.request(`${this.events()}/${encodeURIComponent(id)}`,'PATCH',{start:{dateTime:i.start},end:{dateTime:i.end}});}
 async cancelBooking(id:string){await this.request(`${this.events()}/${encodeURIComponent(id)}`,'DELETE');}
}
