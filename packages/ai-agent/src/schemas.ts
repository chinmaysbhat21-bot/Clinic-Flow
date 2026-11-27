import { z } from "zod";

export const LanguageSchema = z.enum(["en", "kn", "hi"]);
export const IntentSchema = z.enum([
  "book_appointment",
  "search_doctors",
  "search_services",
  "availability",
  "booking_status",
  "cancel_booking",
  "reschedule_booking",
  "faq",
  "human",
  "medical_advice",
  "other",
]);
export const TimePreferenceSchema = z.enum(["morning", "afternoon", "evening", "any"]);

export const ExtractedIntentSchema = z.object({
  intent: IntentSchema,
  service: z.string().nullable(),
  doctor: z.string().nullable(),
  specialization: z.string().nullable(),
  preferredDate: z.string().nullable(),
  timePreference: TimePreferenceSchema.nullable(),
  bookingId: z.string().nullable(),
  faqTopic: z.string().nullable(),
  patientReportedConcern: z.string().nullable(),
}).strict();

export const SlotSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).strict();

export const DoctorSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export const ServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  duration: z.number().optional(),
  fee: z.number().optional(),
});
export const FAQSchema = z.object({ question: z.string(), answer: z.string() });
export const ClinicSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string().optional(),
  contact: z.string().optional(),
  emergencyInstructions: z.string().optional(),
});

export function parseIsoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value;
}
