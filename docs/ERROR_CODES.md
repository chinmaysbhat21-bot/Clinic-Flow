# Error contract

Actual format is `{ok:false,error:{code,message},requestId}`. Map the code to localized copy; messages can vary by call site. Failed JSON parsing and oversized request bodies currently fall through to INTERNAL_ERROR (500) rather than parser-specific 400/413. Preflight is 204 on allowed origins. No Retry-After header. Tool errors are exceptions and need a safe translation layer.

| Code | HTTP | Current message | Cause and next action |
|---|---|---|---|
| ADMIN_AUTH_REQUIRED | 401 | Admin authentication required | Sign in again |
| AI_MODULE_NOT_CONNECTED | 501 | Conversational agent provider is not configured | Configure server-side LLM_PROVIDER=gemini and GEMINI_API_KEY, then retry |
| BOOKING_NOT_CONFIRMED | 400 | BOOKING_NOT_CONFIRMED | booking not confirmed. Correct input or state before retry. |
| BRIEFING_DESTINATION_NOT_CONFIGURED | 400 | BRIEFING_DESTINATION_NOT_CONFIGURED | briefing destination not configured. Correct input or state before retry. |
| CONFIRMATION_PENDING | 503 | Payment retained; retry confirmation with the same hold ID | Preserve hold ID and retry confirmation deliberately |
| CONSENT_REQUIRED | 400 | CONSENT_REQUIRED | consent required. Correct input or state before retry. |
| GOOGLE_AVAILABILITY_FAILED | 503 | GOOGLE_AVAILABILITY_FAILED | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| GOOGLE_NOT_CONFIGURED | 503 | Google Calendar credentials are required | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| HOLD_EXPIRED | 400 | HOLD_EXPIRED | Refresh slots; check payment if checkout already started |
| INTERNAL_ERROR | 500 | Request could not be completed | Report requestId; reconcile mutations before retry |
| INVALID_CREDENTIALS | 401 | INVALID_CREDENTIALS | Check credentials |
| INVALID_DOCTOR | 400 | INVALID_DOCTOR | invalid doctor. Correct input or state before retry. |
| INVALID_PAYMENT_SIGNATURE | 400 | INVALID_PAYMENT_SIGNATURE | invalid payment signature. Correct input or state before retry. |
| INVALID_RESCHEDULE | 400 | INVALID_RESCHEDULE | invalid reschedule. Correct input or state before retry. |
| INVALID_SELECTION | 400 | INVALID_SELECTION | invalid selection. Correct input or state before retry. |
| INVALID_SERVICE | 400 | INVALID_SERVICE | invalid service. Correct input or state before retry. |
| INVALID_STATE | 400 | INVALID_STATE | invalid state. Correct input or state before retry. |
| INVALID_WEBHOOK | 400 | INVALID_WEBHOOK | invalid webhook. Correct input or state before retry. |
| INVALID_WEBHOOK_SIGNATURE | 400 | INVALID_WEBHOOK_SIGNATURE | invalid webhook signature. Correct input or state before retry. |
| MOCK_AUTH_REQUIRED | 401 | Mock authentication required | mock auth required. Correct input or state before retry. |
| MOCK_CONFLICT | 400 | MOCK_CONFLICT | mock conflict. Correct input or state before retry. |
| MOCK_HOLD_EXPIRED | 400 | MOCK_HOLD_EXPIRED | mock hold expired. Correct input or state before retry. |
| MOCK_NOT_FOUND | 404 | MOCK_NOT_FOUND | Resource absent or outside scope. Verify ownership rather than retrying blindly. |
| NOT_FOUND | 404 | Route-specific, or NOT_FOUND | Resource absent or outside scope. Verify ownership rather than retrying blindly. |
| ORDER_PENDING | 409 | ORDER_PENDING | Wait and reuse the hold |
| ORIGIN_NOT_ALLOWED | 403 | Origin not allowed | Correct frontend origin configuration |
| OTP_COOLDOWN | 429 | OTP_COOLDOWN | Wait for 60-second resend window |
| OTP_INVALID_OR_EXPIRED | 400 | OTP_INVALID_OR_EXPIRED | Check code or resend when eligible |
| OTP_REQUIRED | 400 | OTP_REQUIRED | otp required. Correct input or state before retry. |
| PAYMENT_MISMATCH | 400 | PAYMENT_MISMATCH | payment mismatch. Correct input or state before retry. |
| PAYMENT_NOT_CAPTURED | 400 | PAYMENT_NOT_CAPTURED | Wait for capture or reconcile; do not create a second order |
| PAYMENT_NOT_FOUND | 400 | PAYMENT_NOT_FOUND | payment not found. Correct input or state before retry. |
| PROVIDER_ORDER_MISMATCH | 400 | PROVIDER_ORDER_MISMATCH | provider order mismatch. Correct input or state before retry. |
| PROVIDER_REJECTED | 502 | External service rejected the operation | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| PROVIDER_UNAVAILABLE | 503 | External service unavailable | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| RATE_LIMIT | 429 | Try again later | Back off before retry |
| RAZORPAY_NOT_CONFIGURED | 503 | Razorpay test credentials required | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| RESCHEDULE_FEE_CHANGED | 400 | RESCHEDULE_FEE_CHANGED | reschedule fee changed. Correct input or state before retry. |
| RESCHEDULE_PENDING | 503 | Original booking retained; replacement retained for reconciliation | Stop automated retries and reconcile |
| SESSION_REQUIRED | 401 | Valid clinic session headers required | Restore patient session; do not repeat with a different owner |
| SLOT_UNAVAILABLE | 409 | SLOT_UNAVAILABLE | Refresh availability |
| SMS_PROVIDER_NOT_CONFIGURED | 503 | SMS_PROVIDER_NOT_CONFIGURED | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |
| VALIDATION_ERROR | 400 | Invalid request | validation error. Correct input or state before retry. |
| VERIFICATION_REQUIRED | 400 | VERIFICATION_REQUIRED | verification required. Correct input or state before retry. |
| WEBHOOK_NOT_CONFIGURED | 503 | WEBHOOK_NOT_CONFIGURED | Dependency or server failure. Escalate configuration errors; retry reads only after recovery. |

Widget renders the actionable state and preserves requestId. AI follows the same recovery guidance, never exposes internal errors, and must not assert booking, delivery or refund success on an error. Proposed optional metadata is safe field errors and retryAfterSeconds; keep the current envelope unless the team approves a breaking change.
