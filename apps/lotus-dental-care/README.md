# Lotus Dental Care

A standalone, fictional dental clinic website built with React, TypeScript and Vite. All clinic, doctor, service, contact and time details are sample content.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For a production build, run `npm run build`.

## Appointments

By default the appointment section is **demo only**. It does not ask for patient details, check real availability, send requests, or confirm bookings. The example times are clearly marked as illustrative.

To connect an existing booking widget, copy `.env.example` to `.env` and set `VITE_BOOKING_WIDGET_URL` to the widget's full HTTPS URL (or a local URL during development). Restart Vite. The site will embed that widget in the appointment section and all main appointment buttons will scroll to it. The widget needs its own backend and clinic configuration. Align its doctor and service catalog with the fictional website content before using it for a real clinic.

The `VITE_` variable is public frontend configuration. Never put API keys or other secrets in it.

## Edit sample content

Doctor and service data, contact placeholders and clinic hours are near the top of `src/App.tsx`. Colors, layout and responsive styles are in `src/styles.css`.
