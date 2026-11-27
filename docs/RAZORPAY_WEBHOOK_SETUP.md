# Razorpay Test Mode webhooks

## Local behavior

The API accepts uncompressed JSON up to 64 KiB at `POST /api/payments/webhook`. It verifies HMAC-SHA256 against the original request bytes with a dedicated `RAZORPAY_WEBHOOK_SECRET`. Keep it separate from `RAZORPAY_KEY_SECRET`. The receiver rejects missing or invalid signatures before processing and never stores the raw event, signature, or secret.

- `payment.captured`, `payment.failed`, and `order.paid` reuse payment reconciliation. `order.paid` requires matching order and payment entities. Reconciliation uses the local order to derive clinic ownership and checks the provider payment ID, order, amount, INR currency, and status. Finalized payment states cannot regress. Late capture enters the existing refund-pending workflow. The webhook never confirms an appointment.
- `refund.processed` and `refund.failed` reconcile existing submitted refund operations using authoritative refund and payment evidence. The receiver also supports the existing `refund.created` and `refund.speed_changed` notifications. It never initiates a refund. Unsupported signed events are acknowledged without payment or booking changes.
- SQLite records the event ID (or the original-body digest if the ID is absent), payload digest, validated event type and required provider IDs. A supported event and its clinic-scoped WEBHOOK job commit together. Matching duplicate receipts acknowledge without creating another job. Conflicting digests are rejected. Unknown signed event types are durably recorded as complete without creating a job.
- HTTP 200 means durable acceptance, which is separate from successful reconciliation. No provider call runs in the acknowledgement path. A database failure returns HTTP 503, and a supported event with no locally mapped order or payment also returns 503 so Razorpay can resend it after the mapping is available.

Run npm.cmd run build and npm.cmd test for local signed fixtures. The tests use fictional data and mock provider lookups.

## Acknowledgement and recovery

Razorpay expects a 2xx within five seconds and retries unsuccessful deliveries for 24 hours. The former synchronous handler could spend ten seconds on a single provider call. The receiver now acknowledges after the SQLite write commits. [Razorpay delivery policy](https://razorpay.com/docs/webhooks/setup-edit-payments)

The existing reconciliation worker claims webhook jobs with durable leases, applies authoritative payment or refund evidence and completes the job and receipt together. Provider calls run outside transactions. A restart after acceptance can resume without a provider resend. A restart during processing can recover an expired lease. If payment or refund state commits before job completion, the replay observes the finalized state without repeating its effects. Retries use the existing exponential backoff and bounded attempt count. Exhausted jobs appear as WEBHOOK in the clinic's reconciliation list and can be requeued by an authorized administrator after investigation. Manual resolve does not set webhook outcomes.

The additive migration preserves old receipt IDs, digests and processed timestamps. Older completed receipts remain complete. Older incomplete receipts have no recoverable identifiers until Razorpay redelivers an identical signed event. Reconcile manually if redelivery or replay is unavailable. The receiver stores no raw event body, signature, or secret.

## Phase 8G verification and deployment limits

- Locally signed fixtures verified raw-body HMAC, durable acknowledgement, deduplication and restart recovery.
- Manual HTTPS probes through the restricted ingress verified the allowlisted route, rejection of invalid signatures and oversized bodies, and byte preservation. The repeated signed fixture produced one durable receipt.
- Razorpay's Test Mode API independently confirmed one captured ₹500 INR payment. No Razorpay-originated POST was observed. The Dashboard exposed no replay option during verification, and the delivery failure cause is unknown.
- Razorpay API polling recovered that capture in one attempt. The isolated payment became VERIFIED and the hold became PAYMENT_VERIFIED. A second worker run found no additional work. The database had one payment, zero appointments, zero refund operations and zero webhook jobs.
- The temporary webhook was disabled and the tunnel and local listeners were closed. Actual expenditure was ₹0. Provider-originated delivery and production deployment remain unverified. A production rollout needs stable HTTPS ingress, delivery monitoring, secret rotation, and SQLite backup and restoration procedures.

## External setup after approval

1. Open PowerShell in the Phase 8G worktree. The Git-ignored `.env` supplies Test Mode credentials and the dedicated webhook secret. In the first terminal, start the isolated loopback backend:

   ```powershell
   $env:PORT = '4081'
   $env:DATABASE_PATH = 'data/phase8g-verification/clinic.db'
   $env:OTP_MODE = 'disabled'
   $env:NOTIFICATION_MODE = 'disabled'
   $env:REFUND_EXECUTION_MODE = 'disabled'
   node --env-file=.env --import tsx apps/api/src/index.ts
   ```

2. In a second terminal, start the restricted ingress. It accepts the exact webhook POST at loopback port 4080, forwards the raw body and Razorpay headers to port 4081, and returns only the upstream status.

   ```powershell
   node --import tsx apps/api/src/webhook-ingress.ts
   ```

3. After installation approval, download the Windows executable for your architecture from [Cloudflare downloads](https://developers.cloudflare.com/tunnel/downloads/), save it as `cloudflared.exe`, and verify it with `./cloudflared.exe --version`. After public tunnel approval, run `./cloudflared.exe tunnel --url http://127.0.0.1:4080` from that directory. [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) are free and require no account, card, domain or subscription. Use the generated HTTPS URL. Point the tunnel at port 4080 only. Razorpay cannot complete interactive access challenges. The Test Mode Dashboard saved the temporary hostname. Provider delivery to it remains unverified.
4. In Razorpay select **Test Mode → Accounts & Settings → Webhooks** under **Website and app settings → + Add New Webhook**. Enter `https://<generated-host>/api/payments/webhook` in **Webhook URL**. Paste the dedicated value from the isolated `.env` privately into **Secret**. Set **Alert Email** if using failure alerts. In **Active Events**, select `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, and `refund.failed`. Click **Create Webhook** and follow the Test Mode prompt if shown. [Official Dashboard setup](https://razorpay.com/docs/webhooks/setup-edit-payments)
5. Prefer Razorpay's official **Replay events** if the account has an eligible unacknowledged Test Mode event for the selected URL and event type. Use the specific-event flow with the approved entity ID. Self-service replay excludes acknowledged events and covers eligible events up to seven days old. Eligibility for a newly created endpoint is unverified. Full reconciliation requires a matching local Test Mode order or submitted refund record. [Razorpay replay guidance](https://razorpay.com/blog/payment-gateway-webhooks-india)
6. A locally signed fixture verifies the handler. Sending a fixture through the public tunnel verifies reachability. Only a request originating from Razorpay establishes external provider delivery. Correlate the Dashboard delivery with the signed SQLite receipt and local state. If no eligible replay exists, Razorpay documents that a Test Mode transaction triggers new test events. Obtain separate approval before creating one. After verification, disable or remove the Dashboard webhook and stop the tunnel, ingress and backend. [Official validation and testing](https://razorpay.com/docs/webhooks/validate-test)
