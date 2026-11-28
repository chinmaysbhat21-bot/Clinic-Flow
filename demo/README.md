# Local ClinicFlow demo

Install Node.js 24. From the repository root, run `npm.cmd ci` and `npm.cmd ci --prefix apps/widget`. Copy `demo/.env.example` to `demo/.env` and choose a local admin password. Use optional free-tier Gemini and Razorpay Test Mode keys for live chat and test checkout.

Start the website, API and dashboard together:

```powershell
node --env-file=demo/.env --import tsx demo/run.ts
```

In another terminal from the repository root, start the widget:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:4000'
npm.cmd run dev --prefix apps/widget -- --port 5173 --strictPort
```

Open [the demo website](http://127.0.0.1:5180/). Choose **Book appointment** or **Ask the clinic**. Use fictional details and find the development OTP in the first terminal. Use [Staff login](http://localhost:5174/) with `lotus@demo.invalid` and the configured password. Appointment `DEMO-ADMIN-001` has a fictional consented summary.

The in-memory demo resets at restart. Notifications are never dispatched by this runner. Live chat requires Gemini credentials, and checkout requires a Razorpay Test Mode account. The same ports must be free before startup.
