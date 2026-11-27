# Jay’s widget and dashboard contract

Set the API origin to `http://127.0.0.1:4000`. Add the exact frontend origin to ALLOWED_ORIGINS. Use [OpenAPI](openapi.yaml) for body and response schemas and [booking-flow.http](examples/booking-flow.http) for examples. Integration against BLOCKED routes is for isolated fictional fixtures only.

| Screen | Call and expected result | UI behavior and next action |
|---|---|---|
| Open widget | POST /api/sessions {clinicId}; receive sessionId, clinicId, expiresAt | Show loading, then store session for this clinic. Add X-Clinic-Id and X-Session-Id to subsequent patient requests. On 401 prompt recovery; a new session cannot access former bookings. Never log session credentials. |
| Clinic selection | GET /api/clinics/{id}/config and sibling doctors/services | Render branding, supported languages and choices. Provide empty and retry states. The catalog does not expose doctor-service assignments; handle INVALID_SELECTION. |
| Chat | POST /api/chat currently returns 501 | Show direct booking controls. Adopt proposed actions after Nandan’s contract is approved. |
| Times | GET /api/slots with doctorId, serviceId, date | Show loading, empty and available options distinctly. Localize UTC to clinic time. Refresh if selection conflicts. |
| Consent and hold | POST /api/consent with booking:true and optional briefing; POST /api/holds with doctorId/serviceId/start | Separate briefing opt-in. Countdown uses expires_at (epoch ms). Disable checkout after expiry. Use DELETE to cancel eligible holds and refresh availability. |
| OTP | POST /api/otp/send {holdId,phone}; POST /api/otp/verify adds code | Use a labeled six-digit string field. Announce errors. Disable resend for 60 seconds; expiry is 180 seconds or earlier hold expiry. Development sink is debugger-only. |
| Checkout | POST /api/payments/order {holdId}; use keyId, orderId, amount, currency | Open Razorpay Test Mode checkout. Forward its signed fields and holdId to /api/payments/verify. Never trust frontend success alone. |
| Payment result | Verification returns PAYMENT_VERIFIED or VERIFIED for captured, REFUND_PENDING for late payment | Continue to confirm only on verified. For uncertain outcomes show pending/support; never start a second payment automatically. |
| Confirmation | POST /api/bookings/confirm {holdId} | Display reference only on CONFIRMED. For 503 CONFIRMATION_PENDING preserve hold ID and use controlled same-ID retry. Download ICS through authenticated fetch, not an unauthenticated link. |
| Manage | GET /api/bookings/{id}; POST cancel or reschedule with replacement holdId | Require explicit confirmation. Show cancellation and refund pending separately. On RESCHEDULE_PENDING show original booking and escalate for reconciliation. |
| Admin login | POST /api/admin/login {email,password} | Store token securely for one-hour expiry. Apply Bearer header. On 401 prompt sign-in. |
| Dashboard | GET /api/admin/overview and /api/admin/appointments?state=CONFIRMED&search=AH- | Poll slowly while visible, back off on 429, cancel stale queries. Show reference, doctor, service, time and state. The admin list returns only the documented dashboard fields. Concurrent booking actions still need safeguards. |
| Admin edits | Use config, doctors, services and blocks routes in OpenAPI | Show validation errors and refresh after mutations. Send active explicitly when patching services. Admin reschedule submits doctorId, serviceId and start, not a holdId. |

Use native buttons and labels, logical keyboard order, visible focus, readable text, and live announcements for meaningful status changes. Avoid announcing each countdown tick. Preserve an actionable step when text wraps or zoom changes. Localize all labels and errors in the main experience for English, Kannada and Hindi. No separate elderly mode.
