import { z } from "zod";
import { bookingStateText, emergencyGuidancePrefix, text } from "./locales.js";
import { isPossibleEmergency } from "./safety.js";
import { DoctorSchema, FAQSchema, ServiceSchema, SlotSchema, parseIsoDate } from "./schemas.js";
import type { AgentConfig, AgentState, AgentTools, ChatAction, ChatRequest, ChatResponse, ClinicInfo, Doctor, FAQ, ExtractionFailureDiagnostic, IntentExtractor, Service, Slot, ToolContext } from "./types.js";

const BookingSchema = z.object({
  id: z.string(),
  reference: z.string(),
  doctor_id: z.string(),
  service_id: z.string(),
  start: z.string(),
  end: z.string(),
  state: z.enum(["AVAILABLE", "HELD", "OTP_VERIFIED", "PAYMENT_PENDING", "PAYMENT_VERIFIED", "CONFIRMATION_PENDING", "CONFIRMED", "EXPIRED", "CANCELLED", "PAYMENT_FAILED", "REFUND_PENDING", "REFUNDED"]),
});
const EmergencyConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: z.object({ emergency: z.string().max(500).optional() }),
});

const ToolInputSchema = {
  getClinic: z.object({}).strict(),
  getDoctors: z.object({}).strict(),
  getServices: z.object({}).strict(),
  getFAQs: z.object({}).strict(),
  handoff: z.object({}).strict(),
  getBooking: z.object({ bookingId: z.string().min(1).max(128) }).strict(),
  getSlots: z.object({ doctorId: z.string().min(1).max(128), serviceId: z.string().min(1).max(128), date: z.string().refine((date) => parseIsoDate(date) !== null) }).strict(),
} satisfies Record<Parameters<AgentTools["executeTool"]>[0], z.ZodType>;

const emptyState = (): AgentState => ({
  intent: null,
  serviceId: null,
  serviceName: null,
  doctorId: null,
  doctorName: null,
  preferredDate: null,
  timePreference: null,
  bookingId: null,
  availableSlots: [],
  userMessageCount: 0,
});

