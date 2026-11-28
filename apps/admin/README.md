# ClinicFlow Admin

The dashboard uses the existing clinic-scoped admin API. It shows the clinic overview, filtered appointments and details with consented patient-reported visit summaries, and reconciliation, refund and notification queues.

## Run locally

From the repository root, install dependencies with `npm.cmd ci`. In the backend's ignored `.env`, set `ADMIN_PASSWORD` for local seeded admin accounts and allow the exact browser origin `http://localhost:5174` in `ALLOWED_ORIGINS`. Keep verification data fictional. Start the API with `npm.cmd run dev` and run `node apps/admin/serve.mjs` in a second terminal. Open [the dashboard](http://localhost:5174). The dashboard expects a loopback API on port 4000.

For a freshly seeded local database, use the clinic's demo email, such as `lotus@demo.invalid`, and the password you configured. The bearer token stays in memory. A reload requires sign-in again. The session clears when its one-hour timer expires or the API rejects it. Signing out revokes the token through the API, and a failed revocation clears the local session and shows a warning.

Under **Doctors**, enter a name, specialisation and availability, then select at least one active service. New doctors appear in the clinic’s patient booking widget after it reloads the catalog. The dashboard also supports editing doctor profiles, adding and editing services, and configuring clinic hours, time zone and contact. Booking mutations, advanced scheduling and manual reconciliation actions remain outside this interface.
