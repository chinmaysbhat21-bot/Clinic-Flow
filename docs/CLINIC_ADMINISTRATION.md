# Clinic administration

Use `POST /api/admin/login` for a clinic-scoped bearer token. The token expires in one hour. `DELETE /api/admin/session` revokes the current token. Existing sessions without an administrator association require signing in again. The login limiter is process-local.

Startup adds administrator roles and session linkage, doctor specialization, service descriptions, nullable appointment fee and duration snapshots, and an audit details table. Old appointment snapshots can be null. Audit responses add the actor ID where available and omit free-form metadata.

`GET /api/admin/summary` separates appointment counts, reconciliation, payments, refunds, and simulated versus delivered notifications. Existing list routes remain available. Appointments accept `state`, `search`, `doctorId`, and `from`/`to` calendar dates inclusive in the clinic time zone. Details are clinic scoped and exclude patient session credentials. Money is in paise.

Clinic configuration accepts an IANA time zone, `holidays` with ISO dates, and `breaks` with local `HH:mm` boundaries and optional weekday numbers. A doctor's schedule can also include breaks. Doctor-service assignments use `/api/admin/doctors/{id}/services`. Delete a block through `/api/admin/blocks/{id}`. Configuration changes affect new availability. Conflict warnings describe existing appointments that need staff review. Existing bookings and payment amounts are preserved.

Only `MANUAL` reconciliation jobs may be requeued or resolved. Both routes require a reason. The API records that a reason was supplied without storing free text in the audit log. Resolve reads authoritative provider evidence. An inconclusive lookup retains the existing guard. Refund resolution can only check an already submitted refund and cannot initiate another financial operation. Staff should use the existing offline operator procedure when positive evidence is unavailable.

Jay can integrate these routes behind the existing admin sign-in. Nandan should continue relying on patient availability and booking statuses and route unresolved operations to clinic staff. No additional environment variables are required.

## Dashboard request examples

Send JSON bodies with `Content-Type: application/json`. Except for login, send `Authorization: Bearer <token>`. Success returns `{"ok":true,"data":...,"requestId":"request-demo"}`. The table shows representative values of `data`.

| Request | Example body | Example data |
|---|---|---|
| POST /api/admin/login | `{"email":"lotus@demo.invalid","password":"<demo-password>"}` | `{"token":"<bearer-token>","clinicId":"lotus","adminId":"admin-demo","role":"OWNER","expiresIn":3600}` |
| DELETE /api/admin/session | None | `{"loggedOut":true}` |
| GET /api/admin/appointments?from=2026-12-01&to=2026-12-01&state=CONFIRMED | None | Array of appointment summaries |
| GET /api/admin/appointments/booking-demo | None | See the appointment detail example in [OpenAPI](openapi.yaml) |
| GET /api/admin/summary | None | See the full summary example in [OpenAPI](openapi.yaml) |
| POST /api/admin/services | `{"name":"Consultation","duration":30,"fee":50000}` | `{"id":"service-demo"}` (201) |
| PATCH /api/admin/doctors/lotus-doctor/availability | `{"days":[1,2,3,4,5],"start":9,"end":17,"breaks":[{"start":"12:00","end":"13:00"}]}` | `{"updated":true,"warnings":[]}` |
| PATCH /api/admin/config | `{"holidays":[{"date":"2026-12-25"}]}` | Updated clinic configuration and warnings |
| POST /api/admin/appointments/booking-demo/reschedule | `{"doctorId":"lotus-doctor","serviceId":"lotus-consult","start":"2026-12-02T03:30:00.000Z"}` | Updated appointment summary |
| POST /api/admin/reconciliation/job-demo/requeue | `{"reason":"Provider is available again"}` | `{"jobId":"job-demo","kind":"CAPTURE","status":"PENDING","resolution":"REQUEUED"}` |

A cross-clinic lookup returns 404. A missing or expired token returns 401. An inconclusive reconciliation can return `{"ok":false,"error":{"code":"RECONCILIATION_EVIDENCE_UNAVAILABLE","message":"Authoritative provider booking state could not confirm resolution"},"requestId":"request-demo"}` with HTTP 409. Retain pending status and the guard.
