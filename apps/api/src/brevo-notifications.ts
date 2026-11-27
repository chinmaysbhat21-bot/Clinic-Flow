import { createHash } from 'node:crypto';
import { z } from 'zod';
import { configureNotificationDelivery, type NotificationProvider } from './notification-worker.js';

export const notificationEmail = z.string().trim().toLowerCase().max(254).email();

export function emailDestinationHash(email: string): string {
 return createHash('sha256').update(email).digest('hex');
}

export function configureBrevo(environment: string | undefined, env: NodeJS.ProcessEnv, request: typeof fetch = fetch): NotificationProvider {
 const sender = notificationEmail.safeParse(env.BREVO_SENDER_EMAIL);
 const recipient = notificationEmail.safeParse(env.BREVO_TEST_RECIPIENT_EMAIL);
 const apiKey = env.BREVO_API_KEY?.trim();
 const clinicId = env.BREVO_TEST_CLINIC_ID?.trim();
 const name = env.BREVO_SENDER_NAME?.trim() || 'Clinic Flow';
 const dailyLimit = Number(env.BREVO_DAILY_LIMIT ?? 250);
 if (environment !== 'development' || !sender.success || !recipient.success || !apiKey || !clinicId ||
     !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 250) {
  throw new Error('Brevo demo requires development mode, a sender, an API key, one clinic and approved test inbox, and a daily limit of 1–250.');
 }
 const simulation = configureNotificationDelivery(environment, 'development-console')!;
 return {
  key: 'brevo',
  channels: ['EMAIL', ...simulation.channels],
  idempotent: false,
  emailPolicy: { clinicId, destinationHash: emailDestinationHash(recipient.data), dailyLimit },
  async deliver(message, signal) {
   if (message.channel !== 'EMAIL') return simulation.deliver(message, signal);
   if (message.audience !== 'PATIENT' || message.clinicId !== clinicId) return 'PERMANENT';
   const response = await request('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
     sender: { email: sender.data, name },
     to: [{ email: recipient.data }],
     subject: 'Clinic Flow update',
     textContent: message.text,
    }),
   });
   if (response.status === 201) {
    const body = await response.json();
    return typeof body?.messageId === 'string' && body.messageId.trim() ? 'ACCEPTED' : 'AMBIGUOUS';
   }
   await response.body?.cancel();
   if (response.status === 429) return 'RETRY';
   if (response.status >= 400 && response.status < 500 && response.status !== 408) return 'PERMANENT';
   return 'AMBIGUOUS';
  },
 };
}
