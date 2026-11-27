# Clinic Flow patient widget

The patient booking flow runs as a standalone page and as an isolated iframe widget. The loader script works on plain HTML, React, and website builders that allow custom JavaScript.

## Run locally

Create the repository-root `.env` from `.env.example` if it does not exist. Add Razorpay **Test Mode** credentials to that backend file only. `RAZORPAY_KEY_ID` must start with `rzp_test_`; the API rejects live key IDs. Never add provider secrets to a `VITE_*` variable, the widget environment, or source code.

Start the API from the repository root in one terminal:

```powershell
npm.cmd run dev
```

For the conversational assistant, configure `LLM_PROVIDER=gemini` and `GEMINI_API_KEY` in the repository-root `.env` file. The Gemini key belongs only on the API server; never put it in `apps/widget/.env.local` or any `VITE_*` variable. The root `.env.example` lists the variable names. If the key is missing, `/api/chat` returns `AI_MODULE_NOT_CONNECTED` and the website offers the regular booking page instead.

In a second terminal, switch to this folder. Copy `.env.example` to `.env.local` if needed, confirm it contains `VITE_API_BASE_URL=http://127.0.0.1:4000`, then run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the Vite URL shown in the terminal:

- `/` — Clinic Flow landing page with links to the live test booking
- `/embed.html?clinicId=lotus&mode=page` — full-page Lotus test booking flow
- `/embed.html?clinicId=harbor` — floating Harbor widget for website embeds
- `/examples/harbor-health.html` — Harbor Health sample website
- `/examples/lotus-clinic.html` — Lotus Clinic sample website

The sample websites load the same `/widget.js` file with different clinic IDs. Lotus uses the local mock clinic adapter for development availability. Harbor uses Google Calendar and needs a valid Google access token and a calendar ID that the account can read. If Harbor returns `PROVIDER_REJECTED`, its Google Calendar request was rejected; this is not an empty day with no slots. Add the exact frontend origin, such as `http://localhost:5173`, to the backend's `ALLOWED_ORIGINS`. Restart Vite after changing the widget environment file.

For local OTP, use the code printed in the private backend development terminal. Complete payment in Razorpay Test Mode. The backend verifies the signed checkout data and authoritative provider payment state before confirming the appointment. A checkout callback alone never confirms a booking.

## Embed in plain HTML

Put this before `</body>` on a site that permits custom scripts:

```html
<script
  src="https://YOUR_WIDGET_DOMAIN/widget.js"
  data-clinic-id="harbor"
  async>
</script>
```

Replace `YOUR_WIDGET_DOMAIN` with the deployed widget host. The clinic ID selects public clinic branding/configuration; it is not an authentication credential. Do not put API keys or secrets in this tag.

## Embed in React

The simplest option is the same script tag in the React app's `index.html`. If you need to add it from a React component, use an effect:

```tsx
import { useEffect } from 'react'

export function ClinicFlowEmbed() {
  useEffect(() => {
    const clinicId = 'harbor'
    const script = document.createElement('script')
    script.src = 'https://YOUR_WIDGET_DOMAIN/widget.js'
    script.async = true
    script.dataset.clinicId = clinicId
    document.body.appendChild(script)

    return () => {
      script.remove()
      window.dispatchEvent(new CustomEvent('clinicflow:remove', { detail: { id: clinicId } }))
    }
  }, [])

  return null
}
```

Render `<ClinicFlowEmbed />` once near your app root. Replace the widget domain and clinic ID with your deployed values.

## Embed in WordPress

Add the same tag to a **Custom HTML** block or your site's approved header/footer script area. Some WordPress hosts disable scripts in page content; use the approved script area if the block removes it. Replace the clinic ID with that clinic's configured ID.

## Demo IDs and branding

- `harbor` — Harbor Health Clinic, teal branding
- `lotus` — Lotus Clinic, blue branding

The settings and appointment choices in `src/Embed.tsx` are temporary fixtures shown only when `VITE_API_BASE_URL` is unset. The example IDs match the backend's seeded clinics. With an API URL configured, an unavailable clinic displays a connection error; it does not silently switch to sample data.

## Integration status

The landing page includes an accessible chat button. It creates a patient session and sends `{ message, language }` to the authenticated `POST /api/chat` endpoint, then renders its `{ message, language, actions }` response. The interface supports English, Kannada, and Hindi, shows a loading state, and gives retry/setup messages for errors. Chat slot suggestions are informational; use the secure booking flow to hold a slot, verify OTP, pay, or confirm an appointment. Only backend-verified booking states are presented as confirmed.

The patient booking flow calls the shared API for sessions, clinic catalog, slots, consent, holds, OTP, payment order, payment verification, booking confirmation, and calendar download. Payment verification and confirmation are implemented in the backend.

When the API URL is absent, the widget labels choices as sample data and will not create a real hold, send a fake OTP, or open payment checkout. The loader prevents duplicate widgets for the same clinic on one page and validates both the iframe message origin and `event.source` before resizing.
