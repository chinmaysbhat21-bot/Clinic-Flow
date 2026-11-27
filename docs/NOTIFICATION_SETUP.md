# Notification delivery

Notifications are disabled by default. Local development supports console simulation and an optional Brevo Free email demo. SMS and WhatsApp selections produce private console records in development.

1. Set `NODE_ENV=development` and `NOTIFICATION_MODE=development-console` in the Git-ignored `.env`. Use fictional bookings and a private terminal. An unsafe console configuration fails at startup outside development. The default is `disabled`.
2. Optionally set `NOTIFICATION_POLL_MS=5000` (allowed 1000 through 60000) and `NOTIFICATION_REMINDER_MINUTES=1440,60` (one to eight whole-minute offsets, each between 1 and 10080).
3. Start the backend. As the patient session, record booking consent and POST `{"enabled":true,"channel":"CONSOLE","language":"en"}` to `/api/notification-preferences`. Use the same clinic and session headers as booking. To opt out, send `{"enabled":false}` while the session is active.
4. Run a fictional booking through the normal backend. The private terminal emits a `notification_simulated` record. The clinic admin API shows `SIMULATED`, which means a console operation occurred. It is not evidence of a patient receiving a message.

## Brevo Free email demo

1. Create a [Brevo Free account](https://onboarding.brevo.com/account/register/) without entering payment details. Keep the Free plan. Its [daily allowance](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan) is 300 email sends.
2. In **Settings → Senders, Domains & Dedicated IPs → Senders**, add the sender name and mailbox. Complete [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email) using the code sent to the mailbox when prompted. Brevo can rewrite a free-mail sender to a Brevo-managed address. Use an existing authenticated domain if available.
3. Check the Transactional area. If transactional sending is disabled on the new account, submit a support ticket from the account and ask for [free transactional activation](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP). Proceed only once activation is available on Free.
4. In **Settings → SMTP & API → API Keys & MCP → Generate API key**, choose restricted access for transactional email, complete identity verification if prompted, and save the [API key](https://help.brevo.com/hc/en-us/articles/40159485019794-Create-and-manage-your-API-keys) directly into the Git-ignored local `.env`.
5. Prepare an isolated fictional demo database and a test inbox whose owner has agreed to receive the specific test notification. Set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and optionally `BREVO_SENDER_NAME` (defaults to Clinic Flow). Set `BREVO_TEST_CLINIC_ID` to the demo clinic ID, for example `lotus`, and `BREVO_TEST_RECIPIENT_EMAIL` to that approved inbox. Keep `NODE_ENV=development`. Leave `NOTIFICATION_MODE=disabled` until live-send approval. Set it to `brevo` for the approved run. Use the configured inbox in the patient request `{"enabled":true,"channel":"EMAIL","language":"en","email":"demo-inbox@example.invalid"}`, replacing the example address with the approved inbox. The response omits the address.
6. For the first approved live check, prepare a fresh database with exactly one due notification from a fictional booking using local provider fixtures. Check the pending jobs before starting the worker and keep refund execution disabled. Verify the event becomes `ACCEPTED` in the clinic admin API, then check Brevo’s **Transactional → Logs** and the recipient inbox or spam folder for the message. Stop the worker and restore `NOTIFICATION_MODE=disabled` after the check. A 201 response only establishes acceptance. The worker does not ingest delivery events or update inbox status.

The demo routes email only for the configured clinic and inbox. Booking and notification consent are required. Enabling email does not verify patient mailbox ownership, so use fictional data and a dedicated demo inbox. Clinic briefings stay in the private console, and only their generic notice is displayed.

Set `BREVO_DAILY_LIMIT` to a whole number from 1 to 250, defaulting to 250. Each submission attempt reserves one unit before dispatch in a rolling 24-hour window, including retries and timeouts. Use the same SQLite database for every worker and dedicate the Brevo account to the demo or account for other usage. Work deferred by the cap stays pending, and reminders are checked for staleness again before dispatch. The cap does not block booking confirmation.

## Worker and data

The additive migration creates `notification_preferences` and `notification_jobs`. Each job references the existing outbox record. Booking and payment state transitions enqueue in the same SQLite write transaction, including transitions applied during booking recovery. Stable event keys prevent duplicate notification records. Existing legacy outbox records stay readable and are not replayed.

Supported events include confirmation, cancellation, reschedule, reminders, verified payment, refund pending, refund manual review, and consented clinic briefing notices. Refund completed is queued only when the refund worker verifies the provider outcome and sets the payment to REFUNDED. Briefing notices are generic and console-only. The worker does not send the patient-reported briefing text.

The worker rechecks current booking/payment state, the latest recorded consent and the session's selected channel immediately before dispatch. Preferences persist with the original booking session so a valid opt-in can outlast the browser session. The current self-service preference endpoint still requires an active session. After expiry, ask clinic staff for help with the booking. Brevo handles only the EMAIL channel. SMS and WhatsApp remain simulated. The worker renders English (`en`), Kannada (`kn`) or Hindi (`hi`) using the saved preference at dispatch. Omitted preferences use English by default and an unsupported stored language falls back to English.

Reminder offsets are elapsed time before a UTC appointment instant. The worker formats the message in the clinic time zone. A move invalidates old reminders and schedules new ones. A cancellation suppresses outstanding reminders. Reminders more than 15 minutes late, after the appointment, or whose booking is pending or changed are suppressed. An external provider call already in flight cannot always be withdrawn if a patient revokes consent or the booking changes.

The worker claims one due job with a 60-second lease and uses a stable notification ID as the provider idempotency key. A definite retryable failure starts at 15 seconds and doubles to a one-hour cap. The limit is eight attempts. A lost response or expired lease can be replayed only for the same provider and channel when that provider guarantees idempotency. Otherwise it moves to MANUAL. Stop the worker before manually requeuing an investigated job. Requeue only after proving non-delivery or obtaining an idempotent provider replay guarantee. Job metadata contains no raw provider errors or email addresses. The preference record stores a normalized destination hash to bind the opt-in to the configured inbox. Browser opt-out clears that hash.

## Template maintenance and samples

Keep the static subjects, bodies and field labels in `apps/api/src/notification-templates.ts`. Add every event to all three languages and review terminology with fluent Kannada and Hindi speakers. Appointment times use the selected language and the clinic time zone. Verified INR amounts use Indian digit grouping. Include amounts only for verified payments and completed refunds with recorded amounts. Pending refund notices give no credit date. A missing template or invalid date/time zone puts the notification into manual review with `RENDER_FAILED`, before reserving email quota or contacting the provider.

Email messages preserve clinic names, doctor names and booking references as stored when the details are available. Simulated console messages omit these booking details and amounts. Staff briefing notices stay generic and console-only. The examples below use the fictional clinic Harbor Clinic Test, doctor Demo Doctor, and reference DEMO-EMAIL-001. Those values are preserved in every email.

| Language | Subject | Body excerpt |
|---|---|---|
| English | Appointment confirmed | Your appointment is confirmed. Appointment time: 1 Dec 2026, 9:00 am (Asia/Kolkata). |
| Kannada | ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಣ | ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢಪಟ್ಟಿದೆ. ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಮಯ: ಡಿಸೆಂ 1, 2026, 09:00 AM (Asia/Kolkata). |
| Hindi | अपॉइंटमेंट की पुष्टि | आपके अपॉइंटमेंट की पुष्टि हो गई है। अपॉइंटमेंट का समय: 1 दिस॰ 2026, 9:00 am (Asia/Kolkata). |

## Jay and Nandan

Jay can offer an explicit opt-in in the existing booking experience. Use the normal patient session headers and existing `language` field for preferences. Keep text wrapping and Unicode rendering available to all patients. Render the clinic-scoped `GET /api/admin/notifications` list with event, status, attempt count, reason, next attempt and optional booking reference. Show SIMULATED and ACCEPTED distinctly. ACCEPTED means provider acceptance. Treat inbox delivery as unverified. Keep existing booking pending and confirmation screens based on booking state.

Nandan can collect a communication preference through the widget, keep consent separate from booking success, and pass the supported language code matching the patient’s chosen conversation language. Never invent notification delivery or include OTPs, provider payloads, or medical details in a notification request.

## Phase 8E live verification

Brevo Free accepted one fictional appointment confirmation with HTTP 201. The admin API reported ACCEPTED, SQLite recorded one quota reservation, replay made no second submission, and the recipient confirmed inbox receipt. The read-only transactional log returned HTTP 200 without a matching event. The isolated verification harness supplied the fictional subject and body through the adapter transport. Normal application templates were verified with fixtures and have no independent live-delivery result. Total cost was ₹0.
