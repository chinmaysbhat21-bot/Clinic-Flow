# Integration checklist

| Owner | Step | Current evidence or blocker |
|---|---|---|
| Jay | Open widget → POST /api/sessions → persist credential and expiry | In-memory integration fixture passes |
| Nandan | Receive request → POST /api/chat → structured actions | 501; connect approved orchestration |
| Nandan and Jay | Use discovery and getSlots or GET /api/slots | Mock availability tested; Google credentials needed |
| Jay | Choose returned time → POST /api/consent → POST /api/holds | Consent and lock tested; countdown uses expires_at |
| Jay and Chinmay | POST /api/otp/send then /verify | Backend fixture passes; debugger-only delivery |
| Jay and Chinmay | POST /api/payments/order → Checkout → /verify | Fixture passes; real Test Mode capture and race fixes pending |
| Chinmay | POST /api/bookings/confirm with same holdId | Mock fixture passes; verify pending recovery before shared use |
| Jay | GET /api/admin/appointments with a clinic admin token | Fixture passes; blocked on session credential redaction |
| Chinmay | Apply adapter event update during confirmation; verify ICS | Mock adapter tested; Google and ICS success remain unverified |

See [OpenAPI](openapi.yaml) for exact requests, responses and auth. Review the [state machine](BOOKING_STATE_MACHINE.md) and [known risks](BACKEND_INTEGRATION.md) before shared testing. Use fictional records, test keys and an authorized calendar. Check hold expiry, duplicate callbacks, foreign clinic scope, keyboard-only use, focus and localized announcements. Reserve live test checkout until credentials are available and the P0 issues are fixed. Obtain contract review from Chinmay, Jay and Nandan before freezing v0.1.0.
