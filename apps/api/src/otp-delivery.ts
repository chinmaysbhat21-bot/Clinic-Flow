export interface OtpDelivery {
 deliver(holdId: string, code: string, phone: string): void;
}

export function configureOtpDelivery(
 environment: string | undefined,
 mode: string | undefined,
 write: (line: string) => void = console.error,
): OtpDelivery | undefined {
 if (mode === undefined || mode === 'disabled') return undefined;
 if (environment !== 'development' || !['development', 'development-console'].includes(mode)) {
  throw new Error('OTP configuration is unsafe or unsupported. Local delivery requires NODE_ENV=development.');
 }
 return {
  deliver(holdId, code) {
   write(`[local OTP] hold=${holdId} code=${code}`);
  },
 };
}
