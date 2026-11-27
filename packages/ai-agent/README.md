# Almost Humans AI agent package

This package is a server-side module for the chat route described in `docs/AI_TOOL_CONTRACT.md`. It is deliberately dependency-injected: the API server supplies authenticated `executeTool` and trusted clinic/session IDs. It does not import database code or create patient sessions.

## Integration boundary

`apps/api/src/server.ts` mounts the package at authenticated `POST /api/chat`, uses the existing `executeTool` interface, validates actions with the shared `ChatAction` schema, and serializes only `{message, language, actions}` in the standard API envelope. Conversation state is held in a bounded in-memory map scoped to clinic and session and expires after 24 hours. A server restart clears it; multi-process deployment needs shared persistence.

## Configuration

- `LLM_PROVIDER=gemini` selects the Gemini provider.
- `GEMINI_API_KEY` is a server-only key. Keep it in the ignored repository-root `.env`; never send it to the widget or log it.
- `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`, which Google's current model and pricing documentation lists as stable and free-tier eligible.

The package uses Google's `@google/genai` SDK and Gemini Interactions API with structured JSON output and `store: false`. Zod validates every generated object after parsing. The Gemini model extracts intent only; backend code owns and validates all tools and booking operations.

Run `npm run verify:gemini -w @almost-humans/ai-agent` from the repository root after configuring the key. The script makes exactly one minimal request, disables SDK retries, and never prints the key or generated content.

## API server integration

Construct `GeminiIntentExtractor` once in server startup and inject the existing `executeTool` function. On each authenticated request, pass `clinicId` and `sessionId` from server-validated headers, plus the current server-side agent state as the third `handle` argument. Save the returned `state` on the server side. The HTTP request remains only `{message, language}`; never accept state from the widget. Return only the established chat fields. Do not put the provider key, session credential, payment fields, OTP, raw tool records, or full patient history in the model input.

The agent calls only catalog, availability, FAQ, booking-read, and handoff tools. It never creates holds or claims payment/confirmation. The widget/backend owns consent, hold, OTP, checkout, payment verification, and booking confirmation. Cancellation and rescheduling are escalated because the shared contract documents those routes as blocked for shared use.

## Build and local checks

From the repository root:

```sh
npm ci
npm run build
npm test
```

The agent does not send prior conversation history, session IDs, or backend records to the model. It does send the current patient message, which may contain health or identifying information. Google's free tier states that submitted content may be used to improve Google products; use fictional data for development and do not send real patient data until the clinic approves the provider's data terms and privacy handling. Emergency keyword checks run before the model call. Model output is validated with Zod and never dispatches a tool by itself.
