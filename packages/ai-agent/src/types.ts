export type Language = "en" | "kn" | "hi";

export type Intent =
  | "book_appointment"
  | "search_doctors"
  | "search_services"
  | "availability"
  | "booking_status"
  | "cancel_booking"
  | "reschedule_booking"
  | "faq"
  | "human"
  | "medical_advice"
  | "other";

export type TimePreference = "morning" | "afternoon" | "evening" | "any";

export interface ExtractedIntent {
  intent: Intent;
  service: string | null;
  doctor: string | null;
  specialization: string | null;
  preferredDate: string | null;
  timePreference: TimePreference | null;
  bookingId: string | null;
  faqTopic: string | null;
  patientReportedConcern: string | null;
}

export interface AgentState {
  intent: Intent | null;
  serviceId: string | null;
  serviceName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  preferredDate: string | null;
  timePreference: TimePreference | null;
  bookingId: string | null;
  availableSlots: Slot[];
  userMessageCount: number;
}

export interface Slot {
  start: string;
  end: string;
}

export interface ChatRequest {
  message: string;
  language: Language;
}

export type ChatAction =
  | { type: "SELECT_SLOT"; slots: Slot[] }
  | { type: "VERIFY_OTP"; holdId: string }
  | { type: "PAY"; holdId: string; orderId: string; amount: number; currency: "INR"; keyId: string }
  | { type: "CONFIRMED"; bookingId: string; reference: string }
  | { type: "HANDOFF"; contact: string };

export interface ChatResponse {
  message: string;
  language: Language;
  actions: ChatAction[];
  state: AgentState;
  /** Per-turn only; never serialize or persist this without backend-recorded consent and a confirmed booking. */
  briefingCandidate?: string;
}

export interface ToolContext {
  clinicId: string;
  sessionId: string;
}

export interface IntentExtractionContext extends Pick<AgentState, "intent" | "serviceName" | "doctorName" | "preferredDate" | "timePreference"> {
  /** Verified clinic catalog names; used only to resolve multilingual follow-up selections. */
  doctorOptions?: string[];
  serviceOptions?: string[];
}

export interface Doctor {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  duration?: number;
  fee?: number;
}

export interface ClinicInfo {
  id: string;
  name: string;
  timezone?: string;
  contact?: string;
  emergencyInstructions?: string;
}

export interface FAQ {
  question: string;
  answer: string;
}

export type ToolName =
  | "getClinic"
  | "getDoctors"
  | "getServices"
  | "getSlots"
  | "getFAQs"
  | "getBooking"
  | "handoff";

export interface AgentTools {
  executeTool(name: ToolName, input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface IntentExtractor {
  extract(message: string, language: Language, currentDate: string, context?: IntentExtractionContext): Promise<ExtractedIntent>;
  translateFaq?(answer: string, language: Language): Promise<string>;
}

export interface AgentConfig {
  now?: () => Date;
  timezone?: string;
  maxSlots?: number;
  /** Receives a sanitized failure category without provider messages or request content. */
  onExtractionFailure?: (diagnostic: ExtractionFailureDiagnostic) => void;
}

export interface ExtractionFailureDiagnostic {
  stage: "context_preparation" | "intent_extraction";
  kind: "invalid_output" | "timeout" | "provider_error" | "unexpected_error";
  status?: number;
}
