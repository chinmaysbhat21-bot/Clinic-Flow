# Team ownership
Backend and shared contracts belong in apps/api and packages/shared. Do not implement or rewrite apps/widget, apps/admin, or packages/ai-agent without coordination. Preserve the documented API contract; document any changes for both teammates. Never commit secrets or real patient data. Run npm run build and npm test after backend changes. Do not automatically commit or push.
