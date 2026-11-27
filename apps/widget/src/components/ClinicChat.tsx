import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, CalendarDays, Check, Headset, LoaderCircle, MessageCircle, X } from 'lucide-react'
import { ApiError, clinicApi, type ChatAction, type ChatLanguage, type PatientContext } from '../services/api'
import './ClinicChat.css'

type ChatMessage = { id: number; role: 'assistant' | 'visitor'; text: string; actions?: ChatAction[] }

const copy: Record<ChatLanguage, { title: string; online: string; welcome: string; placeholder: string; send: string; language: string; booking: string; thinking: string; unavailable: string; setup: string; retry: string; handoff: string; slots: string; confirmed: string; transaction: string }> = {
  en: { title: 'Clinic assistant', online: 'Here to help', welcome: 'Hello! I can help with clinic services, appointments, and common questions. What would you like help with?', placeholder: 'Type your message…', send: 'Send message', language: 'Language', booking: 'Continue to secure booking', thinking: 'Preparing a reply…', unavailable: 'I couldn’t send that message. Please try again.', setup: 'The chat assistant is not configured yet. You can still use the secure booking page.', retry: 'Try again', handoff: 'For help from the clinic team, contact:', slots: 'Available times shared by the clinic:', confirmed: 'Booking reference:', transaction: 'For verification and payment, continue in the secure booking flow.' },
  kn: { title: 'ಕ್ಲಿನಿಕ್ ಸಹಾಯಕ', online: 'ಸಹಾಯಕ್ಕೆ ಸಿದ್ಧ', welcome: 'ನಮಸ್ಕಾರ! ಕ್ಲಿನಿಕ್ ಸೇವೆಗಳು, ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳು ಮತ್ತು ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಹುದು. ನಿಮಗೆ ಏನು ಸಹಾಯ ಬೇಕು?', placeholder: 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಬರೆಯಿರಿ…', send: 'ಸಂದೇಶ ಕಳುಹಿಸಿ', language: 'ಭಾಷೆ', booking: 'ಸುರಕ್ಷಿತ ಬುಕಿಂಗ್ ಮುಂದುವರಿಸಿ', thinking: 'ಉತ್ತರ ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ…', unavailable: 'ಸಂದೇಶ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', setup: 'ಚಾಟ್ ಸಹಾಯಕ ಇನ್ನೂ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಸುರಕ್ಷಿತ ಬುಕಿಂಗ್ ಪುಟವನ್ನು ಬಳಸಬಹುದು.', retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', handoff: 'ಕ್ಲಿನಿಕ್ ತಂಡದ ಸಹಾಯಕ್ಕಾಗಿ ಸಂಪರ್ಕಿಸಿ:', slots: 'ಕ್ಲಿನಿಕ್ ಹಂಚಿದ ಲಭ್ಯ ಸಮಯಗಳು:', confirmed: 'ಬುಕಿಂಗ್ ಉಲ್ಲೇಖ:', transaction: 'ಪರಿಶೀಲನೆ ಮತ್ತು ಪಾವತಿಗಾಗಿ ಸುರಕ್ಷಿತ ಬುಕಿಂಗ್ ಮುಂದುವರಿಸಿ.' },
  hi: { title: 'क्लिनिक सहायक', online: 'मदद के लिए उपलब्ध', welcome: 'नमस्ते! मैं क्लिनिक सेवाओं, अपॉइंटमेंट और आम सवालों में मदद कर सकता हूँ। आपको किस बारे में मदद चाहिए?', placeholder: 'अपना संदेश लिखें…', send: 'संदेश भेजें', language: 'भाषा', booking: 'सुरक्षित बुकिंग जारी रखें', thinking: 'जवाब तैयार हो रहा है…', unavailable: 'संदेश नहीं भेजा जा सका। कृपया फिर कोशिश करें।', setup: 'चैट सहायक अभी सेट अप नहीं है। आप सुरक्षित बुकिंग पेज का इस्तेमाल कर सकते हैं।', retry: 'फिर कोशिश करें', handoff: 'क्लिनिक टीम से मदद के लिए संपर्क करें:', slots: 'क्लिनिक द्वारा दिए गए उपलब्ध समय:', confirmed: 'बुकिंग संदर्भ:', transaction: 'सत्यापन और भुगतान के लिए सुरक्षित बुकिंग जारी रखें।' },
}

function friendlyError(error: unknown, language: ChatLanguage) {
  if (error instanceof ApiError && error.code === 'AI_MODULE_NOT_CONNECTED') return copy[language].setup
  return copy[language].unavailable
}

function actionText(action: ChatAction, language: ChatLanguage): string | null {
  const words = copy[language]
  if (action.type === 'HANDOFF') return `${words.handoff} ${action.contact}`
  if (action.type === 'CONFIRMED') return `${words.confirmed} ${action.reference}`
  if (action.type === 'SELECT_SLOT' && action.slots.length) {
    const times = action.slots.slice(0, 5).map(({ start }) => {
      const date = new Date(start)
      return Number.isNaN(date.getTime()) ? start : new Intl.DateTimeFormat(language === 'kn' ? 'kn-IN' : language === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date)
    })
    return `${words.slots}\n${times.map((time) => `• ${time}`).join('\n')}`
  }
  if (action.type === 'VERIFY_OTP' || action.type === 'PAY') return words.transaction
  return null
}