export function createAgent(tools: AgentTools, extractor: IntentExtractor, config: AgentConfig = {}) {
  const now = config.now ?? (() => new Date());
  const maxSlots = config.maxSlots ?? 8;

  return {
    async handle(request: ChatRequest, context: ToolContext, persistedState?: AgentState): Promise<ChatResponse> {
      const previous = persistedState ?? emptyState();
      const state: AgentState = { ...emptyState(), ...previous, userMessageCount: previous.userMessageCount + 1 };
      const language = request.language;
      if (!request.message.trim() || request.message.length > 4000 || !context.clinicId || !context.sessionId) {
        return response(text(language, "needMore"), language, state);
      }

      if (isPossibleEmergency(request.message)) {
        const [actions, guidance] = await Promise.all([handoffAction(tools, context), emergencyGuidance(tools, context)]);
        const message = guidance ? `${text(language, "emergency")} ${emergencyGuidancePrefix(language)}${guidance}` : text(language, "emergency");
        return response(message, language, state, actions);
      }

      let extracted;
      let currentDate: string;
      let failureStage: "context_preparation" | "intent_extraction" = "context_preparation";
      try {
        currentDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: config.timezone ?? "Asia/Kolkata",
          year: "numeric", month: "2-digit", day: "2-digit",
        }).format(now());
        const extractionContext = {
          intent: state.intent,
          serviceName: state.serviceName,
          doctorName: state.doctorName,
          preferredDate: state.preferredDate,
          timePreference: state.timePreference,
          ...(previous.intent === "book_appointment" || previous.intent === "availability"
            ? await verifiedCatalogNames(tools, context, !state.doctorId, !state.serviceId)
            : {}),
        };
        failureStage = "intent_extraction";
        extracted = await extractor.extract(request.message, language, currentDate, extractionContext);
      } catch (error) {
        reportExtractionFailure(config.onExtractionFailure, failureStage, error);
        const actions = state.userMessageCount >= 2 ? await handoffAction(tools, context) : [];
        return response(state.userMessageCount >= 2 ? text(language, "toolFailure") : text(language, "needMore"), language, state, actions);
      }

      const followUpIntent = (previous.intent === "book_appointment" || previous.intent === "availability") && (extracted.intent === "other" || extracted.intent === "search_services" || extracted.intent === "search_doctors");
      state.intent = followUpIntent ? previous.intent : extracted.intent;
      const attachBriefingCandidate = (reply: ChatResponse): ChatResponse => {
        const concern = extracted.intent === "medical_advice" ? null : extracted.patientReportedConcern?.trim().slice(0, 2000);
        return concern ? { ...reply, briefingCandidate: concern } : reply;
      };
      state.bookingId = extracted.bookingId ?? state.bookingId;
      if (extracted.preferredDate !== null) {
        const parsedDate = parseIsoDate(extracted.preferredDate);
        state.preferredDate = parsedDate && parsedDate >= currentDate ? parsedDate : null;
      }
      state.timePreference = extracted.timePreference ?? state.timePreference;

      if (extracted.intent === "medical_advice") {
        return response(text(language, "medicalBoundary"), language, state);
      }
      if (extracted.intent === "human") {
        const actions = await handoffAction(tools, context);
        return attachBriefingCandidate(response(actions.length ? text(language, "handoff") : text(language, "clinicInfoMissing"), language, state, actions));
      }
      if (extracted.intent === "cancel_booking") {
        const actions = await handoffAction(tools, context);
        return attachBriefingCandidate(response(actions.length ? text(language, "cancelHandoff") : text(language, "clinicInfoMissing"), language, state, actions));
      }
      if (extracted.intent === "reschedule_booking") {
        const actions = await handoffAction(tools, context);
        return attachBriefingCandidate(response(actions.length ? text(language, "rescheduleHandoff") : text(language, "clinicInfoMissing"), language, state, actions));
      }
      if (extracted.intent === "search_services") return attachBriefingCandidate(await listServices(tools, context, language, state));
      if (extracted.intent === "search_doctors") return attachBriefingCandidate(await listDoctors(tools, context, language, state));
      if (extracted.intent === "faq") return attachBriefingCandidate(await answerFaq(tools, extractor, context, extracted.faqTopic ?? request.message, language, state));
      if (extracted.intent === "booking_status") return attachBriefingCandidate(await bookingStatus(tools, context, state.bookingId, language, state));
      if (extracted.intent === "book_appointment" || extracted.intent === "availability" || state.intent === "book_appointment" || state.intent === "availability") {
        return attachBriefingCandidate(await bookOrFindSlots(tools, context, extracted, language, state, maxSlots, config.timezone ?? "Asia/Kolkata"));
      }
      return attachBriefingCandidate(response(text(language, "generic"), language, state));
    },
  };
}

function reportExtractionFailure(
  callback: AgentConfig["onExtractionFailure"],
  stage: "context_preparation" | "intent_extraction",
  error: unknown,
): void {
  if (!callback) return;
  const diagnostic: ExtractionFailureDiagnostic = { stage, kind: "unexpected_error" };
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    diagnostic.kind = "invalid_output";
  } else if (error instanceof Error && error.name === "TimeoutError") {
    diagnostic.kind = "timeout";
  } else if (error && typeof error === "object") {
    const providerError = error as { status?: unknown; statusCode?: unknown };
    const status = providerError.statusCode ?? providerError.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      diagnostic.kind = "provider_error";
      diagnostic.status = status;
    }
  }
  try { callback(diagnostic); } catch { /* Diagnostics must never change the chat response. */ }
}

async function verifiedCatalogNames(tools: AgentTools, context: ToolContext, includeDoctors: boolean, includeServices: boolean): Promise<{ doctorOptions?: string[]; serviceOptions?: string[] }> {
  const [doctorResult, serviceResult] = await Promise.all([
    includeDoctors ? callTool(tools, "getDoctors", {}, context).catch(() => null) : Promise.resolve(null),
    includeServices ? callTool(tools, "getServices", {}, context).catch(() => null) : Promise.resolve(null),
  ]);
  const result: { doctorOptions?: string[]; serviceOptions?: string[] } = {};
  if (doctorResult !== null) result.doctorOptions = z.array(DoctorSchema).parse(doctorResult).map((doctor) => doctor.name).slice(0, 50);
  if (serviceResult !== null) result.serviceOptions = z.array(ServiceSchema).parse(serviceResult).map((service) => service.name).slice(0, 50);
  return result;
}

