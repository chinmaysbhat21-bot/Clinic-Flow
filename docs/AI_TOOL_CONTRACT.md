# Nandan’s AI tool contract

Call `executeTool(engine, name, input, {clinicId,sessionId})` from trusted server code. It rechecks clinic and session expiry and parses input with `toolArguments[name]` from the shared package. The model supplies only the arguments below. Empty objects have no required input. Unknown object keys are stripped by the current Zod object schemas. Invalid runtime tool names need an allowlist before dispatch. The function returns the value directly or throws; catch Zod errors and Faults, map them to safe codes, and never pass raw exceptions or rows to the model.

| Tool | Input object schema | Result and conditions | When to call |
|---|---|---|---|
| getClinic | {} | Raw clinic record; project id, name and safe config | Greeting/settings |
| getDoctors | {} | Array of {id:string,name:string} for active doctors | Doctor selection |
| getServices | {} | Array of service records; project id, name, duration and fee | Service selection |
| getSlots | {doctorId:string min 1,serviceId:string min 1,date:ISO date} | Array of {start:string,end:string}; adapter filters busy times | After doctor, service and date known |
| holdSlot | {doctorId:string min 1,serviceId:string min 1,start:UTC ISO datetime} | Raw hold; project id/start/end/fee/expires_at/state. Requires latest booking consent. Locks capacity temporarily. | Only after patient selects an offered slot and consents |
| getBooking | {bookingId:string} | Raw owned appointment; project display fields | Check status for a known booking |
| cancelBooking | {bookingId:string} | Raw updated appointment; confirmed booking required unless already terminal. Cancels upstream and may record refund pending. | Explicit patient confirmation required by integration policy; shared use blocked pending concurrency fix |
| rescheduleBooking | {bookingId:string,holdId:string} | Raw updated appointment; same doctor/service/fee and owned active replacement. | Explicit patient confirmation required by integration policy; shared use blocked pending concurrency fix |
| getFAQs | {} | Array of {question:string,answer:string} | Clinic FAQ |
| handoff | {} | {type:"HANDOFF",contact:string} | Unresolved requests, human assistance, or as part of following clinic emergency guidance |

On SESSION_REQUIRED, stop and prompt the widget to restore its session. On SLOT_UNAVAILABLE, refresh. On confirmation or reschedule pending, describe pending status and avoid repeating an uncertain mutation automatically. Never infer success from a tool invocation. Raw hold and appointment tool results contain internal metadata and must pass through an allowlist before entering a model context.

## Chat protocol and actions

`POST /api/chat` is mounted after patient-session authentication. Input is `{message:string,language:"en"|"kn"|"hi"}`; success data is `{message:string,language,actions:ChatAction[]}` inside the standard envelope. The route keeps agent state in a bounded, process-local map keyed by clinic and session, with a 24-hour expiry. It does not accept state from the widget. State is lost on server restart, so this storage is suitable only for the current single-process demo. Set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL` on the API server; without a configured key, the route returns `AI_MODULE_NOT_CONNECTED` (501).

The server injects `executeTool` with trusted `clinicId` and `sessionId`. The model extracts intent only and cannot call tools directly. Tool arguments are fixed by server code and validated by the shared schemas; selected entity IDs and slots come from backend results. Tool records are projected and validated before use. The current package emits these shared actions:

- SELECT_SLOT with slots [{start,end}]
- VERIFY_OTP with holdId
- PAY with holdId, orderId, amount, currency "INR", keyId
- CONFIRMED with bookingId and reference
- HANDOFF with contact

Consent, OTP send/verify, checkout, verified confirmation and briefing remain widget/backend actions, not model tools. The chat module never creates holds or claims payment/confirmation. Keep OTP entry and checkout signatures outside model context. The booking service controls payment and confirmation. The optional briefing helper only returns patient-reported text when booking is confirmed and backend-recorded consent is true; the backend remains responsible for sending it. Cancellation and rescheduling are handed to clinic staff because shared mutation use is blocked by the documented concurrency risks. Keep credentials, diagnoses and unnecessary patient information out of chat. Use actual slots, never assert payment or confirmation without backend evidence, and prioritize emergency guidance.

## Example journey

The API route has been integration-tested with a mock extractor and the seeded Lotus catalog. One minimal Gemini request succeeded for `gemini-3.5-flash-lite`; a full five-message booking through live model calls, UI consent, OTP, payment and confirmation has not been verified. The widget renders the secure booking steps and only the backend can confirm payment or booking.

| Language | Patient request | Assistant response after retrieving availability |
|---|---|---|
| English | I need a dental consultation tomorrow morning. | Please choose an available time below. We’ll ask for your consent before reserving it. |
| Kannada | ನಾಳೆ ಬೆಳಿಗ್ಗೆ ದಂತ ವೈದ್ಯರ ಸಲಹೆ ಬೇಕು. | ಕೆಳಗೆ ಲಭ್ಯವಿರುವ ಸಮಯವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ. ಸಮಯವನ್ನು ಕಾಯ್ದಿರಿಸುವ ಮೊದಲು ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಕೇಳುತ್ತೇವೆ. |
| Hindi | मुझे कल सुबह दाँतों की जाँच करानी है। | नीचे उपलब्ध समय चुनें। समय आरक्षित करने से पहले हम आपकी सहमति लेंगे। |
