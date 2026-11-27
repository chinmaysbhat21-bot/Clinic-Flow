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
| GOOGLE_ACCESS_TOKEN, GOOGLE_CALENDAR_ID | Authorized test calendar credentials; no built-in token refresh |
| BRIEFING_TEST_EMAIL | Required to enqueue simulated briefing; no email sender |

## Boundaries and adapters

Patient sessions require both clinic and opaque session ID; patient queries scope by owner. Admin tokens are stored hashed; clerk scope comes from the bearer token. Mock routes require a private key. Keep all provider secrets server-side. Do not log bearer tokens, OTPs, signatures, raw bodies or patient summaries. Errors carry requestId; the service does not provide structured request logging.

`BookingAdapter` exposes getSlots (busy intervals), holdSlot, findOrCreatePatient, confirmBooking, rescheduleBooking, cancelBooking. Lotus calls the stateful HTTP mock. Harbor uses Google Calendar freeBusy and event GET/POST/PATCH/DELETE, with a deterministic event ID. Calendar is not a reservation lock. It does not store phone data in events. The provider wrapper times out after ten seconds and flattens non-success answers into PROVIDER_REJECTED.

Razorpay creates an INR order for the stored hold fee and reads the provider payment before accepting capture. HMAC validates checkout signatures and configured webhook signatures. Webhook does not confirm automatically. Use only Test Mode and confirm against an authorized test calendar. Reconcile late captures as REFUND_PENDING and track provider evidence manually; no refund submission or settlement worker exists.

## Outstanding risks

- Raw patient holds, bookings and tools expose internal fields. Project explicit DTOs before sharing.
- Payment capture rechecks payment and hold state under a SQLite write lock after provider lookup. Confirmation and expiry use the same lock. A confirmation claim protects the verified payment and pending appointment even after the original hold deadline.
- The additive startup migration creates payment_order_attempts and booking_operations without rewriting existing rows. Legacy pending confirmation rows acquire a durable guard at startup. Back up the SQLite database and stop older API writers before upgrading.
- Ambiguous orders and booking operations remain guarded across restart. Recovery is manual. Stop all API writers, confirm the outcome in authoritative provider records, and call reconcileOffline from apps/api/src/recovery.ts with verified evidence. Never clear a guard while the provider outcome is uncertain. No automatic reconciliation worker or provider refund execution exists.
- A pending confirmation can occupy its appointment interval until reconciliation. Replacement holds are bounded to 24 hours. Resolve ambiguous moves promptly because a provider whose availability does not reflect the move can disagree with SQLite after that deadline.
- Fixed Kolkata offset, one Google calendar per runtime, loopback-only bind, process-local rate limiting and no deployment/persistence smoke test. Health checks key presence, not provider readiness.
- OTP is debugger-only and notification outbox is simulated. Never demo actual patient data.

Run `npm.cmd run build` and `npm.cmd test`. Integration tests use loopback HTTP, in-memory SQLite and a fake payment provider. Verify true provider behavior separately with authorized credentials.
