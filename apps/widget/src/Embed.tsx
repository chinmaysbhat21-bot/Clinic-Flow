import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Check, HeartPulse, LockKeyhole, X } from 'lucide-react'
import { ApiError, clinicApi, hasLiveApi, type ApiSlot, type AppointmentBooking, type Doctor, type PatientSession, type Service, type SlotHold } from './services/api'
import { loadRazorpayCheckout, type RazorpayFailure, type RazorpaySuccess } from './services/razorpay'
import './embed.css'

type DemoClinic = { id: string; name: string; color: string; greeting: string; holdSeconds: number; timezone: string; doctors: Doctor[]; services: Service[]; times: string[] }

// Fixture data is used only when VITE_API_BASE_URL is unset.
const demoClinics: Record<string, DemoClinic> = {
  harbor: { id: 'harbor', name: 'Harbor Health Clinic', color: '#087e76', greeting: 'Choose a service and we’ll help you find a time.', holdSeconds: 300, timezone: 'Asia/Kolkata', doctors: [{ id: 'harbor-doctor', name: 'Dr. Meera Rao', schedule: { days: [1, 2, 3, 4, 5], start: 9, end: 17 } }], services: [{ id: 'harbor-consult', clinic_id: 'harbor', name: 'General consultation', duration: 30, fee: 60000, active: 1 }, { id: 'harbor-dental', clinic_id: 'harbor', name: 'Dental check-up', duration: 30, fee: 80000, active: 1 }], times: ['10:30 AM', '11:15 AM', '12:00 PM', '2:30 PM'] },
  lotus: { id: 'lotus', name: 'Lotus Clinic', color: '#3565b8', greeting: 'Choose a service and we’ll help you find a time.', holdSeconds: 300, timezone: 'Asia/Kolkata', doctors: [{ id: 'lotus-doctor', name: 'Dr. Asha Nair', schedule: { days: [1, 2, 3, 4, 5], start: 9, end: 17 } }], services: [{ id: 'lotus-consult', clinic_id: 'lotus', name: 'General consultation', duration: 30, fee: 50000, active: 1 }, { id: 'lotus-followup', clinic_id: 'lotus', name: 'Follow-up visit', duration: 20, fee: 30000, active: 1 }], times: ['9:30 AM', '10:15 AM', '1:30 PM', '3:00 PM'] },
}

type Connection = 'demo' | 'loading' | 'ready' | 'error'

function localDate(daysAhead: number) {
  const value = new Date()
  value.setDate(value.getDate() + daysAhead)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(iso))
}

function formatDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(iso))
}

function formatChosenDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(`${date}T12:00:00`))
}

function formatFee(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100)
}

function toDemoSlots(date: string, times: string[]): ApiSlot[] {
  return times.map((time) => {
    const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    const start = new Date(`${date}T00:00:00`)
    if (match) {
      let hour = Number(match[1]) % 12
      if (match[3].toUpperCase() === 'PM') hour += 12
      start.setHours(hour, Number(match[2]), 0, 0)
    }
    const end = new Date(start.getTime() + 30 * 60_000)
    return { start: start.toISOString(), end: end.toISOString() }
  })
}

