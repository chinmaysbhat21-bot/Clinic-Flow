const DISCLAIMER = "This summary contains patient-reported information and is not a medical diagnosis.";

export interface PatientBriefing {
  concern: string;
  disclaimer: typeof DISCLAIMER;
}

/** Call only after the backend confirms booking and records explicit briefing consent. */
export function buildPatientBriefing(input: {
  patientReportedConcern: string | null | undefined;
  bookingConfirmed: boolean;
  consentRecorded: boolean;
}): PatientBriefing | null {
  const concern = input.patientReportedConcern?.trim();
  if (!input.bookingConfirmed || !input.consentRecorded || !concern) return null;
  return { concern: concern.slice(0, 2000), disclaimer: DISCLAIMER };
}
