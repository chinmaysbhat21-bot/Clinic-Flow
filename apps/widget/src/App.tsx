import { ArrowDown, ArrowRight, Clock3, HeartPulse, ShieldCheck, Stethoscope } from 'lucide-react'
import ClinicChat from './components/ClinicChat'
import './App.css'

const bookingUrl = '/embed.html?clinicId=lotus&mode=page'

const platformFeatures = [
  { name: 'Clinic services', detail: 'Each clinic sets its own services, fees, and appointment length.', status: 'Clinic-configured', icon: Stethoscope },
  { name: 'Live availability', detail: 'Appointment times are requested from the clinic’s booking system.', status: 'Backend-connected', icon: Clock3 },
  { name: 'Verified checkout', detail: 'The backend verifies payment before it confirms an appointment.', status: 'Test Mode', icon: ShieldCheck },
]

export default function App() {
  return <>
  <main className="page-shell" id="home">
    <div className="demo-notice"><span className="demo-dot"/> Clinic Flow · Test booking environment · No live payments</div>
    <header className="topbar">
      <a className="brand" href="#home" aria-label="Clinic Flow home"><img className="brand-mark" src="/clinicflow-logo.png" alt=""/><span>Clinic Flow</span></a>
      <nav className="site-nav" aria-label="Main navigation">
        <a href="#services">Services</a>
        <a href="#how-it-works">How it works</a>
        <a className="nav-cta" href={bookingUrl}>Book a visit <ArrowRight size={17}/></a>
      </nav>
    </header>

    <section className="hero-section" aria-labelledby="page-title">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-rule"/> Clinic Flow <span className="eyebrow-separator">·</span> Mangaluru</p>
        <h1 id="page-title">A clearer way<br/>to book <span>care.</span></h1>
        <p className="hero-description">Choose a service, find an available time, and share only the details the clinic needs. No long forms or phone queues.</p>
        <div className="hero-actions">
          <a className="primary-button" href={bookingUrl}>Start a test booking <ArrowRight size={19}/></a>
          <a className="secondary-link" href="#how-it-works">See how it works <ArrowDown size={17}/></a>
        </div>
        <div className="hero-assurance"><ShieldCheck size={20}/><span><strong>Your information is private</strong><small>Clear consent before personal details are collected</small></span></div>
      </div>
      <aside className="hero-aside" aria-label="Booking overview">
        <span className="aside-kicker">Clinic Flow booking</span>
        <h2>Care, without the runaround.</h2>
        <p>Follow clear steps, review the visit, then pay securely in Test Mode.</p>
        <ol className="hero-steps">
          <li><span>01</span><strong>Choose a service</strong></li>
          <li><span>02</span><strong>Pick a real available time</strong></li>
          <li><span>03</span><strong>Verify and pay securely</strong></li>
        </ol>
        <div className="aside-footer"><Clock3 size={19}/><strong>Simple, step-by-step booking</strong></div>
      </aside>
    </section>

    <section className="booking-section" id="booking" aria-labelledby="booking-title">
      <div className="section-heading">
        <p className="eyebrow"><span className="eyebrow-rule"/> Start here</p>
        <h2 id="booking-title">Book your visit</h2>
        <p>Your appointment options and payment status come from the clinic service.</p>
      </div>
      <section className="chat-card booking-connect" aria-label="Live appointment booking">
        <div className="chat-header">
          <div className="assistant-avatar"><HeartPulse size={23}/></div>
          <div className="assistant-heading"><strong>Clinic booking assistant</strong><span><b/> Test clinic · Lotus Dental Demo</span></div>
        </div>
        <div className="booking-connect-body">
          <p>Open the live booking flow to load clinic services, available times, OTP verification, and Razorpay Test Mode checkout.</p>
          <a className="primary-button form-submit" href={bookingUrl}>Open booking flow <ArrowRight size={19}/></a>
          <small>Test clinic: Lotus Dental Demo. No real payment will be taken.</small>
        </div>
      </section>
    </section>

    <section className="services-section" id="services" aria-labelledby="services-title">
      <div className="section-heading left-aligned">
        <p className="eyebrow"><span className="eyebrow-rule"/> Clinic booking</p>
        <h2 id="services-title">A booking flow clinics can configure</h2>
        <p>Each appointment option is supplied by the clinic’s own booking setup.</p>
      </div>
      <div className="service-list">{platformFeatures.map(({ name, detail, status, icon: Icon }, index) => <article className="service-information" key={name}><span className="service-number">0{index + 1}</span><span className="service-info-icon"><Icon size={26}/></span><div><h3>{name}</h3><p>{detail}</p></div><strong className="service-fee">{status}</strong></article>)}</div>
    </section>

    <section className="how-section" id="how-it-works" aria-labelledby="how-title">
      <div className="how-copy"><p className="eyebrow"><span className="eyebrow-rule"/> Designed for clarity</p><h2 id="how-title">Easy to follow.<br/>Easy to change.</h2><p>Booking is broken into small steps, with large choices and plain instructions. The appointment is confirmed only after the backend verifies payment.</p></div>
      <div className="how-points"><div><span>01</span><p><strong>Choose from clinic options</strong><small>Pick an active service, doctor, and available time.</small></p></div><div><span>02</span><p><strong>Share only what is needed</strong><small>Consent and phone verification happen before payment.</small></p></div><div><span>03</span><p><strong>Pay and receive confirmation</strong><small>The clinic confirms only after provider verification.</small></p></div></div>
    </section>

    <footer className="page-footer"><a className="brand footer-brand" href="#home"><img className="brand-mark" src="/clinicflow-logo.png" alt=""/><span>Clinic Flow</span></a><p>For urgent medical help, contact local emergency services.</p><a href="#home">Back to top ↑</a></footer>
  </main>
  <ClinicChat clinicId="lotus" bookingUrl={bookingUrl} />
  </>
}
