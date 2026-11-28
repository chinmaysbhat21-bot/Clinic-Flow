# Almost Humans

Clinic appointment booking backend. Node.js 24, Express, TypeScript, Zod, SQLite and npm workspaces.

Copy `.env.example` to `.env` locally and choose a development admin password. Install the locked dependencies with `npm.cmd ci` if needed, then run `npm.cmd run dev`. Startup seeds fictional clinics. The service listens at `http://127.0.0.1:4000`. Verify with `curl.exe http://127.0.0.1:4000/api/health`, `npm.cmd run build` and `npm.cmd test`.

- [API contract and endpoint inventory](docs/API_CONTRACT.md)
- [OpenAPI 3.1](docs/openapi.yaml)
- [Backend setup and risks](docs/BACKEND_INTEGRATION.md)
- [Widget and dashboard](docs/FRONTEND_INTEGRATION.md)
- [AI tools](docs/AI_TOOL_CONTRACT.md)
- [Booking states](docs/BOOKING_STATE_MACHINE.md)
- [Errors](docs/ERROR_CODES.md)
- [Integration checklist](docs/INTEGRATION_CHECKLIST.md)
- [HTTP examples](docs/examples/booking-flow.http)
- [Nandan's AI agent package](packages/ai-agent/README.md)

The local test suite uses a stateful mock clinic and a payment fixture. Booking mutations retain the concurrency risks documented above. Use fictional data only.

## Patient widget

The patient-facing widget is in [`apps/widget`](apps/widget/README.md). To run its standalone preview:

```powershell
cd apps/widget
npm.cmd install
npm.cmd run dev
```

See the widget README for local embed examples and API setup instructions.