function apiMessage(error: unknown) {
  if (error instanceof ApiError) {
    const safeMessages: Record<string, string> = {
      NETWORK_ERROR: 'The clinic service is unavailable. Check that it is running and try again.',
      SESSION_REQUIRED: 'Your secure clinic session expired. Refresh the widget to start a new booking.',
      ORIGIN_NOT_ALLOWED: 'This website is not enabled for clinic booking. Ask the clinic to add its website origin.',
      INVALID_SELECTION: 'That doctor and service combination cannot be booked. Choose another option.',
      SLOT_UNAVAILABLE: 'That time was just taken. Check availability again.',
      HOLD_EXPIRED: 'Your reserved time expired. Check availability again.',
      INVALID_STATE: 'The clinic could not change this reserved time. Keep using the displayed countdown.',
      CONSENT_REQUIRED: 'Please review and accept the booking consent before reserving a time.',
      OTP_INVALID_OR_EXPIRED: 'That code is incorrect or expired. Check it or request another code.',
      OTP_COOLDOWN: 'Please wait before requesting another verification code.',
      RATE_LIMIT: 'Too many attempts. Wait a little and try again.',
      PROVIDER_UNAVAILABLE: 'The clinic calendar is temporarily unavailable. Try again shortly.',
      PROVIDER_REJECTED: 'The clinic calendar rejected this availability request. Its calendar connection needs attention. Use the Lotus test clinic to continue locally.',
      GOOGLE_AVAILABILITY_FAILED: 'The clinic calendar could not load availability. Try again shortly.',
      GOOGLE_NOT_CONFIGURED: 'The clinic calendar is not connected yet. Contact the clinic.',
      SMS_PROVIDER_NOT_CONFIGURED: 'The clinic has not connected SMS verification yet.',
      RAZORPAY_NOT_CONFIGURED: 'The clinic has not configured Razorpay Test Mode yet.',
      ORDER_PENDING: 'The payment order is still being checked. Wait a moment and try again.',
      PAYMENT_NOT_CAPTURED: 'The payment has not been verified yet. Do not pay again; try checking the booking status.',
      PAYMENT_MISMATCH: 'The payment details did not match this appointment. Contact the clinic before retrying.',
      REFUND_PENDING: 'The payment needs clinic review. Your appointment is not confirmed.',
      CONFIRMATION_PENDING: 'Payment is verified. The clinic is still confirming the appointment; check again shortly.',
      VERIFICATION_REQUIRED: 'Payment verification is required before this appointment can be confirmed.',
    }
    const message = safeMessages[error.code] || 'The clinic service could not complete this request. Try again.'
    return `${message}${error.requestId ? ` (Request ${error.requestId})` : ''}`
  }
  return 'The clinic service could not complete this request. Try again.'
}

