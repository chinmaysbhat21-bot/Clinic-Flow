# Local OTP and Razorpay Test Mode

## Chinmay and Jay

1. Copy `.env.example` to `.env` at the repository root. Set a local `ADMIN_PASSWORD`, then set `NODE_ENV=development` and `OTP_MODE=development-console`. Run `npm.cmd ci` and `npm.cmd run dev`. Keep the terminal private and use fictional patient details. For production use `OTP_MODE=disabled` (or omit it). A development mode configured outside development fails at startup. There is no SMS provider configured.
2. Select **Test Mode** in the Razorpay Dashboard and generate an API key in **Settings → API Keys**. Put the test key ID and secret in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the local `.env`. Restart the API. Keep the secret on the backend. See [Razorpay API key instructions](https://axisbank-docs.razorpay.com/payment-links/api/v1/).
3. For a webhook smoke test, use an approved HTTPS test endpoint that forwards the raw body to `POST /api/payments/webhook`. Configure a separate random `RAZORPAY_WEBHOOK_SECRET` in the Dashboard and local environment. Subscribe to `payment.captured` and `payment.failed`. Checkout verification can be exercised locally without exposing a webhook endpoint.
4. Start a Lotus patient session, select a returned slot, record consent and create a hold. Call `POST /api/otp/send` with `{holdId,phone}`. Match the hold ID to the code in the private API terminal, then send `{holdId,phone,code}` to `POST /api/otp/verify`. The code expires in 180 seconds, resend uses the same endpoint after 60 seconds, and the reservation deadline still applies.
5. Send `{holdId}` to `POST /api/payments/order`. Use its `keyId`, `orderId`, `amount` in paise and `currency` in Checkout (map keyId to `key` and orderId to `order_id`). Complete a Test Mode payment. Post `{holdId,razorpay_order_id,razorpay_payment_id,razorpay_signature}` to `POST /api/payments/verify`.
6. After `PAYMENT_VERIFIED` or `VERIFIED`, send `{holdId}` to `POST /api/bookings/confirm`. Display a booking reference only on `CONFIRMED`. Log in as the Lotus demo admin and verify the same appointment in `GET /api/admin/appointments`.

Keep the existing order when checkout fails. An authoritative failed event records FAILED, and a subsequent capture can still verify the same order. Use pending UI for `ORDER_PENDING` or `CONFIRMATION_PENDING`. Reconcile ambiguous outcomes before opening another checkout. `HOLD_EXPIRED` prevents confirmation. `REFUND_PENDING` means staff reconciliation is needed. It does not mean a refund was paid.

## Nandan

Use trusted session context to prompt the widget to request OTP and initiate checkout. The widget collects the phone/code and sends the signed checkout response directly to the backend. Keep OTP, card details, checkout signatures and secrets out of the model. Announce payment and booking outcomes only from the API. Webhooks update payment state and never confirm a booking.

## Durable processing and follow-up

Startup adds the `payment_webhook_events` table without rewriting existing data. Authenticated event IDs and body digests deduplicate deliveries. Transient processing failures leave the event retryable. Concurrent deliveries and client callbacks share Phase 2's atomic payment transitions. Retain events for debugging and agree an archival policy before shared operation.

Ambiguous order and booking outcomes still require manual provider reconciliation. Resolve a pending move before its replacement hold expires. A future worker should inspect provider records and release guards only on authoritative evidence, starting with ambiguous reschedules. Separate future work can add retryable notification delivery and provider-confirmed, idempotent refund execution.

## Verified Test Mode checkout

On 2026-11-27 the Lotus test checkout produced a captured INR 500.00 payment and a paid order. The backend verified the capture, confirmed one appointment, and returned it once through the clinic admin API. Replayed verification returned VERIFIED and repeated confirmation returned the same booking. The archived SQLite records contain one matching order, hold and confirmed appointment. A separate provider API lookup confirmed one captured payment on that order. External webhook delivery remains unverified; the integration suite exercises signed deliveries locally.
