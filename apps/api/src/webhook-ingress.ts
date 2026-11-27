import express, { type NextFunction, type Request, type Response } from 'express';
import { pathToFileURL } from 'node:url';

const webhookPath = '/api/payments/webhook';

export function createWebhookIngress(backendPort: number) {
 const app = express();
 app.disable('x-powered-by');
 app.use((req, res, next) => {
  if (req.originalUrl !== webhookPath) return void res.sendStatus(404);
  if (req.method !== 'POST') {
   res.set('Allow', 'POST');
   return void res.sendStatus(405);
  }
  if (!req.is('application/json')) return void res.sendStatus(415);
  next();
 });
 app.use(express.raw({ type: 'application/json', limit: 65536, inflate: false }));
 app.use(async (req, res) => {
  const headers = new Headers({ 'content-type': req.get('content-type')! });
  for (const name of ['x-razorpay-signature', 'x-razorpay-event-id']) {
   const value = req.get(name);
   if (value !== undefined) headers.set(name, value);
  }
  try {
   const upstream = await fetch('http://127.0.0.1:' + backendPort + webhookPath, {
    method: 'POST',
    headers,
    body: Buffer.isBuffer(req.body) ? Uint8Array.from(req.body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
   });
   await upstream.body?.cancel();
   res.status(upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status).end();
  } catch {
   res.status(502).end();
  }
 });
 app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const type = (err as { type?: string })?.type;
  res.status(type === 'entity.too.large' ? 413 : type === 'encoding.unsupported' ? 415 : 400).end();
 });
 return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 createWebhookIngress(4081).listen(4080, '127.0.0.1', () => console.log('Webhook ingress listening on 127.0.0.1:4080'));
}
