import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, Check, Clock3, HeartPulse, LockKeyhole, ShieldCheck, Stethoscope } from 'lucide-react'
import './App.css'

type Stage = 0 | 1 | 2 | 3
type ChatMessage = { from: 'assistant' | 'patient'; text: string }

const services = [
  { name: 'General consultation', detail: '20 minutes · First available doctor', price: '₹600', icon: Stethoscope },
  { name: 'Dental check-up', detail: '30 minutes · Dr. Ananya Rao', price: '₹800', icon: HeartPulse },
]
const slots = ['10:30 AM', '11:15 AM', '12:00 PM', '2:30 PM']
const labels = ['Service', 'Time', 'Your details', 'Review']

function tomorrowLabel() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

function App() {
  const [stage, setStage] = useState<Stage>(0)
  const [service, setService] = useState('')
  const [slot, setSlot] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [briefingConsent, setBriefingConsent] = useState(false)
  const [paymentInfo, setPaymentInfo] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { from: 'assistant', text: 'Hello. I can help you book an appointment at Harbor Health Clinic. What would you like to come in for?' },
  ])

  const reply = (text: string) => setMessages((items) => [...items, { from: 'patient', text }])
  const chooseService = (name: string) => {
    setService(name)
    reply(name)
    setStage(1)
    setMessages((items) => [...items, { from: 'assistant', text: `Here are available times for ${tomorrowLabel()}.` }])
  }
  const chooseSlot = (time: string) => {
    setSlot(time)
    reply(`${time} · Tomorrow`)
    setStage(2)
    setMessages((items) => [...items, { from: 'assistant', text: 'Please share your mobile number to continue.' }])
  }
  const sendPhone = () => {
    if (phone.replace(/\D/g, '').length < 10 || !consent) return
    reply(`+91 ${phone}`)
    setStage(3)
  }
  const goBack = () => {
    setStage((current) => Math.max(0, current - 1) as Stage)
    setMessages((items) => items.slice(0, -2))
  }

  return <main className="page-shell" id="home">
    <div className="demo-notice"><span className="demo-dot"/> Demo preview · Sample clinic details · No live booking or payment</div>
    <header className="topbar">
      <a className="brand" href="#home" aria-label="Clinic Flow home"><span className="brand-mark"><HeartPulse size={22} strokeWidth={2.4}/></span><span>Clinic Flow</span></a>
      <nav className="site-nav" aria-label="Main navigation">
        <a href="#services">Services</a>
        <a href="#how-it-works">How it works</a>
        <a className="nav-cta" href="#booking">Book a visit <ArrowRight size={17}/></a>
      </nav>
    </header>

    <section className="hero-section" aria-labelledby="page-title">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-rule"/> Harbor Health Clinic <span className="eyebrow-separator">·</span> Mangaluru</p>
        <h1 id="page-title">A clearer way<br/>to book <span>care.</span></h1>
        <p className="hero-description">Choose your visit, pick a time, and share only the details the clinic needs. No long forms or phone queues.</p>
        <div className="hero-actions">
          <a className="primary-button" href="#booking">Book an appointment <ArrowRight size={19}/></a>
          <a className="secondary-link" href="#how-it-works">See how it works <ArrowDown size={17}/></a>
        </div>
        <div className="hero-assurance"><ShieldCheck size={20}/><span><strong>Your information is private</strong><small>Clear consent before personal details are collected</small></span></div>
      </div>
      <aside className="hero-aside" aria-label="Booking overview">
        <span className="aside-kicker">Harbor Health Clinic</span>
        <h2>Care, without the runaround.</h2>
        <p>Three simple steps help you get from choosing a service to preparing for your visit.</p>
        <ol className="hero-steps">
          <li><span>01</span><strong>Choose a service</strong></li>
          <li><span>02</span><strong>Pick a time</strong></li>
          <li><span>03</span><strong>Share your details</strong></li>
        </ol>
        <div className="aside-footer"><Clock3 size={19}/><strong>Usually takes about 2 minutes</strong></div>
      </aside>
    </section>

    <section className="booking-section" id="booking" aria-labelledby="booking-title">
      <div className="section-heading">
        <p className="eyebrow"><span className="eyebrow-rule"/> Start here</p>
        <h2 id="booking-title">Book your visit</h2>
        <p>Follow one step at a time. You can go back to change your choices.</p>
      </div>
      <section className="chat-card" aria-label="Appointment booking assistant">
        <div className="chat-header">
          <div className="assistant-avatar"><HeartPulse size={23}/></div>
          <div className="assistant-heading"><strong>Harbor Health Clinic</strong><span><b/> Booking assistant</span></div>
          <LockKeyhole className="header-lock" size={20}/>
        </div>
        <div className="progress-area" aria-label={`Step ${stage + 1} of 4: ${labels[stage]}`}>
          <div className="progress-meta"><strong>Your appointment</strong><span>Step {stage + 1} of 4</span></div>
          <div className="progress-track">{labels.map((label, index) => <span className={index <= stage ? 'progress-segment active' : 'progress-segment'} key={label}/>)}</div>
          <div className="progress-labels">{labels.map((label, index) => <span className={index === stage ? 'current' : ''} key={label}>{label}</span>)}</div>
        </div>
        <div className="chat-body" aria-live="polite" aria-relevant="additions">
          {messages.map((message, index) => <div className={`message-row ${message.from}`} key={`${index}-${message.text}`}><div className="message-avatar" aria-hidden="true">{message.from === 'assistant' ? <HeartPulse size={17}/> : 'J'}</div><div className="message"><span>{message.text}</span>{message.from === 'assistant' && <small>Harbor Health assistant</small>}</div></div>)}

          {stage === 0 && <div className="choice-stack">{services.map(({ name, detail, price, icon: Icon }) => <button className="service-choice" key={name} onClick={() => chooseService(name)} type="button"><span className="service-icon"><Icon size={22}/></span><span className="service-copy"><strong>{name}</strong><small>{detail}</small></span><span className="service-price">{price}<ArrowRight size={19}/></span></button>)}</div>}

          {stage === 1 && <div className="slot-picker"><div className="date-heading"><span className="date-icon"><Clock3 size={21}/></span><span><strong>Tomorrow · {tomorrowLabel()}</strong><small>For {service}</small></span></div><div className="slot-grid">{slots.map((time) => <button className={slot === time ? 'slot selected' : 'slot'} type="button" key={time} onClick={() => chooseSlot(time)}>{time}</button>)}</div><button className="text-action" type="button" onClick={() => setMessages((items) => [...items, { from: 'assistant', text: 'For this demo, more dates are not connected yet.' }])}>More dates <ArrowRight size={18}/></button></div>}

          {stage === 2 && <div className="details-form"><label htmlFor="phone">Mobile number (+91)</label><div className="phone-control"><input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={phone} maxLength={10} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}/></div><p className="field-hint">We’ll send a one-time code to verify your number.</p><label className="consent-line"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>I agree to share my details with Harbor Health to manage this appointment.</span></label><label className="consent-line optional"><input type="checkbox" checked={briefingConsent} onChange={(event) => setBriefingConsent(event.target.checked)}/><span>Share a short visit briefing with the doctor <small>(optional)</small></span></label><button className="primary-button form-submit" type="button" disabled={phone.length < 10 || !consent} onClick={sendPhone}>Continue to review <ArrowRight size={19}/></button></div>}

          {stage === 3 && <div className="confirmation"><div className="confirmation-heading"><span className="confirmation-icon"><Check size={24}/></span><span><strong>Review your visit</strong><small>Please check the details below</small></span></div><div className="summary-row"><span>Service</span><strong>{service || 'General consultation'}</strong></div><div className="summary-row"><span>Time</span><strong>{slot || '10:30 AM'} · Tomorrow</strong></div><div className="summary-row"><span>Consultation fee</span><strong>{service === 'Dental check-up' ? '₹800' : '₹600'}</strong></div><button className="primary-button form-submit" type="button" onClick={() => setPaymentInfo(true)}>Continue to payment <ArrowRight size={19}/></button>{paymentInfo && <div className="inline-notice" role="status">Payments are not connected in this preview. No payment has been taken and your visit is not confirmed.</div>}<small className="demo-note">OTP and payment are not connected in this demo.</small></div>}
        </div>
        {stage > 0 && <button className="back-button" type="button" onClick={goBack}><ArrowLeft size={18}/> Back to previous step</button>}
        <div className="chat-footer"><LockKeyhole size={17}/> Your details stay private <span>·</span> Booking preview only</div>
      </section>
    </section>

    <section className="services-section" id="services" aria-labelledby="services-title">
      <div className="section-heading left-aligned">
        <p className="eyebrow"><span className="eyebrow-rule"/> Harbor Health Clinic</p>
        <h2 id="services-title">Choose the care you need</h2>
        <p>Clear service details and fees are shown before you choose a time.</p>
      </div>
      <div className="service-list">{services.map(({ name, detail, price, icon: Icon }, index) => <article className="service-information" key={name}><span className="service-number">0{index + 1}</span><span className="service-info-icon"><Icon size={26}/></span><div><h3>{name}</h3><p>{detail}</p></div><strong className="service-fee">{price}<small>sample fee</small></strong></article>)}</div>
    </section>

    <section className="how-section" id="how-it-works" aria-labelledby="how-title">
      <div className="how-copy"><p className="eyebrow"><span className="eyebrow-rule"/> Designed for clarity</p><h2 id="how-title">Easy to follow.<br/>Easy to change.</h2><p>Booking is broken into small steps, with large choices and plain instructions. You can review your visit before continuing.</p></div>
      <div className="how-points"><div><span>01</span><p><strong>Choose from clear options</strong><small>Pick a service and a time that works for you.</small></p></div><div><span>02</span><p><strong>Share only what is needed</strong><small>Your details are requested after you choose a time.</small></p></div><div><span>03</span><p><strong>Review before payment</strong><small>Check the visit details before you continue.</small></p></div></div>
    </section>

    <footer className="page-footer"><a className="brand footer-brand" href="#home"><span className="brand-mark"><HeartPulse size={20}/></span><span>Clinic Flow</span></a><p>For urgent medical help, contact local emergency services.</p><a href="#home">Back to top ↑</a></footer>
  </main>
}

export default App
