import type { NotificationEvent } from './notification-outbox.js';

const locales = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' } as const;
type Language = keyof typeof locales;
type Template = readonly [subject: string, body: string];
const templates = {
 en: {
  CONFIRMATION: ['Appointment confirmed', 'Your appointment is confirmed.'],
  CANCELLATION: ['Appointment cancelled', 'Your appointment was cancelled.'],
  RESCHEDULE: ['Appointment rescheduled', 'Your appointment has moved.'],
  REMINDER: ['Appointment reminder', 'Your appointment is coming up.'],
  PAYMENT_CONFIRMED: ['Payment verified', 'Your payment was verified.'],
  REFUND_PENDING: ['Refund pending review', 'Your refund is pending review.'],
  REFUND_COMPLETED: ['Refund confirmed', 'The payment provider confirmed your refund.'],
  REFUND_REVIEW: ['Refund assistance', 'Your refund needs clinic assistance. Please contact the clinic.'],
  BRIEFING: ['Clinic briefing', 'A consented appointment briefing is available to clinic staff.'],
 },
 kn: {
  CONFIRMATION: ['ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢೀಕರಣ', 'ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ದೃಢಪಟ್ಟಿದೆ.'],
  CANCELLATION: ['ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದು', 'ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದಾಗಿದೆ.'],
  RESCHEDULE: ['ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಮಯ ಬದಲಾವಣೆ', 'ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ನ ಸಮಯ ಬದಲಾಗಿದೆ.'],
  REMINDER: ['ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ನೆನಪೋಲೆ', 'ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ನ ಸಮಯ ಹತ್ತಿರವಾಗುತ್ತಿದೆ.'],
  PAYMENT_CONFIRMED: ['ಪಾವತಿ ಪರಿಶೀಲನೆ', 'ನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ ದೃಢಪಡಿಸಲಾಗಿದೆ.'],
  REFUND_PENDING: ['ಮರುಪಾವತಿ ಪರಿಶೀಲನೆ ಬಾಕಿ', 'ನಿಮ್ಮ ಮರುಪಾವತಿಯ ಪರಿಶೀಲನೆ ಇನ್ನೂ ಬಾಕಿಯಿದೆ.'],
  REFUND_COMPLETED: ['ಮರುಪಾವತಿ ದೃಢೀಕರಣ', 'ಪಾವತಿ ಸೇವಾ ಪೂರೈಕೆದಾರರು ನಿಮ್ಮ ಮರುಪಾವತಿಯನ್ನು ದೃಢಪಡಿಸಿದ್ದಾರೆ.'],
  REFUND_REVIEW: ['ಮರುಪಾವತಿಗೆ ಸಹಾಯ', 'ಮರುಪಾವತಿಯ ಕುರಿತು ಸಹಾಯಕ್ಕಾಗಿ ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.'],
  BRIEFING: ['ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಗೆ ಸೂಚನೆ', 'ರೋಗಿಯ ಒಪ್ಪಿಗೆಯೊಂದಿಗೆ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ನ ಸಂಕ್ಷಿಪ್ತ ಮಾಹಿತಿ ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಗೆ ಲಭ್ಯವಿದೆ.'],
 },
 hi: {
  CONFIRMATION: ['अपॉइंटमेंट की पुष्टि', 'आपके अपॉइंटमेंट की पुष्टि हो गई है।'],
  CANCELLATION: ['अपॉइंटमेंट रद्द', 'आपका अपॉइंटमेंट रद्द कर दिया गया है।'],
  RESCHEDULE: ['अपॉइंटमेंट का समय बदला', 'आपके अपॉइंटमेंट का समय बदल गया है।'],
  REMINDER: ['अपॉइंटमेंट का रिमाइंडर', 'आपके अपॉइंटमेंट का समय नज़दीक है।'],
  PAYMENT_CONFIRMED: ['भुगतान सत्यापित', 'आपके भुगतान का सत्यापन हो गया है।'],
  REFUND_PENDING: ['रिफ़ंड की समीक्षा बाकी है', 'आपके रिफ़ंड की समीक्षा अभी बाकी है।'],
  REFUND_COMPLETED: ['रिफ़ंड की पुष्टि', 'भुगतान सेवा प्रदाता ने आपके रिफ़ंड की पुष्टि की है।'],
  REFUND_REVIEW: ['रिफ़ंड में सहायता', 'रिफ़ंड में सहायता के लिए कृपया क्लिनिक से संपर्क करें।'],
  BRIEFING: ['क्लिनिक स्टाफ़ के लिए सूचना', 'मरीज़ की सहमति से अपॉइंटमेंट का सारांश क्लिनिक स्टाफ़ के लिए उपलब्ध है।'],
 },
} satisfies Record<Language, Record<NotificationEvent, Template>>;

const labels = {
 en: { when:'Appointment time', clinic:'Clinic', doctor:'Doctor', reference:'Booking reference', amount:'Amount' },
 kn: { when:'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಮಯ', clinic:'ಕ್ಲಿನಿಕ್', doctor:'ವೈದ್ಯರು', reference:'ಬುಕಿಂಗ್ ಉಲ್ಲೇಖ', amount:'ಮೊತ್ತ' },
 hi: { when:'अपॉइंटमेंट का समय', clinic:'क्लिनिक', doctor:'डॉक्टर', reference:'बुकिंग संदर्भ', amount:'राशि' },
};

type Details = {
 event: NotificationEvent;
 language: string;
 timezone: string;
 start?: string | null;
 clinic?: string | null;
 doctor?: string | null;
 reference?: string | null;
 amountPaise?: number | null;
};

export function renderNotification(details: Details) {
 const language = Object.hasOwn(locales, details.language) ? details.language as Language : 'en';
 if (!Object.hasOwn(templates.en, details.event)) return undefined;
 const [subject, body] = templates[language][details.event];
 if (details.event === 'BRIEFING') return { language, subject, text:body };

 const locale = locales[language], label = labels[language];
 const lines = [body];
 if (details.start && ['CONFIRMATION','RESCHEDULE','REMINDER'].includes(details.event)) {
  const time = new Intl.DateTimeFormat(locale, {dateStyle:'medium',timeStyle:'short',timeZone:details.timezone}).format(new Date(details.start));
  lines.push(label.when + ': ' + time + ' (' + details.timezone + ')');
 }
 if (details.clinic) lines.push(label.clinic + ': ' + details.clinic);
 if (details.doctor) lines.push(label.doctor + ': ' + details.doctor);
 if (details.reference) lines.push(label.reference + ': ' + details.reference);
 if (typeof details.amountPaise === 'number' && Number.isSafeInteger(details.amountPaise) && details.amountPaise > 0 &&
     ['PAYMENT_CONFIRMED','REFUND_COMPLETED'].includes(details.event)) {
  const amount = new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR'}).format(details.amountPaise / 100);
  lines.push(label.amount + ': ' + amount);
 }
 return { language, subject, text:lines.join('\n') };
}
