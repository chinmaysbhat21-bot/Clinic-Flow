export type ApiEnvelope<T> = { ok: true; data: T; requestId: string }
export type PatientSession = { sessionId: string; clinicId: string; expiresAt: string }
export type ClinicConfig = {
  id: string
  name: string
  timezone: string
  holdSeconds: number
  operatingHours: { start: number; end: number }
  languages: Array<'en' | 'kn' | 'hi'>
  branding: { color: string }
  greeting: string
  handoff: string
  emergency: string
  faqs: Array<{ question: string; answer: string }>
  refundCutoffHours: number
}
export type Doctor = { id: string; name: string; schedule: { days: number[]; start: number; end: number } }
export type Service = { id: string; clinic_id: string; name: string; duration: number; fee: number; active: number }
export type ApiSlot = { start: string; end: string }
export type SlotHold = { id: string; start: string; end: string; fee: number; expires_at: number; state: string }
export type PatientContext = { clinicId: string; sessionId: string }

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || ''
export const hasLiveApi = Boolean(configuredBaseUrl)

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; context?: PatientContext; signal?: AbortSignal } = {}): Promise<T> {
  if (!configuredBaseUrl) throw new Error('VITE_API_BASE_URL is not configured.')
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.context) {
    headers.set('X-Clinic-Id', options.context.clinicId)
    headers.set('X-Session-Id', options.context.sessionId)
  }

  let response: Response
  try {
    response = await fetch(`${configuredBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'The clinic service could not be reached. Check that it is running and try again.')
  }

  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { code?: string; message?: string }; requestId?: string } | null
  if (!response.ok || !payload || payload.ok !== true) {
    throw new ApiError(
      response.status,
      payload?.error?.code || 'REQUEST_FAILED',
      payload?.error?.message || 'The clinic service could not complete this request.',
      payload?.requestId,
    )
  }
  return payload.data as T
}

export const clinicApi = {
  createSession(clinicId: string, signal?: AbortSignal) {
    return request<PatientSession>('/api/sessions', { method: 'POST', body: { clinicId }, signal })
  },
  getClinic(id: string, context: PatientContext, signal?: AbortSignal) {
    return request<ClinicConfig>(`/api/clinics/${encodeURIComponent(id)}/config`, { context, signal })
  },
  getDoctors(id: string, context: PatientContext, signal?: AbortSignal) {
    return request<Doctor[]>(`/api/clinics/${encodeURIComponent(id)}/doctors`, { context, signal })
  },
  getServices(id: string, context: PatientContext, signal?: AbortSignal) {
    return request<Service[]>(`/api/clinics/${encodeURIComponent(id)}/services`, { context, signal })
  },
  getSlots(context: PatientContext, doctorId: string, serviceId: string, date: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ doctorId, serviceId, date })
    return request<ApiSlot[]>(`/api/slots?${query}`, { context, signal })
  },
  recordConsent(context: PatientContext, briefing: boolean) {
    return request<{ recorded: boolean }>('/api/consent', { method: 'POST', context, body: { booking: true, briefing } })
  },
  createHold(context: PatientContext, doctorId: string, serviceId: string, start: string) {
    return request<SlotHold>('/api/holds', { method: 'POST', context, body: { doctorId, serviceId, start } })
  },
  releaseHold(context: PatientContext, holdId: string) {
    return request<{ state?: string }>(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'DELETE', context })
  },
  sendOtp(context: PatientContext, holdId: string, phone: string) {
    return request<{ delivery: string; expiresIn: number }>('/api/otp/send', { method: 'POST', context, body: { holdId, phone } })
  },
  verifyOtp(context: PatientContext, holdId: string, phone: string, code: string) {
    return request<{ state: 'OTP_VERIFIED' }>('/api/otp/verify', { method: 'POST', context, body: { holdId, phone, code } })
  },
}