export default function ClinicChat({ clinicId = 'lotus', bookingUrl = '/embed.html?clinicId=lotus&mode=page' }: { clinicId?: string; bookingUrl?: string }) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<ChatLanguage>('en')
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: 'assistant', text: copy.en.welcome }])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const session = useRef<Promise<PatientContext> | null>(null)
  const latestInput = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const messageList = useRef<HTMLDivElement>(null)
  const messageId = useRef(1)
  const words = copy[language]

  useEffect(() => {
    if (open) latestInput.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        launcher.current?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])
  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, error])

  async function getSession() {
    if (!session.current) {
      session.current = clinicApi.createSession(clinicId).then(({ clinicId: id, sessionId }) => ({ clinicId: id, sessionId })).catch((reason) => {
        session.current = null
        throw reason
      })
    }
    return session.current
  }

  async function send(text: string, addVisitor: boolean) {
    const message = text.trim()
    if (!message || loading) return
    if (addVisitor) setMessages((current) => [...current, { id: messageId.current++, role: 'visitor', text: message }])
    setDraft('')
    setError('')
    setLoading(true)
    try {
      const context = await getSession()
      const reply = await clinicApi.sendChatMessage(context, message, language)
      const actionMessages = (reply.actions ?? []).map((action) => actionText(action, reply.language ?? language)).filter((value): value is string => Boolean(value))
      setMessages((current) => [...current, { id: messageId.current++, role: 'assistant', text: reply.message, actions: reply.actions }])
      if (actionMessages.length) setMessages((current) => [...current, ...actionMessages.map((text) => ({ id: messageId.current++, role: 'assistant' as const, text }))])
    } catch (reason) {
      setError(friendlyError(reason, language))
    } finally {
      setLoading(false)
      latestInput.current?.focus()
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void send(draft, true)
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(draft, true)
    }
  }

  return <div className="clinic-chat-widget">
    {open && <section className="clinic-chat-panel" role="dialog" aria-modal="false" aria-labelledby="clinic-chat-title">
      <header className="clinic-chat-header">
        <img src="/clinicflow-logo.png" alt="" className="clinic-chat-logo" />
        <div className="clinic-chat-heading"><strong id="clinic-chat-title">{words.title}</strong><span><i aria-hidden="true" />{words.online}</span></div>
        <label className="clinic-chat-language"><span className="sr-only">{words.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as ChatLanguage)} aria-label={words.language}><option value="en">EN</option><option value="kn">ಕನ್ನಡ</option><option value="hi">हिन्दी</option></select></label>
      <button className="clinic-chat-close" type="button" onClick={() => { setOpen(false); launcher.current?.focus() }} aria-label="Close chat"><X size={22} /></button>
      </header>
      <div className="clinic-chat-messages" ref={messageList} aria-live="polite" aria-relevant="additions text">
        {messages.map((message) => <article className={`clinic-chat-message ${message.role}`} key={message.id}>
          <p>{message.text}</p>
          {message.role === 'assistant' && message.actions?.some((action) => action.type === 'CONFIRMED') && <span className="clinic-chat-confirmed"><Check size={16} /> Verified by clinic service</span>}
        </article>)}
        {loading && <div className="clinic-chat-message assistant clinic-chat-loading"><LoaderCircle size={18} className="clinic-chat-spinner" /><span>{words.thinking}</span></div>}
        {error && <div className="clinic-chat-error" role="alert"><p>{error}</p><button type="button" onClick={() => void send(messages.filter((item) => item.role === 'visitor').at(-1)?.text ?? '', false)}>{words.retry}</button></div>}
      </div>
      <div className="clinic-chat-booking"><CalendarDays size={17} /><span>For a confirmed appointment, use the secure booking flow.</span><a href={bookingUrl}>{words.booking}</a></div>
      <form className="clinic-chat-compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="clinic-chat-input">{words.placeholder}</label>
        <textarea id="clinic-chat-input" ref={latestInput} rows={1} maxLength={4000} placeholder={words.placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKeyDown} disabled={loading} />
        <button type="submit" aria-label={words.send} disabled={loading || !draft.trim()}><ArrowUp size={22} /><span className="sr-only">{words.send}</span></button>
      </form>
      <p className="clinic-chat-hint">Enter to send · Shift+Enter for a new line</p>
    </section>}
    <button ref={launcher} className={`clinic-chat-launcher${open ? ' is-open' : ''}`} type="button" aria-expanded={open} aria-haspopup="dialog" aria-label={open ? 'Close clinic chat' : 'Open clinic chat'} onClick={() => setOpen((value) => !value)}>
      {open ? <X size={25} /> : <><MessageCircle size={23} /><span>Ask the clinic</span><Headset className="clinic-chat-launcher-extra" size={19} /></>}
    </button>
  </div>
}
