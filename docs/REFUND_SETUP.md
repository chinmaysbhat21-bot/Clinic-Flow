# Refund processing and operator guide

Refund eligibility follows the existing clinic cancellation cutoff. A cancellation before or exactly at the cutoff is eligible for the captured amount. A cancellation inside the cutoff is ineligible. Captures arriving after a reservation expires and confirmed evidence that a booking was never created also qualify. Ambiguous appointment operations retain their booking guard and cannot enter refund submission. Phase 7 supports one full refund operation per eligible payment. It has no public arbitrary-amount or partial-refund endpoint.

## Execution controls

- Startup creates the additive SQLite `refund_operations` table and due-job index. New eligible transitions enqueue the operation and pending notification atomically. Legacy pending rows are not automatically approved or submitted.
- `REFUND_EXECUTION_MODE=disabled` is the default. In-progress submitted operations can still be checked with read-only provider requests. Submission requires both `razorpay-test` mode with a Test Mode key and explicit, offline approval of the exact clinic and operation ID through `approveRefund` in `apps/api/src/refund-worker.ts`. Stop existing API writers before offline maintenance. Do not approve a row unless its eligibility and capture have been independently checked.
- An operator should verify the capture and order, list all refunds for that payment, and confirm no existing refunds or unresolved booking mutation. Only after an approved test, select the isolated database as `DATABASE_PATH` and enable `REFUND_EXECUTION_MODE=razorpay-test` for that run. Revert to disabled after verification. Never use production credentials for this workflow.

## Worker and evidence

The worker starts with the API and polls at `RECONCILIATION_POLL_MS`. It uses 60-second SQLite leases, up to 12 attempts, and exponential read retry backoff from 15 seconds to a one-hour cap. Provider requests run outside write transactions. A lease token fences stale workers from submitting or applying results. The worker persists a submission marker before the request and supplies its stable UUID as both Razorpay receipt and `X-Refund-Idempotency` key. After a crash, timeout or lost response it only looks up evidence. It never repeats the creation call automatically, even if the provider list is empty. A crash before the request can therefore require manual review.

The API checks payment identity, order, amount and INR against stored records. It refuses submission when an existing refund is found or the provider reports a nonzero refunded amount. To complete, authoritative provider lookups must show a matching processed refund and a cumulative refunded amount equal to the approved full amount. This updates the payment, eligible cancelled booking, operation, audit and completed notification in one transaction. Provider failure, inconsistent evidence or exhausted retries requires manual review. Preserve the original operation and submission marker. Do not generate a new refund ID for an ambiguous attempt.

Signed `refund.created`, `refund.processed`, `refund.failed` and `refund.speed_changed` events trigger provider lookup for an existing submitted operation. Durable event tracking and the same state transition protect duplicates and older events. A completed state is terminal. External webhook delivery is still an outstanding verification task.

Razorpay documents the [normal refund idempotency header](https://hdfcbank-collectnow-docs.razorpay.com/api/refunds/normal-refunds-idempotent/), [refund lookup](https://hdfcbank-collectnow-docs.razorpay.com/api/refunds/fetch-with-id/) and [refund webhook formats](https://razorpay.com/docs/webhooks/refunds/).

## Jay and Nandan

Use `GET /api/holds/{id}/refund` for the owning patient session and `GET /api/admin/refunds` for clinic staff. Display NOT_APPLICABLE, PENDING, PROCESSING, COMPLETED or MANUAL separately. A legacy pending refund without a durable operation displays MANUAL for the patient. Admin records contain amounts in paise, operational reason codes, attempt counts and optional booking reference, without provider IDs or patient details.

The notification outbox emits distinct pending, completed and manual review notices under existing patient preferences. A pending or processing refund has not been confirmed by Razorpay. A completed refund means Razorpay verified processing, which does not establish the day the bank credits the patient.
