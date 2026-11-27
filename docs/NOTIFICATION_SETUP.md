# Notification delivery

Phase 6 includes private local console simulation. No email, SMS or WhatsApp provider is configured.

1. Set `NODE_ENV=development` and `NOTIFICATION_MODE=development-console` in the Git-ignored `.env`. Use fictional bookings and a private terminal. An unsafe console configuration fails at startup outside development. The default is `disabled`.
2. Optionally set `NOTIFICATION_POLL_MS=5000` (allowed 1000 through 60000) and `NOTIFICATION_REMINDER_MINUTES=1440,60` (one to eight whole-minute offsets, each between 1 and 10080).
3. Start the backend. As the patient session, record booking consent and POST `{"enabled":true,"channel":"CONSOLE","language":"en"}` to `/api/notification-preferences`. Use the same clinic and session headers as booking. To opt out, send `{"enabled":false}` while the session is active.
4. Run a fictional booking through the normal backend. The private terminal emits a `notification_simulated` record. The clinic admin API shows `SIMULATED`, which means a console operation occurred. It is not evidence of a patient receiving a message.

## Worker and data

The additive migration creates `notification_preferences` and `notification_jobs`. Each job references the existing outbox record. Booking and payment state transitions enqueue in the same SQLite write transaction, including transitions applied during booking recovery. Stable event keys prevent duplicate notification records. Existing legacy outbox records stay readable and are not replayed.

Supported events include confirmation, cancellation, reschedule, reminders, verified payment, refund pending, refund manual review, and consented clinic briefing notices. Refund completed is queued only when the refund worker verifies the provider outcome and sets the payment to REFUNDED. Briefing notices are generic and console-only. The worker does not send the patient-reported briefing text.

The worker rechecks current booking/payment state, the latest recorded consent and the session's selected channel immediately before dispatch. Preferences persist with the original booking session so a valid opt-in can outlast the browser session. The current self-service preference endpoint still requires an active session. After expiry, ask clinic staff for help with the booking. Channels EMAIL, SMS and WHATSAPP are reserved for future providers and cannot be delivered by the console worker. Language codes en, kn and hi are preserved for future localized templates; the initial templates use English.

Reminder offsets are elapsed time before a UTC appointment instant. The worker formats the message in the clinic time zone. A move invalidates old reminders and schedules new ones. A cancellation suppresses outstanding reminders. Reminders more than 15 minutes late, after the appointment, or whose booking is pending or changed are suppressed. An external provider call already in flight cannot always be withdrawn if a patient revokes consent or the booking changes.

The worker claims one due job with a 60-second lease and uses a stable notification ID as the provider idempotency key. A definite retryable failure starts at 15 seconds and doubles to a one-hour cap. The limit is eight attempts. A lost response or expired lease can be replayed only for the same provider and channel when that provider guarantees idempotency. Otherwise it moves to MANUAL. Stop the worker before manually requeuing an investigated job. Requeue only after proving non-delivery or obtaining an idempotent provider replay guarantee. Store neither raw provider errors nor contact data in job metadata.

## Jay and Nandan

Jay can offer an explicit opt-in in the existing booking experience. Use the normal patient session headers for preferences. Render the clinic-scoped `GET /api/admin/notifications` list with event, status, attempt count, reason, next attempt and optional booking reference. Show SIMULATED and DELIVERED distinctly. Keep existing booking pending and confirmation screens based on booking state.

Nandan can collect a communication preference through the widget, keep consent separate from booking success, and pass the supported language code. Never invent notification delivery or include OTPs, provider payloads, or medical details in a notification request.