async function bookOrFindSlots(
  tools: AgentTools,
  context: ToolContext,
  extracted: Awaited<ReturnType<IntentExtractor["extract"]>>,
  language: ChatRequest["language"],
  state: AgentState,
  maxSlots: number,
  timezone: string,
): Promise<ChatResponse> {
  try {
    const [serviceResult, doctorResult] = await Promise.all([
      callTool(tools, "getServices", {}, context),
      callTool(tools, "getDoctors", {}, context),
    ]);
    const services = z.array(ServiceSchema).parse(serviceResult) as Service[];
    const doctors = z.array(DoctorSchema).parse(doctorResult) as Doctor[];

    if (extracted.service) {
      const matched = findUnique(extracted.service, services, (item) => item.name);
      if (matched === "ambiguous") return response(text(language, "chooseService"), language, state);
      if (matched) { state.serviceId = matched.id; state.serviceName = matched.name; }
    }
    if (extracted.doctor) {
      const matched = findUnique(extracted.doctor, doctors, (item) => item.name);
      if (matched === "ambiguous") return response(text(language, "chooseDoctor"), language, state);
      if (matched) { state.doctorId = matched.id; state.doctorName = matched.name; }
    }

    if (!state.serviceId) {
      const options = services.slice(0, 8).map((item) => item.name).join(", ");
      return response(options ? `${text(language, "chooseService")} ${options}` : text(language, "chooseService"), language, state);
    }
    if (!state.doctorId) {
      const options = doctors.slice(0, 8).map((item) => item.name).join(", ");
      return response(options ? `${text(language, "chooseDoctor")} ${options}` : text(language, "chooseDoctor"), language, state);
    }
    if (!state.preferredDate) return response(text(language, "askDate"), language, state);

    const slotResult = await callTool(tools, "getSlots", {
      doctorId: state.doctorId,
      serviceId: state.serviceId,
      date: state.preferredDate,
    }, context);
    const slots = z.array(SlotSchema).parse(slotResult) as Slot[];
    const filtered = slots
      .filter((slot) => matchesTime(slot.start, state.timePreference, timezone))
      .slice(0, maxSlots);
    state.availableSlots = filtered;
    if (filtered.length === 0 && state.timePreference) return response(text(language, "noSlots"), language, state);
    if (filtered.length === 0) return response(text(language, "noSlots"), language, state);
    return response(`${text(language, "chooseSlot")} ${text(language, "slotAndConsent")}`, language, state, [{ type: "SELECT_SLOT", slots: filtered }]);
  } catch {
    const actions = await handoffAction(tools, context);
    return response(text(language, "toolFailure"), language, state, actions);
  }
}

async function listServices(tools: AgentTools, context: ToolContext, language: ChatRequest["language"], state: AgentState): Promise<ChatResponse> {
  try {
    const services = z.array(ServiceSchema).parse(await callTool(tools, "getServices", {}, context)) as Service[];
    return response(`${text(language, "serviceList")} ${services.map((service) => service.name).slice(0, 12).join(", ")}`, language, state);
  } catch { return toolFailureResponse(tools, context, language, state); }
}

async function listDoctors(tools: AgentTools, context: ToolContext, language: ChatRequest["language"], state: AgentState): Promise<ChatResponse> {
  try {
    const doctors = z.array(DoctorSchema).parse(await callTool(tools, "getDoctors", {}, context)) as Doctor[];
    return response(`${text(language, "doctorList")} ${doctors.map((doctor) => doctor.name).slice(0, 12).join(", ")}`, language, state);
  } catch { return toolFailureResponse(tools, context, language, state); }
}

