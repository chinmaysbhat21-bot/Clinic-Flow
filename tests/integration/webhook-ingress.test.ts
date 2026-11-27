import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { openDb } from '../../apps/api/src/db.js';
import { createApp } from '../../apps/api/src/server.js';
import { signature } from '../../apps/api/src/core.js';
import { createWebhookIngress } from '../../apps/api/src/webhook-ingress.js';

async function port(server: Server) {
 await once(server, 'listening');
 const address = server.address();
 assert.ok(address && typeof address === 'object');
 return address.port;
}

async function close(server: Server) {
 server.closeAllConnections();
 await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('loopback webhook ingress forwards only the allowed route and preserves signed bytes and headers', async () => {
 const webhookPath = '/api/payments/webhook';
 const body = Buffer.from(' { "event": "fixture.unknown", "payload": { "label": "ಪರೀಕ್ಷೆ" } }\n');
 const expectedSignature = signature('fixture-ingress-secret', body);
 const calls: Array<{ url?: string; headers: Record<string, unknown>; body: Buffer }> = [];
 let status = 200;
 const upstream = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  calls.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(status, {location:'http://127.0.0.1:1/private'});
  res.end('private upstream response');
 }).listen(0, '127.0.0.1');
 const ingress = createWebhookIngress(await port(upstream)).listen(0, '127.0.0.1');

 try {
  const base = 'http://127.0.0.1:' + await port(ingress);
  for (const path of ['/api/health','/api/admin/appointments','/api/sessions',webhookPath+'?extra=1',webhookPath+'/']) {
   assert.equal((await fetch(base+path,{method:'POST'})).status,404);
  }
  for (const method of ['GET','HEAD','OPTIONS','PUT','PATCH','DELETE']) {
   assert.equal((await fetch(base+webhookPath,{method})).status,405);
  }
  const post = (payload: Uint8Array, headers: Record<string,string>) =>
   fetch(base+webhookPath,{method:'POST',headers,body:Uint8Array.from(payload)});
  assert.equal((await post(body,{'content-type':'text/plain'})).status,415);
  assert.equal((await post(gzipSync(body),{'content-type':'application/json','content-encoding':'gzip'})).status,415);
  assert.equal((await post(Buffer.alloc(65537),{'content-type':'application/json'})).status,413);
  assert.equal(calls.length,0);

  const response = await post(body,{'content-type':'application/json','x-razorpay-signature':expectedSignature,
   'x-razorpay-event-id':'fixture-event-id','authorization':'fixture-private','x-clinic-id':'fixture-other-clinic'});
  assert.equal(response.status,200);
  assert.equal(await response.text(),'');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].body,body);
  assert.equal(calls[0].url,webhookPath);
  assert.equal(calls[0].headers['x-razorpay-signature'],expectedSignature);
  assert.equal(calls[0].headers['x-razorpay-event-id'],'fixture-event-id');
  assert.equal(calls[0].headers.authorization,undefined);
  assert.equal(calls[0].headers['x-clinic-id'],undefined);
  status=302;
  assert.equal((await post(body,{'content-type':'application/json'})).status,502);
 } finally {
  await close(ingress);
  await close(upstream);
 }
});

test('the real webhook handler verifies a signed fixture through the restricted ingress', async () => {
 const db = openDb(':memory:');
 const secret = 'fixture-end-to-end-ingress-secret';
 const backend = createApp(db, { webhookSecret: secret, mockKey: 'fixture-only' }).app.listen(0, '127.0.0.1');
 const ingress = createWebhookIngress(await port(backend)).listen(0, '127.0.0.1');
 try {
  const endpoint = 'http://127.0.0.1:' + await port(ingress) + '/api/payments/webhook';
  const body = ' {"event":"fixture.unknown","payload":{"label":"परीक्षण"}}\n';
  const headers = { 'content-type':'application/json', 'x-razorpay-event-id':'ingress-signed-fixture',
   'x-razorpay-signature':signature(secret, body) };
  assert.equal((await fetch(endpoint, {method:'POST',headers,body:body+' '})).status,400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_webhook_events').get()?.n,0);
  assert.equal((await fetch(endpoint, {method:'POST',headers,body})).status,200);
  assert.ok(db.prepare("SELECT processed_at FROM payment_webhook_events WHERE id='ingress-signed-fixture'").get()?.processed_at);
  assert.equal((await fetch(endpoint, {method:'POST',headers,body})).status,200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_webhook_events').get()?.n,1);
 } finally {
  await close(ingress);
  await close(backend);
  db.close();
 }
});
