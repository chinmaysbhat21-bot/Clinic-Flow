import { z } from 'zod';
export const BookingStatus = z.enum(['AVAILABLE','HELD','OTP_VERIFIED','PAYMENT_PENDING','PAYMENT_VERIFIED','CONFIRMATION_PENDING','CONFIRMED','EXPIRED','CANCELLED','PAYMENT_FAILED','REFUND_PENDING','REFUNDED']);
export const PaymentStatus = z.enum(['CREATED','VERIFIED','FAILED','REFUND_PENDING','REFUNDED']);
export const language = z.enum(['en','kn','hi']);
export const slotQuery = z.object({doctorId:z.string().min(1),serviceId:z.string().min(1),date:z.iso.date()});
export const holdRequest = slotQuery.omit({date:true}).extend({start:z.iso.datetime()});
export const consentRequest = z.object({booking:z.literal(true),briefing:z.boolean().default(false)});
export const phoneRequest = z.object({holdId:z.string(),phone:z.string().regex(/^\+[1-9]\d{7,14}$/)});
export const otpRequest = phoneRequest.extend({code:z.string().regex(/^\d{6}$/)});
export const holdIdRequest = z.object({holdId:z.string()});
export const paymentVerifyRequest = z.object({holdId:z.string(),razorpay_order_id:z.string(),razorpay_payment_id:z.string(),razorpay_signature:z.string()});
export const briefingRequest = z.object({patientReportedSummary:z.string().min(1).max(2000)});
export const ChatAction = z.discriminatedUnion('type',[
 z.object({type:z.literal('SELECT_SLOT'),slots:z.array(z.object({start:z.string(),end:z.string()}))}),
 z.object({type:z.literal('VERIFY_OTP'),holdId:z.string()}),
 z.object({type:z.literal('PAY'),holdId:z.string(),orderId:z.string(),amount:z.number().int(),currency:z.literal('INR'),keyId:z.string()}),
 z.object({type:z.literal('CONFIRMED'),bookingId:z.string(),reference:z.string()}),
 z.object({type:z.literal('HANDOFF'),contact:z.string()})]);
export type BookingState=z.infer<typeof BookingStatus>;
export type ApiResponse<T>={ok:true;data:T;requestId:string}|{ok:false;error:{code:string;message:string};requestId:string};
export type Slot={start:string;end:string};
export interface BookingAdapter {
 getSlots(input:{doctorId:string;start:string;end:string}):Promise<Slot[]>;
 holdSlot(input:{id:string;doctorId:string;start:string;end:string;expiresAt:string}):Promise<string>;
 findOrCreatePatient(input:{id:string;phone:string}):Promise<string>;
 confirmBooking(input:{id:string;doctorId:string;start:string;end:string;patientId:string}):Promise<string>;
 rescheduleBooking(id:string,input:Slot & {doctorId:string}):Promise<void>;
 cancelBooking(id:string):Promise<void>;
}
export const toolArguments={getClinic:z.object({}),getDoctors:z.object({}),getServices:z.object({}),getSlots:slotQuery,holdSlot:holdRequest,getBooking:z.object({bookingId:z.string()}),cancelBooking:z.object({bookingId:z.string()}),rescheduleBooking:z.object({bookingId:z.string(),holdId:z.string()}),getFAQs:z.object({}),handoff:z.object({})};
export type ToolName=keyof typeof toolArguments;
export interface TrustedToolContext {clinicId:string;sessionId:string}
