import { toolArguments,type ToolName,type TrustedToolContext } from '../../../packages/shared/src/index.js';
import { Engine,requireThat } from './core.js';
/** Call only from Nandan's server-side integration, with authenticated context. Never expose session IDs to the model. */
export async function executeTool(engine:Engine,name:ToolName,input:unknown,context:TrustedToolContext){
 const {clinicId:c,sessionId:s}=context;
 requireThat(engine.one('SELECT id FROM sessions WHERE id=? AND clinic_id=? AND expires_at>?',s,c,engine.now()),'SESSION_REQUIRED',undefined,401);
 const p=toolArguments[name].parse(input) as any;
 switch(name){
 case 'getClinic':return engine.clinic(c);
 case 'getDoctors':return engine.all('SELECT id,name FROM doctors WHERE clinic_id=? AND active=1',c);
 case 'getServices':return engine.all('SELECT * FROM services WHERE clinic_id=? AND active=1',c);
 case 'getSlots':return engine.available(c,p.doctorId,p.serviceId,p.date);
 case 'holdSlot':return engine.reserve(c,s,p);
 case 'getBooking':return engine.booking(c,s,p.bookingId);
 case 'cancelBooking':return engine.cancel(c,s,p.bookingId);
 case 'rescheduleBooking':return engine.reschedule(c,s,p.bookingId,p.holdId);
 case 'getFAQs':return engine.clinic(c).config.faqs;
 case 'handoff':return {type:'HANDOFF',contact:engine.clinic(c).config.handoff};
 }
}