async function answerFaq(tools: AgentTools, extractor: IntentExtractor, context: ToolContext, message: string, language: ChatRequest["language"], state: AgentState): Promise<ChatResponse> {
  try {
    const faqs = z.array(FAQSchema).parse(await callTool(tools, "getFAQs", {}, context)) as FAQ[];
    const queryWords = new Set(normalize(message).split(/\s+/).filter((word) => word.length > 2));
    let best: FAQ | undefined;
    let bestScore = 0;
    for (const faq of faqs) {
      const candidate = new Set(normalize(faq.question).split(/\s+/));
      const score = [...queryWords].filter((word) => candidate.has(word)).length;
      if (score > bestScore) { best = faq; bestScore = score; }
    }
    if (!best || bestScore === 0) {
      const actions = await handoffAction(tools, context);
      return response(actions.length ? text(language, "faqNotFound") : text(language, "clinicInfoMissing"), language, state, actions);
    }
    if (language === "en") return response(best.answer.slice(0, 1200), language, state);
    if (!extractor.translateFaq) {
      const actions = await handoffAction(tools, context);
      return response(actions.length ? text(language, "faqTranslationUnavailable") : text(language, "clinicInfoMissing"), language, state, actions);
    }
    const translated = await extractor.translateFaq(best.answer.slice(0, 1200), language);
    return response(translated.slice(0, 1200), language, state);
  } catch { return toolFailureResponse(tools, context, language, state); }
}

async function bookingStatus(tools: AgentTools, context: ToolContext, bookingId: string | null, language: ChatRequest["language"], state: AgentState): Promise<ChatResponse> {
  if (!bookingId) return response(text(language, "bookingStatusNeedId"), language, state);
  try {
    const booking = BookingSchema.parse(await callTool(tools, "getBooking", { bookingId }, context));
    if (booking.state === "CONFIRMED") return response(text(language, "bookingStatus"), language, state, [{ type: "CONFIRMED", bookingId: booking.id, reference: booking.reference }]);
    return response(bookingStateText(language, booking.state) ?? text(language, "bookingStatus"), language, state);
  } catch { return toolFailureResponse(tools, context, language, state); }
}

async function toolFailureResponse(tools: AgentTools, context: ToolContext, language: ChatRequest["language"], state: AgentState): Promise<ChatResponse> {
  const actions = await handoffAction(tools, context);
  return response(actions.length ? text(language, "toolFailure") : text(language, "clinicInfoMissing"), language, state, actions);
}

async function callTool(tools: AgentTools, name: Parameters<AgentTools["executeTool"]>[0], input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  if (!context.clinicId || !context.sessionId) throw new Error("Missing trusted clinic session context");
  // Allowlisted names and fixed argument construction prevent model-controlled dispatch.
  const validatedInput = ToolInputSchema[name].parse(input);
  return tools.executeTool(name, validatedInput, context);
}

async function handoffAction(tools: AgentTools, context: ToolContext): Promise<ChatAction[]> {
  try {
    const result = await callTool(tools, "handoff", {}, context);
    if (!result || typeof result !== "object" || !("contact" in result) || typeof result.contact !== "string") return [];
    const contact = result.contact.trim();
    if (!contact || contact.length > 120 || /[\u0000-\u001f\u007f]/.test(contact)) return [];
    return [{ type: "HANDOFF", contact }];
  } catch { return []; }
}

async function emergencyGuidance(tools: AgentTools, context: ToolContext): Promise<string | undefined> {
  try {
    const result = EmergencyConfigSchema.parse(await callTool(tools, "getClinic", {}, context));
    const guidance = result.config.emergency?.trim();
    if (!guidance || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(guidance)) return undefined;
    return guidance;
  } catch { return undefined; }
}

function findUnique<T>(query: string, values: T[], getName: (item: T) => string): T | "ambiguous" | undefined {
  const q = normalize(query);
  const exact = values.filter((item) => normalize(getName(item)) === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  const contains = values.filter((item) => normalize(getName(item)).includes(q) || q.includes(normalize(getName(item))));
  return contains.length === 1 ? contains[0] : contains.length > 1 ? "ambiguous" : undefined;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function matchesTime(start: string, preference: AgentState["timePreference"], timezone: string): boolean {
  if (!preference || preference === "any") return true;
  const hourText = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(start));
  const hour = Number(hourText);
  if (!Number.isInteger(hour)) return false;
  if (preference === "morning") return hour >= 5 && hour < 12;
  if (preference === "afternoon") return hour >= 12 && hour < 17;
  return hour >= 17 && hour < 22;
}

function response(message: string, language: ChatRequest["language"], state: AgentState, actions: ChatAction[] = []): ChatResponse {
  return { message, language, actions, state };
}
