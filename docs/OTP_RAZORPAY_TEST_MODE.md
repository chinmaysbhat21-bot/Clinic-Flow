# Local OTP and Razorpay Test Mode

Development OTP delivery is simulated and costs ₹0. The API writes the code to its private local terminal without sending an SMS. A successful demo verification establishes access to the development code only. Use fictional patient details, keep the terminal private, and enter the code directly in the patient UI so it stays out of AI prompts and transcripts.

## Chinmay and Jay

1. Copy `.env.example` to `.env` at the repository root. Set a local `ADMIN_PASSWORD`, then set `NODE_ENV=development` and `OTP_MODE=development-console`. Run `npm.cmd ci` and `npm.cmd run dev`. Keep the terminal private and use fictional patient details. For production use `OTP_MODE=disabled` (or omit it). A development mode configured outside development fails at startup. There is no SMS provider configured.
2. Select **Test Mode** in the Razorpay Dashboard and generate an API key in **Settings → API Keys**. Put the test key ID and secret in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the local `.env`. Restart the API. Keep the secret on the backend. See [Razorpay API key instructions](https://axisbank-docs.razorpay.com/payment-links/api/v1/).
3. For a webhook smoke test, use an approved HTTPS test endpoint that forwards the raw body to `POST /api/payments/webhook`. Configure a separate random `RAZORPAY_WEBHOOK_SECRET` in the Dashboard and local environment. Follow the [webhook setup guide](RAZORPAY_WEBHOOK_SETUP.md) for subscriptions and provider retry limitations. Checkout verification can be exercised locally without exposing a webhook endpoint.
4. Start a Lotus patient session, select a returned slot, record consent and create a hold. Call `POST /api/otp/send` with `{holdId,phone}`. Match the hold ID to the code in the private API terminal, then send `{holdId,phone,code}` to `POST /api/otp/verify`. The code expires in 180 seconds, resend uses the same endpoint after 60 seconds, and the reservation deadline still applies.
5. Send `{holdId}` to `POST /api/payments/order`. Use its `keyId`, `orderId`, `amount` in paise and `currency` in Checkout (map keyId to `key` and orderId to `order_id`). Complete a Test Mode payment. Post `{holdId,razorpay_order_id,razorpay_payment_id,razorpay_signature}` to `POST /api/payments/verify`.
6. After `PAYMENT_VERIFIED` or `VERIFIED`, send `{holdId}` to `POST /api/bookings/confirm`. Display a booking reference only on `CONFIRMED`. Log in as the Lotus demo admin and verify the same appointment in `GET /api/admin/appointments`.

Keep the existing order when checkout fails. An authoritative failed event records FAILED, and a subsequent capture can still verify the same order. Use pending UI for `ORDER_PENDING` or `CONFIRMATION_PENDING`. Reconcile ambiguous outcomes before opening another checkout. `HOLD_EXPIRED` prevents confirmation. `REFUND_PENDING` means staff reconciliation is needed. It does not mean a refund was paid.

## Nandan

Use trusted session context to prompt the widget to request OTP and initiate checkout. The widget collects the phone/code and sends the signed checkout response directly to the backend. Keep OTP, card details, checkout signatures and secrets out of the model. Announce payment and booking outcomes only from the API. Webhooks update payment state and never confirm a booking.

## Durable processing and follow-up

Startup adds the `payment_webhook_events` table without rewriting existing data. After signature verification, the receiver deduplicates deliveries using the provider event ID and body digest. HTTP 200 follows durable receipt and job creation. The leased worker retries processing outside the request. Concurrent deliveries and client callbacks share the existing atomic payment transitions. Retain events for debugging and agree an archival policy before shared operation.

The reconciliation worker looks for authoritative order and booking evidence. Ambiguous cases without sufficient evidence require manual review. A pending move keeps its replacement slot quarantined after hold expiry. See [backend integration](BACKEND_INTEGRATION.md) for operations and recovery.

## Verified Test Mode checkout

On 2026-11-27 the Lotus test checkout produced a captured INR 500.00 payment and a paid order. The backend verified the capture, confirmed one appointment, and returned it once through the clinic admin API. Replayed verification returned VERIFIED and repeated confirmation returned the same booking. The archived SQLite records contain one matching order, hold and confirmed appointment. A separate provider API lookup confirmed one captured payment on that order. External webhook delivery remains unverified. Phase 8G separately verified manual HTTPS ingress and recovered a captured Test Mode payment by API polling. See the [verification results](RAZORPAY_WEBHOOK_SETUP.md#phase-8g-verification-and-deployment-limits).

For a future external webhook smoke test, obtain approval for an HTTPS ingress that forwards only `POST /api/payments/webhook` with the original bytes and Razorpay signature headers. Reject every other path and method at the ingress, keep the API listener on loopback, and apply a request size limit. Keep development OTP output and admin routes local. Use a distinct Test Mode webhook secret, verify delivery in the Razorpay dashboard, and remove the ingress when finished.
