# Chinmay’s backend integration contract

Express routes validate with Zod and call Engine or Payments. Engine owns SQLite writes and calls the selected BookingAdapter. SQLite uses WAL, foreign keys and BEGIN IMMEDIATE for hold overlap checks. Startup seeds Lotus (mock) and Harbor (Google). See the [README](../README.md) for setup. The npm dev workspace loads root .env; relative DATABASE_PATH is resolved from the process working directory. Standalone seed does not load .env automatically. Prefer an explicit absolute database path for consistent runs.

| Environment variable | Purpose |
|---|---|
| PORT, DATABASE_PATH | Listener defaults to 4000 on loopback; DB defaults to data/clinic.db |
| ALLOWED_ORIGINS | Comma-separated trusted browser origins |
| ADMIN_PASSWORD | Provisions missing fictional clinic admins, such as lotus@demo.invalid |
| SESSION_SECRET | Present in template, unused by current opaque session implementation |
| OTP_MODE, NODE_ENV | development OTP sink is unavailable under production NODE_ENV |
| MOCK_BASE_URL, MOCK_API_KEY | Internal mock endpoint and key; keep base aligned with chosen listener port. Default key is process-generated when unset. |
| RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET | Test-only order and capture lookup credentials; use rzp_test_ key |
| RAZORPAY_WEBHOOK_SECRET | Optional signed capture webhook; use raw request body |
| GOOGLE_ACCESS_TOKEN, GOOGLE_CALENDARS_JSON, GOOGLE_CALENDAR_ID | Scoped OAuth demo token and clinic-specific calendar map. Legacy ID applies only to Harbor. See [Google Calendar setup](GOOGLE_CALENDAR_SETUP.md). |
| NOTIFICATION_MODE, NOTIFICATION_POLL_MS, NOTIFICATION_REMINDER_MINUTES | Optional local console worker, polling and reminder offsets. See [notification setup](NOTIFICATION_SETUP.md). |
| BRIEFING_TEST_EMAIL | Required to enqueue simulated briefing; no email sender |

## Boundaries and adapters

Patient sessions require both clinic and opaque session ID; patient queries scope by owner. Admin tokens are stored hashed; clerk scope comes from the bearer token. Mock routes require a private key. Keep all provider secrets server-side. Do not log bearer tokens, OTPs, signatures, raw bodies or patient summaries. Errors carry requestId; the service does not provide structured request logging.

`BookingAdapter` exposes getSlots (busy intervals), holdSlot, findOrCreatePatient, confirmBooking, rescheduleBooking, cancelBooking. Lotus calls the stateful HTTP mock. Harbor uses Google Calendar freeBusy and event GET/POST/PATCH/DELETE, with a deterministic event ID. Calendar is not a reservation lock. It does not store phone data in events. The provider wrapper times out after ten seconds and flattens non-success answers into PROVIDER_REJECTED.

Razorpay creates an INR order for the stored hold fee and reads the provider payment before accepting capture. HMAC validates checkout signatures and configured webhook signatures. Webhook does not confirm automatically. Use only Test Mode and confirm against an authorized test calendar. Reconcile late captures as REFUND_PENDING and track provider evidence manually; no refund submission or settlement worker exists.

## Outstanding risks

- Raw patient holds, bookings and tools expose internal fields. Project explicit DTOs before sharing.
- Payment capture rechecks payment and hold state under a SQLite write lock after provider lookup. Confirmation and expiry use the same lock. A confirmation claim protects the verified payment and pending appointment even after the original hold deadline.
- The additive startup migration creates payment_order_attempts and booking_operations without rewriting existing rows. Legacy pending confirmation rows acquire a durable guard at startup. Back up the SQLite database and stop older API writers before upgrading.
- The reconciliation worker recovers orders, captures and booking operations when it can obtain matching provider evidence. Unsupported, exhausted and refund cases require operator review.
- A pending confirmation retains its appointment interval. The replacement interval remains quarantined while the durable reschedule guard exists, including after its 24-hour expiry. Quarantine applies even when provider availability is stale.

## Reconciliation worker

Startup adds the SQLite `reconciliation_jobs` table and due-job index without rewriting existing rows. The worker starts after the API listens. Set `RECONCILIATION_POLL_MS` to a value between 1000 and 60000. The default is 5000. The job scanner discovers records after a 30-second grace period. Each worker claims one due job at a time using a 60-second lease. Retries start at 15 seconds, double up to one hour and stop after 12 attempts. A terminated process leaves its lease to expire. A stale worker cannot apply its result. Normal shutdown waits for the active job before closing SQLite.

The worker reads provider state without holding a database transaction open. It looks up Razorpay Test Mode orders by receipt and captures by order, then validates the response through the existing payment transition. An absent, conflicting or inconclusive lookup never causes a second order or a refund. The mock clinic and Google Calendar support booking lookup for positive confirmation, cancellation and move evidence. A missing or unchanged booking may still have a write in flight and does not release quarantine.

The clinic-scoped `GET /api/admin/reconciliation` returns up to 200 unresolved jobs. It exposes an opaque job ID, kind, status, attempt count, next attempt, a safe reason code and an optional booking reference. Jay can show pending and manual entries separately. Nandan can continue using the existing booking API and should hand off ambiguous outcomes. Neither flow needs provider payloads or credentials.

For a manual case, inspect the original operation and authoritative provider records before acting. Stop API writers and workers before applying verified booking or order evidence through `reconcileOffline` in `apps/api/src/recovery.ts`. The worker never treats a missing record as proof of failure. A trusted operator can requeue an exhausted capture job offline by resetting its status to PENDING, its attempts to zero and its next_at to the current epoch milliseconds after checking the underlying order. Refund cases still require manual handling. The queue does not execute refunds or deliver notifications.
- One Google calendar per configured clinic, short-lived demo OAuth token, loopback-only bind, process-local rate limiting and no deployment smoke test. Health checks key presence rather than provider readiness.
- Local console OTP requires explicit development mode. Notification outbox is simulated. See [local setup](OTP_RAZORPAY_TEST_MODE.md). Never demo actual patient data.

Run `npm.cmd run build` and `npm.cmd test`. Integration tests use loopback HTTP, in-memory SQLite and a fake payment provider. Verify true provider behavior separately with authorized credentials.
