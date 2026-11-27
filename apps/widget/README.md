# Clinic Flow patient widget

The widget is served in a cross-origin iframe so its styles stay separate from the clinic website. The small loader script works on plain HTML, React, and website builders that allow custom JavaScript.

## Run locally

From this folder, run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open these pages using the Vite URL shown in the terminal:

- `/` — full booking page preview
- `/examples/harbor-health.html` — Harbor Health sample site
- `/examples/lotus-clinic.html` — Lotus Clinic sample site

Both sample sites load the same `/widget.js` file and use different clinic IDs.

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

The demo settings and appointment choices are temporary fixtures in `src/Embed.tsx`. The example IDs `harbor` and `lotus` match the backend's seeded clinics. Other IDs currently fall back to the Harbor demo when no API URL is configured. Connect the clinic configuration endpoint before using real clinic IDs.

## Integration status

To connect the clinic API, copy `.env.example` to `.env.local` in PowerShell with `Copy-Item .env.example .env.local`, then restart Vite. Add the exact frontend origin, such as `http://localhost:5173`, to the backend's `ALLOWED_ORIGINS`.

The loader prevents duplicate widgets for the same clinic on one page and validates both the iframe message origin and `event.source` before resizing. When the API URL is absent, the widget labels its choices as sample data and will not create a real hold or send a fake OTP. The shared contract currently marks payment verification and booking confirmation as blocked, so the widget stops after verified phone details and clearly leaves the booking unconfirmed.
