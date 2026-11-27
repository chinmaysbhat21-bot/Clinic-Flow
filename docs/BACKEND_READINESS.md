# Backend readiness audit

Phase 8 can be reviewed and published independently of Jay’s frontend. The browser integration belongs to Phase 9. Production deployment is a separate decision.

| Capability | Current evidence | Before rollout |
|---|---|---|
| Google OAuth renewal | The adapter uses a short-lived configured access token. Calendar operations were verified in Phase 5. Renewal requires replacing the token and restarting. | Choose a renewable OAuth credential, protect it in secret storage, coordinate concurrent refresh and test expiry and revocation. |
| SMS OTP | Local console delivery is explicitly development-only. Expiry, resend, retry and single-use checks are tested. | Approve a provider and sender configuration. Test provider timeouts and retries, abuse limits and delivery without exposing codes. |
| SMS, email and WhatsApp notifications | Durable outbox, preferences and delivery states are implemented. Console records are SIMULATED. | Approve channels and providers. Verify consent, contact ownership, idempotency, delivery receipts, and safe handling of ambiguous sends. |
| English, Kannada and Hindi templates | English messages render with clinic-local times. Preferred en, kn and hi codes are persisted. | Review Kannada and Hindi translations and test locale formatting, fallback and pending versus completed payment wording with Nandan. |
| Razorpay webhook delivery | Signed raw-body payment and refund handlers are tested with fixtures. Actual Test Mode checkout and refund were verified separately. | Approve an HTTPS ingress forwarding only the signed webhook route. Verify external delivery and retries without exposing admin or OTP endpoints. |
| Deployment | The API binds to loopback, uses SQLite and starts durable workers. Local type checks and fixture tests cover core flows. | Define hosting, HTTPS and ingress, shared storage and backup/restore, migration rollout, secret rotation, readiness probes, monitoring and coordinated login throttling. Run a staging smoke test before production. |
