# Almost Humans API contract v0.1.0

Review draft. [OpenAPI 3.1](openapi.yaml) specifies each operation’s exact method, parameters, security, validation, responses, status codes and examples. It uses JSON syntax, which is also valid YAML. JSON examples represent fictional data and placeholders. Source is `apps/api/src/server.ts:createApp`; delegated behavior is in `core.ts`, `payments.ts` and `adapters.ts`. Chinmay owns the HTTP contract, Jay owns widget and dashboard consumers, and Nandan owns chat and the server-side AI consumer.

Base URL is `http://127.0.0.1:4000`. Send `Content-Type: application/json` for JSON bodies. Patient auth requires both `X-Clinic-Id` and `X-Session-Id`. Admin uses `Authorization: Bearer <token>`. Internal mock uses `X-Mock-Key`. The webhook uses `X-Razorpay-Signature` over the original body. Browser preflight is global `OPTIONS`, returning 204 for permitted origins. Success uses `{ok:true,data,requestId}`, except mock successes are bare JSON and ICS returns a file. Errors use `{ok:false,error:{code,message},requestId}`. See [error handling](ERROR_CODES.md).

## Endpoint inventory

| Operation | Auth | Current status |
|---|---|---|
| `GET /api/health` | public | IMPLEMENTED AND VERIFIED |
| `POST /api/sessions` | public | IMPLEMENTED AND VERIFIED |
| `GET /api/clinics/{id}/config` | public | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/clinics/{id}/doctors` | public | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/clinics/{id}/services` | public | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/consent` | patient | IMPLEMENTED AND VERIFIED |
| `POST /api/notification-preferences` | patient | IMPLEMENTED AND VERIFIED. Save `en`, `kn` or `hi` for notification rendering. English is the default and the fallback for unsupported stored values. |
| `GET /api/slots` | patient | IMPLEMENTED AND VERIFIED |
| `POST /api/holds` | patient | IMPLEMENTED AND VERIFIED |
| `GET /api/holds/{id}` | patient | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/holds/{id}/refund` | patient | IMPLEMENTED AND VERIFIED |
| `DELETE /api/holds/{id}` | patient | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/otp/send` | patient | PARTIALLY IMPLEMENTED |
| `POST /api/otp/verify` | patient | IMPLEMENTED AND VERIFIED |
| `POST /api/payments/order` | patient | PARTIALLY IMPLEMENTED |
| `POST /api/payments/verify` | patient | BLOCKED |
| `POST /api/payments/webhook` | webhook | HTTP 200 means durable receipt; provider reconciliation runs in the background. HTTP 503 requests redelivery after storage or mapping failure. [External Test Mode delivery pending](RAZORPAY_WEBHOOK_SETUP.md). |
| `POST /api/bookings/confirm` | patient | BLOCKED |
| `GET /api/bookings/{id}` | patient | BLOCKED |
| `POST /api/bookings/{id}/cancel` | patient | BLOCKED |
| `POST /api/bookings/{id}/reschedule` | patient | BLOCKED |
| `GET /api/bookings/{id}/calendar.ics` | patient | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/bookings/{id}/briefing` | patient | PARTIALLY IMPLEMENTED |
| `POST /api/chat` | patient | IMPLEMENTED; mock-extractor integration-tested and one minimal Gemini API request verified; full live booking unverified |
| `POST /api/admin/login` | public | IMPLEMENTED AND VERIFIED |
| `GET /api/admin/appointments` | admin | IMPLEMENTED AND VERIFIED |
| `GET /api/admin/overview` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/reconciliation` | admin | Includes clinic-scoped `WEBHOOK` jobs. An authorized administrator can requeue a manual webhook job; its outcome requires worker evidence. |
| `GET /api/admin/notifications` | admin | IMPLEMENTED AND VERIFIED. `ACCEPTED` indicates provider acceptance. Rendering failures appear as `MANUAL` with reason `RENDER_FAILED`. |
| `GET /api/admin/config` | admin | IMPLEMENTED BUT UNVERIFIED |
| `PATCH /api/admin/config` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/doctors` | admin | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/admin/doctors` | admin | IMPLEMENTED BUT UNVERIFIED |
| `PATCH /api/admin/doctors/{id}` | admin | IMPLEMENTED BUT UNVERIFIED |
| `PATCH /api/admin/doctors/{id}/availability` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/services` | admin | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/admin/services` | admin | IMPLEMENTED BUT UNVERIFIED |
| `PATCH /api/admin/services/{id}` | admin | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/admin/blocks` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/blocks` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/payments` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/refunds` | admin | IMPLEMENTED AND VERIFIED |
| `GET /api/admin/audit-logs` | admin | IMPLEMENTED BUT UNVERIFIED |
| `GET /api/admin/outbox` | admin | IMPLEMENTED BUT UNVERIFIED |
| `POST /api/admin/appointments/{id}/{action}` | admin | BLOCKED |
| `GET /mock/{clinic}/busy` | mock | IMPLEMENTED AND VERIFIED |
| `POST /mock/{clinic}/holds` | mock | IMPLEMENTED AND VERIFIED |
| `POST /mock/{clinic}/patients` | mock | IMPLEMENTED AND VERIFIED |
| `POST /mock/{clinic}/bookings/{id}/confirm` | mock | IMPLEMENTED AND VERIFIED |
| `GET /mock/{clinic}/bookings/{id}` | mock | IMPLEMENTED AND VERIFIED |
| `PATCH /mock/{clinic}/bookings/{id}` | mock | IMPLEMENTED AND VERIFIED |
| `DELETE /mock/{clinic}/bookings/{id}` | mock | IMPLEMENTED AND VERIFIED |

**Verified** means exercised by the existing integration flow. Payment coverage uses a provider fixture. **Blocked** can identify an implemented route that is unsafe for shared use. The mock API is internal. Read [backend dependencies and risks](BACKEND_INTEGRATION.md), [state and retries](BOOKING_STATE_MACHINE.md), and the [frontend handoff](FRONTEND_INTEGRATION.md) before connecting clients.

## Models and exposure boundaries

| Model | Actual source or proposed shape |
|---|---|
| Clinic, Doctor, Service | Route-specific records. Public and admin clinic config shapes differ. Doctor schedules contain days and hour ranges. Stored active flags are 0/1. No shared DTOs. |
| PatientSession | Session create returns `{sessionId,clinicId,expiresAt}`; reusable credential, expires after 24 hours, no renew or revoke route. |
| Consent, OTPVerification | Shared request validators. Consent accepts literal booking=true and optional briefing flag. OTP accepts international phone and six-digit string. Never serialize OTP records. |
| AvailabilitySlot, SlotHold | Shared `Slot` and hold request. Hold response projection uses id, start, end, fee in paise, expires_at in milliseconds, state. |
| PaymentOrder, PaymentStatus | Inline checkout response with keyId, orderId, amount and INR. Shared PaymentStatus enum. Verification response mixes booking and payment states. |
| Appointment, AppointmentStatus, RefundStatus | Shared BookingStatus combines several lifecycle concepts. The separate [refund status contract](REFUND_SETUP.md) reports the durable refund operation without exposing provider identifiers. |
| ChatRequest, ChatResponse | `{message,language}` input and `{message,language,actions}` output, implemented in [AI tool contract](AI_TOOL_CONTRACT.md). Agent state stays server-side. |
| ChatAction | Existing shared five-way discriminated union; chat route validates every emitted action against it. |
| ToolRequest, ToolResponse | Existing name-to-Zod argument map and trusted context. No uniform result validator. |
| PatientBriefing | Shared request accepts a patient-reported summary of 1–2000 characters; response only acknowledges simulation. |
| APIError | Shared TypeScript ApiResponse union; current error schema in OpenAPI. No shared runtime response validators. |

**Unsafe current responses.** Hold, appointment and several tool handlers return raw records. Admin appointment list and action responses return only the seven fields in AppointmentProjection. The OpenAPI appointment and hold schemas describe the visible useful fields, not complete raw bodies or a guarantee of redaction. Restrict blocked routes to isolated local testing. Do not persist, display or forward internal fields.

**Proposed safe contract.** Keep paths and envelopes, and extend field allowlists to patient appointment and hold responses. Review these with Jay and Nandan before adopting. Add separate schemas for appointment, payment verification, and refund states. This changes current serialization and needs approval.

## Proposed or missing capabilities

No standalone readiness endpoint, session refresh/revoke, admin appointment details, public refund submission, delivery-status workflow, or separate OTP resend endpoint exists. Resend uses the existing OTP send route. For admin details, a proposed `GET /api/admin/appointments/{id}` would return a clinic-scoped appointment projection or 404. A proposed readiness probe would report dependency readiness separately from liveness. Refund reconciliation runs as a backend operation with provider confirmation and audit events. Conversation state for `/api/chat` currently lives in a bounded in-memory map scoped to clinic and session. It expires after 24 hours and is lost on restart; multi-process deployment needs shared persistence. Gemini configuration is server-side through `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and optional `GEMINI_MODEL`. Chat contract proposals do not change the current OpenAPI paths.

## Versioning

Use 0.1.0 for this draft, without adding a URL prefix. Additive optional fields are normally compatible if consumers ignore unknown fields. A new enum value requires consumer review because exhaustive switches can fail. Field removals, required fields, renamed routes, changes to auth or units, and changed state meanings require an approved migration and version bump. Update shared schemas, OpenAPI, examples and tests together. Chinmay requests review from Jay and Nandan before breaking changes.