export default function Embed({ standalone = false }: { standalone?: boolean }) {
  const clinicId = new URLSearchParams(window.location.search).get('clinicId') || 'harbor'
  const demoClinic = demoClinics[clinicId] || demoClinics.harbor
  const [clinic, setClinic] = useState<DemoClinic>(demoClinic)
  const [connection, setConnection] = useState<Connection>(hasLiveApi ? 'loading' : 'demo')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [session, setSession] = useState<PatientSession | null>(null)
  const [open, setOpen] = useState(standalone)
  const [step, setStep] = useState(0)
  const [serviceId, setServiceId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState(localDate(1))
  const [slots, setSlots] = useState<ApiSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<ApiSlot | null>(null)
  const [hold, setHold] = useState<SlotHold | null>(null)
  const [now, setNow] = useState(Date.now())
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [bookingConsent, setBookingConsent] = useState(false)
  const [briefingConsent, setBriefingConsent] = useState(false)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpMessage, setOtpMessage] = useState('')
  const [otpExpiresAt, setOtpExpiresAt] = useState(0)
  const [resendAt, setResendAt] = useState(0)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'loading' | 'checkout' | 'verifying' | 'confirming' | 'pending' | 'confirmed' | 'failed' | 'refund'>('idle')
  const [paymentMessage, setPaymentMessage] = useState('')
  const [paymentCallback, setPaymentCallback] = useState<RazorpaySuccess | null>(null)
  const [paymentRetryAllowed, setPaymentRetryAllowed] = useState(false)
  const [appointment, setAppointment] = useState<AppointmentBooking | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!hasLiveApi) return
    const controller = new AbortController()
    setConnection('loading')
    setConnectionMessage('Connecting to the clinic service…')
    clinicApi.createSession(clinicId, controller.signal).then(async (createdSession) => {
      setSession(createdSession)
      const context = { clinicId: createdSession.clinicId, sessionId: createdSession.sessionId }
      const [clinicConfig, doctors, services] = await Promise.all([
        clinicApi.getClinic(clinicId, context, controller.signal),
        clinicApi.getDoctors(clinicId, context, controller.signal),
        clinicApi.getServices(clinicId, context, controller.signal),
      ])
      const activeServices = services.filter((service) => service.active === 1)
      setClinic({
        id: clinicConfig.id,
        name: clinicConfig.name,
        color: clinicConfig.branding.color,
        greeting: clinicConfig.greeting,
        holdSeconds: clinicConfig.holdSeconds,
        timezone: clinicConfig.timezone,
        doctors,
        services: activeServices,
        times: [],
      })
      setConnection('ready')
      setConnectionMessage('Connected to the clinic service.')
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setConnection('error')
      setConnectionMessage(apiMessage(error))
    })
    return () => controller.abort()
  }, [clinicId])

  useEffect(() => {
    if (!hold) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hold])

  const service = clinic.services.find((item) => item.id === serviceId)
  const doctor = clinic.doctors.find((item) => item.id === doctorId)
  const holdSecondsLeft = hold ? Math.max(0, Math.ceil((hold.expires_at - now) / 1000)) : 0
  const accentStyle = useMemo(() => ({ '--brand': '#171614' } as CSSProperties), [])
  const steps = ['Service', 'Doctor', 'Time', 'Verify', 'Payment', 'Confirmed']

  const openWidget = () => {
    setOpen(true)
    window.parent.postMessage({ type: 'clinicflow:resize', open: true }, '*')
    window.requestAnimationFrame(() => closeRef.current?.focus())
  }
  const closeWidget = () => {
    setOpen(false)
    window.parent.postMessage({ type: 'clinicflow:resize', open: false }, '*')
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }
  const back = async () => {
    setActionError('')
    if (step === 4) setStep(3)
    else if (step === 3) {
      if (hold && hasLiveApi && session && holdSecondsLeft > 0) {
        setActionLoading(true)
        try {
          await clinicApi.releaseHold(session, hold.id)
        } catch (error) {
          setActionError(apiMessage(error))
          return
        } finally {
          setActionLoading(false)
        }
      }
      setHold(null)
      setOtpSent(false)
      setOtp('')
      setOtpMessage('')
      setStep(2)
    }
    else if (step === 2) { setStep(1); setSelectedSlot(null); setSlots([]) }
    else if (step === 1) setStep(0)
  }

  const loadSlots = async () => {
    if (!service || !doctor) return
    setAvailabilityLoading(true)
    setActionError('')
    setSelectedSlot(null)
    try {
      if (hasLiveApi) {
        if (!session) throw new Error('The clinic session is not ready. Retry the connection.')
        const available = await clinicApi.getSlots(session, doctor.id, service.id, date)
        setSlots(available)
      } else {
        setSlots(toDemoSlots(date, clinic.times))
      }
      setStep(2)
    } catch (error) {
      setActionError(apiMessage(error))
    } finally {
      setAvailabilityLoading(false)
    }
  }

  const reserveSlot = async () => {
    if (!selectedSlot || !bookingConsent) return
    if (!hasLiveApi || !session) {
      setActionError('Demo preview: this sample time is not reserved. Connect the clinic API to create a real hold.')
      return
    }
    setActionLoading(true)
    setActionError('')
    try {
      await clinicApi.recordConsent(session, briefingConsent)
      const createdHold = await clinicApi.createHold(session, doctorId, serviceId, selectedSlot.start)
      setHold(createdHold)
      setNow(Date.now())
      setStep(3)
    } catch (error) {
      setActionError(apiMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  const sendOtp = async () => {
    if (!session || !hold || phone.length !== 10 || holdSecondsLeft <= 0) return
    setActionLoading(true)
    setActionError('')
    try {
      const result = await clinicApi.sendOtp(session, hold.id, `+91${phone}`)
      setOtpSent(true)
      setOtpExpiresAt(Date.now() + result.expiresIn * 1000)
      setResendAt(Date.now() + 60_000)
      setOtpMessage(result.delivery === 'DEVELOPMENT_OUTBOX' ? 'Development OTP is available in the backend development sink.' : `Verification code sent. It expires in ${result.expiresIn} seconds.`)
    } catch (error) {
      setActionError(apiMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  const verifyOtp = async () => {
    if (!session || !hold || otp.length !== 6 || holdSecondsLeft <= 0) return
    setActionLoading(true)
    setActionError('')
    try {
      await clinicApi.verifyOtp(session, hold.id, `+91${phone}`, otp)
      setStep(4)
    } catch (error) {
      setActionError(apiMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  const confirmVerifiedBooking = async (context: PatientSession, activeHold: SlotHold) => {
    setPaymentStatus('confirming')
    setPaymentMessage('Payment verified. Waiting for the clinic to confirm your appointment…')
    try {
      const result = await clinicApi.confirmBooking(context, activeHold.id)
      if (result.state !== 'CONFIRMED') {
        setPaymentStatus('pending')
        setPaymentMessage('Payment is verified, but the clinic has not confirmed this appointment yet. Check again shortly; do not pay again.')
        return
      }
      setAppointment({
        id: result.id,
        reference: result.reference,
        doctor_id: result.doctor_id,
        service_id: result.service_id,
        start: result.start,
        end: result.end,
        state: result.state,
        fee: result.fee,
        duration: result.duration,
      })
      setPaymentStatus('confirmed')
      setPaymentMessage('Your appointment is confirmed by the clinic.')
    } catch (error) {
      const requiresReview = error instanceof ApiError && ['REFUND_PENDING', 'HOLD_EXPIRED'].includes(error.code)
      setPaymentStatus(requiresReview ? 'refund' : 'pending')
      setPaymentMessage(requiresReview
        ? 'The payment needs clinic review. Your appointment is not confirmed; do not pay again.'
        : 'Payment is verified, but appointment confirmation is still pending. Check again shortly; do not pay again.')
    }
  }

  const handlePaymentSuccess = async (context: PatientSession, activeHold: SlotHold, orderId: string, result: RazorpaySuccess) => {
    setPaymentCallback(result)
    setPaymentRetryAllowed(false)
    setActionLoading(true)
    setActionError('')
    setPaymentStatus('verifying')
    setPaymentMessage('The clinic is verifying your payment…')
    try {
      if (result.razorpay_order_id !== orderId) throw new ApiError(400, 'PAYMENT_MISMATCH', 'The checkout order did not match this appointment.')
      const verification = await clinicApi.verifyPayment(context, {
        holdId: activeHold.id,
        razorpay_order_id: result.razorpay_order_id,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_signature: result.razorpay_signature,
      })
      if (verification.state === 'REFUND_PENDING' || verification.state === 'REFUNDED') {
        setPaymentStatus('refund')
        setPaymentMessage('The payment needs clinic review. Your appointment is not confirmed.')
        setStep(5)
        return
      }
      if (verification.state !== 'PAYMENT_VERIFIED' && verification.state !== 'VERIFIED') {
        setPaymentStatus('failed')
        setPaymentRetryAllowed(verification.state === 'FAILED')
        setPaymentMessage('The clinic could not verify this payment. Do not pay again; contact the clinic for help.')
        setStep(5)
        return
      }
      setStep(5)
      await confirmVerifiedBooking(context, activeHold)
    } catch (error) {
      const invalidPayment = error instanceof ApiError && ['INVALID_PAYMENT_SIGNATURE', 'PAYMENT_MISMATCH'].includes(error.code)
      setPaymentStatus(invalidPayment ? 'failed' : 'pending')
      setPaymentRetryAllowed(false)
      setPaymentMessage(invalidPayment
        ? 'The payment details could not be verified. Your appointment is not confirmed; contact the clinic before trying again.'
        : error instanceof ApiError && error.code === 'REFUND_PENDING'
          ? 'The payment needs clinic review. Your appointment is not confirmed.'
          : 'We could not check the payment result yet. Do not pay again; check the payment status shortly.')
      setStep(5)
    } finally {
      setActionLoading(false)
    }
  }

  const startPayment = async () => {
    if (!session || !hold || holdSecondsLeft <= 0 || actionLoading) return
    setActionLoading(true)
    setActionError('')
    setPaymentStatus('loading')
    setPaymentRetryAllowed(false)
    setPaymentMessage('Preparing secure Test Mode checkout…')
    try {
      await loadRazorpayCheckout()
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable in this browser.')
      const order = await clinicApi.createPaymentOrder(session, hold.id)
      if (order.currency !== 'INR' || !Number.isInteger(order.amount) || order.amount <= 0) throw new Error('The clinic returned invalid payment details. Contact the clinic before retrying.')
      let callbackHandled = false
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: clinic.name,
        description: service?.name || 'Clinic appointment',
        order_id: order.orderId,
        prefill: { contact: `+91${phone}` },
        theme: { color: '#171614' },
        handler: async (result) => {
          callbackHandled = true
          await handlePaymentSuccess(session, hold, order.orderId, result)
        },
        modal: {
          ondismiss: () => {
            if (callbackHandled) return
            setPaymentStatus('idle')
            setPaymentMessage('Checkout closed before the clinic received a verified result. Your appointment is not confirmed. If your bank shows a debit, do not pay again; contact the clinic. If there is no debit, you can retry this same appointment.')
          },
        },
      })
      checkout.on('payment.failed', (event: RazorpayFailure) => {
        callbackHandled = true
        setPaymentStatus('failed')
        setPaymentRetryAllowed(true)
        setPaymentMessage(event.error?.description || 'The payment did not complete. Your appointment is not confirmed. You can try again.')
      })
      setPaymentStatus('checkout')
      setPaymentMessage('Complete payment in the secure Razorpay Test Mode window.')
      checkout.open()
    } catch (error) {
      setPaymentStatus('failed')
      setPaymentMessage(apiMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  const retryPaymentCheck = async () => {
    if (!session || !hold || !paymentCallback || actionLoading) return
    setPaymentStatus('verifying')
    await handlePaymentSuccess(session, hold, paymentCallback.razorpay_order_id, paymentCallback)
  }

  const downloadCalendar = async () => {
    if (!session || !appointment) return
    setCalendarLoading(true)
    setActionError('')
    try {
      const blob = await clinicApi.downloadCalendar(session, appointment.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${appointment.reference}.ics`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setActionError(apiMessage(error))
    } finally {
      setCalendarLoading(false)
    }
  }

  return <main className={standalone ? 'embed-shell embed-shell-standalone' : 'embed-shell'} style={accentStyle}>
    {!open ? <button ref={launcherRef} className="embed-launcher" type="button" aria-label={`Book an appointment at ${clinic.name}`} onClick={openWidget}><img src="/clinicflow-logo.png" alt=""/></button> : <section className={standalone ? 'embed-panel embed-panel-standalone' : 'embed-panel'} role={standalone ? undefined : 'dialog'} aria-modal={standalone ? undefined : true} aria-label={`${clinic.name} appointment booking`}>
      <header className="embed-header"><img className="embed-brand-icon" src="/clinicflow-logo.png" alt=""/><span className="embed-brand-copy"><strong>{clinic.name}</strong><span><i/> {connection === 'ready' ? 'Connected to clinic' : connection === 'loading' ? 'Connecting…' : connection === 'error' ? 'Connection issue' : 'Demo booking assistant'}</span></span>{!standalone && <button className="embed-close" type="button" onClick={closeWidget} aria-label="Close appointment booking"><X size={19}/></button>}</header>
      {connection === 'loading' ? <div className="embed-state" role="status">{connectionMessage}</div> : connection === 'error' ? <div className="embed-state" role="alert"><strong>Couldn’t load this clinic</strong><p>{connectionMessage}</p><button className="embed-primary" type="button" onClick={() => window.location.reload()}>Try again</button></div> : <>
        <div className="embed-intro"><small>{connection === 'demo' ? 'DEMO PREVIEW' : 'WELCOME'}</small><h1>{step === 4 ? 'Review payment' : step === 5 ? paymentStatus === 'confirmed' ? 'Appointment confirmed' : paymentStatus === 'refund' ? 'Payment needs review' : paymentStatus === 'failed' ? 'Payment not completed' : 'Checking your booking' : 'Let’s find a time for you.'}</h1><p>{clinic.greeting}</p></div>
        <div className="embed-flow">
          <div className="embed-step-indicator" aria-live="polite" aria-label={`Step ${step + 1} of ${steps.length}`}>{steps.map((label, index) => <span className={index <= step ? 'done' : ''} key={label}/>) }<b>Step {step + 1} of {steps.length} · {steps[step]}</b></div>
          {step === 0 && <div className="embed-step"><p className="embed-step-title">What would you like help with?</p>{clinic.services.length ? clinic.services.map((item) => <button className="embed-service" type="button" key={item.id} onClick={() => { setServiceId(item.id); setStep(1); setActionError('') }}><span><strong>{item.name}</strong><small>{item.duration} minutes</small></span><b>{formatFee(item.fee)} <ArrowRight size={14}/></b></button>) : <div className="embed-notice">No active services are available right now.</div>}</div>}
          {step === 1 && <div className="embed-step"><p className="embed-step-title">Choose a doctor and date</p><div className="embed-doctors">{clinic.doctors.map((item) => <button className={doctorId === item.id ? 'embed-doctor active' : 'embed-doctor'} aria-pressed={doctorId === item.id} type="button" key={item.id} onClick={() => setDoctorId(item.id)}><span className="embed-doctor-mark"><HeartPulse size={16}/></span><span><strong>{item.name}</strong><small>Available doctor</small></span><span className="embed-radio"/></button>)}</div><p className="embed-doctor-note">The clinic checks doctor and service availability when times are loaded.</p><label className="embed-field">Appointment date<input type="date" value={date} min={localDate(0)} onChange={(event) => setDate(event.target.value)}/></label><button className="embed-primary" type="button" disabled={!doctorId || !date || availabilityLoading} onClick={loadSlots}>{availabilityLoading ? 'Checking available times…' : 'Show available times'} <ArrowRight size={16}/></button><button className="embed-back" type="button" onClick={back}><ArrowLeft size={14}/> Back to services</button></div>}
          {step === 2 && <div className="embed-step"><p className="embed-step-title">Available times · {formatChosenDate(date, clinic.timezone)}</p>{slots.length ? <div className="embed-slots">{slots.map((item) => <button className={selectedSlot?.start === item.start ? 'embed-slot active' : 'embed-slot'} aria-pressed={selectedSlot?.start === item.start} type="button" key={item.start} onClick={() => { setSelectedSlot(item); setActionError('') }}>{formatTime(item.start, clinic.timezone)}</button>)}</div> : <div className="embed-empty">No times are available on this date. Go back and choose another date.</div>}<label className="embed-consent"><input type="checkbox" checked={bookingConsent} onChange={(event) => setBookingConsent(event.target.checked)}/><span>I agree to share my details with {clinic.name} to manage this appointment.</span></label><label className="embed-consent"><input type="checkbox" checked={briefingConsent} onChange={(event) => setBriefingConsent(event.target.checked)}/><span>Share a short visit briefing with the doctor <small>(optional)</small></span></label><button className="embed-primary" type="button" disabled={!selectedSlot || !bookingConsent || actionLoading || (hasLiveApi && !session)} onClick={reserveSlot}>{actionLoading ? 'Reserving this time…' : 'Agree and reserve time'} <ArrowRight size={16}/></button><button className="embed-back" type="button" onClick={back}><ArrowLeft size={14}/> Change doctor or date</button></div>}
          {step === 3 && <div className="embed-step"><p className="embed-step-title">Verify your phone number</p><div className="embed-hold-timer"><span>Time held by clinic</span><strong>{holdSecondsLeft > 0 ? `${Math.floor(holdSecondsLeft / 60)}:${String(holdSecondsLeft % 60).padStart(2, '0')}` : 'Expired'}</strong></div>{holdSecondsLeft > 0 ? <><label className="embed-field">Mobile number (+91)<input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={phone} maxLength={10} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}/></label>{!otpSent ? <button className="embed-primary" type="button" disabled={phone.length !== 10 || actionLoading} onClick={sendOtp}>{actionLoading ? 'Sending code…' : 'Send verification code'} <ArrowRight size={16}/></button> : <><p className="embed-delivery" role="status">{otpMessage}</p><p className="embed-expiry">{otpExpiresAt > now ? `Code expires in ${Math.ceil((otpExpiresAt - now) / 1000)} seconds.` : 'Code expired; request another.'}</p><label className="embed-field">Six-digit code<input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={otp} maxLength={6} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}/></label><button className="embed-primary" type="button" disabled={otp.length !== 6 || otpExpiresAt <= now || actionLoading} onClick={verifyOtp}>{actionLoading ? 'Verifying code…' : 'Verify code'} <Check size={16}/></button><button className="embed-resend" type="button" disabled={actionLoading || resendAt > now} onClick={sendOtp}>{resendAt > now ? `Resend code in ${Math.ceil((resendAt - now) / 1000)}s` : 'Resend code'}</button></>}</> : <div className="embed-notice" role="alert">This time hold expired. Go back and check availability again.</div>}<button className="embed-back" type="button" onClick={back}><ArrowLeft size={14}/> {holdSecondsLeft === 0 ? 'Choose another time' : 'Back to times'}</button></div>}
          {step === 4 && <div className="embed-step"><p className="embed-step-title">Check your appointment before paying</p><div className="embed-service"><span><strong>{service?.name}</strong><small>{doctor?.name}</small></span><b>{hold ? formatFee(hold.fee) : ''}</b></div><div className="embed-service"><span><strong>{selectedSlot ? formatDate(selectedSlot.start, clinic.timezone) : ''}</strong><small>{selectedSlot ? formatTime(selectedSlot.start, clinic.timezone) : ''}</small></span><Check size={17}/></div><div className="embed-notice"><strong>Razorpay Test Mode</strong><br/>The clinic sets the final amount. Test payments do not charge real money.</div>{paymentMessage && <p className="embed-delivery" role="status">{paymentMessage}</p>}<button className="embed-primary" type="button" disabled={!hold || holdSecondsLeft <= 0 || actionLoading || paymentStatus === 'checkout'} onClick={startPayment}>{paymentStatus === 'loading' ? 'Preparing secure checkout…' : paymentStatus === 'checkout' ? 'Checkout is open' : paymentStatus === 'verifying' ? 'Verifying payment…' : paymentStatus === 'confirming' ? 'Confirming appointment…' : `Pay ${hold ? formatFee(hold.fee) : ''} with Razorpay`} <LockKeyhole size={16}/></button>{holdSecondsLeft <= 0 && <div className="embed-notice" role="alert">This time hold expired. Go back and choose another available time.</div>}<button className="embed-back" type="button" onClick={back}><ArrowLeft size={14}/> Back to phone verification</button></div>}
          {step === 5 && <div className="embed-step">
            {paymentStatus === 'confirmed' && appointment ? <>
              <div className="embed-confirmed-mark"><Check size={22}/></div>
              <p className="embed-step-title">Your appointment is confirmed</p>
              <div className="embed-service"><span><strong>Booking reference</strong><small>{appointment.reference}</small></span><Check size={17}/></div>
              <div className="embed-service"><span><strong>{clinic.name}</strong><small>{clinic.doctors.find((item) => item.id === appointment.doctor_id)?.name || doctor?.name}</small></span></div>
              <div className="embed-service"><span><strong>{clinic.services.find((item) => item.id === appointment.service_id)?.name || service?.name}</strong><small>{formatDate(appointment.start, clinic.timezone)} · {formatTime(appointment.start, clinic.timezone)}</small></span><b>{formatFee(appointment.fee ?? hold?.fee ?? 0)}</b></div>
              <div className="embed-notice" role="status">Payment verified by the clinic. Your appointment is confirmed.</div>
              <button className="embed-primary" type="button" disabled={calendarLoading} onClick={downloadCalendar}>{calendarLoading ? 'Preparing calendar invite…' : 'Download calendar invite'} <ArrowRight size={16}/></button>
            </> : <>
              <p className="embed-step-title">{paymentStatus === 'refund' ? 'Payment needs clinic review' : paymentStatus === 'failed' ? 'Payment not completed' : 'Checking your booking'}</p>
              <div className={paymentStatus === 'refund' || paymentStatus === 'failed' ? 'embed-notice' : 'embed-delivery'} role={paymentStatus === 'refund' || paymentStatus === 'failed' ? 'alert' : 'status'}>{paymentMessage || 'The clinic is checking the payment and appointment status.'}</div>
              {paymentStatus === 'pending' && paymentCallback && <button className="embed-primary" type="button" disabled={actionLoading} onClick={retryPaymentCheck}>{actionLoading ? 'Checking status…' : 'Check payment and booking status'} <ArrowRight size={16}/></button>}
              {paymentStatus === 'failed' && paymentRetryAllowed && <button className="embed-primary" type="button" onClick={() => { setPaymentMessage(''); setStep(4) }}>Return to payment</button>}
            </>}
            <p className="embed-footnote">Do not repeat a payment while the clinic is checking its status.</p>
          </div>}
          {actionError && <div className="embed-error" role="alert">{actionError}</div>}
        </div>
      </>}
      <footer className="embed-footer"><LockKeyhole size={13}/> Your details stay private · {connection === 'demo' ? 'Sample data, no live booking' : 'Secure clinic connection'}</footer>
    </section>}
  </main>
}
