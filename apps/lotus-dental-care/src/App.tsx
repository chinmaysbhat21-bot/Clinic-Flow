import { useState } from 'react'
import {
  ArrowDownRight, ArrowRight, Baby, CalendarDays, Check, ChevronDown,
  Clock3, Heart, HeartPulse, MapPin, Menu, Phone, ShieldCheck,
  Smile, Sparkles, Stethoscope, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Doctor = {
  name: string
  role: string
  experience: string
  focus: string
  languages: string
  bio: string
  initials: string
  tone: string
}

type Service = {
  title: string
  description: string
  icon: LucideIcon
}

// Fictional sample content. Replace only with clinic-approved information.
const doctors: Doctor[] = [
  {
    name: 'Dr. Meera Rao', role: 'Senior Dentist', experience: '12 years of experience',
    focus: 'Preventive care & restorative dentistry', languages: 'English · Kannada · Hindi',
    bio: 'Helps patients feel comfortable while building healthy, confident smiles.',
    initials: 'MR', tone: 'mint',
  },
  {
    name: 'Dr. Arjun Nair', role: 'Orthodontist', experience: '9 years of experience',
    focus: 'Braces & clear aligners', languages: 'English · Hindi · Malayalam',
    bio: 'Creates practical treatment plans tailored to each patient’s goals.',
    initials: 'AN', tone: 'peach',
  },
  {
    name: 'Dr. Sana Khan', role: 'Pediatric Dentist', experience: '7 years of experience',
    focus: 'Children’s dental care & prevention', languages: 'English · Kannada · Urdu',
    bio: 'Makes dental visits reassuring and friendly for children and families.',
    initials: 'SK', tone: 'lilac',
  },
]

const services: Service[] = [
  { title: 'Dental consultation', description: 'A thoughtful conversation and examination to understand your dental needs.', icon: Stethoscope },
  { title: 'Teeth cleaning', description: 'Gentle professional cleaning to support everyday oral health.', icon: Sparkles },
  { title: 'Tooth-colored fillings', description: 'Natural-looking restorations planned around your individual needs.', icon: Smile },
  { title: 'Root canal treatment', description: 'Careful treatment focused on preserving a natural tooth when appropriate.', icon: HeartPulse },
  { title: 'Braces and aligners', description: 'Personalized options for a more comfortable path to straighter teeth.', icon: ShieldCheck },
  { title: 'Children’s dentistry', description: 'Friendly dental visits designed to help young patients feel at ease.', icon: Baby },
]

const navItems = [
  { label: 'Home', href: '#home' },
  { label: 'Doctors', href: '#doctors' },
  { label: 'Services', href: '#services' },
  { label: 'About', href: '#about' },
  { label: 'Contact', href: '#contact' },
]

const sampleTimes = ['9:30 AM', '11:00 AM', '2:30 PM', '4:00 PM']
const widgetUrl = import.meta.env.VITE_BOOKING_WIDGET_URL?.trim()

function Brand({ light = false }: { light?: boolean }) {
  return (
    <a className={`brand ${light ? 'brand-light' : ''}`} href="#home" aria-label="Lotus Dental Care, back to home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 54 54" fill="none">
          <path d="M27 40c-6.2-4.8-10.5-12.2-8.6-19 3.9 1.1 6.7 3.5 8.6 6.9 1.9-3.4 4.7-5.8 8.6-6.9 1.9 6.8-2.4 14.2-8.6 19Z" fill="currentColor" />
          <path d="M25.3 38.2c-8.4.1-14.7-3.1-17.4-9.8 5.8-1.6 11.5-.2 15.8 4.2M28.7 38.2c8.4.1 14.7-3.1 17.4-9.8-5.8-1.6-11.5-.2-15.8 4.2" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M24.4 29.8c1.5-1.5 3.7-1.5 5.2 0" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand-name">Lotus <strong>Dental Care</strong><small>Gentle care, brighter days</small></span>
    </a>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Brand />
        <button className="menu-button" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls="primary-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
        <nav className={`navigation ${open ? 'navigation-open' : ''}`} id="primary-navigation" aria-label="Main navigation">
          {navItems.map(item => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
          <a className="button button-small button-primary nav-cta" href="#booking" onClick={() => setOpen(false)}>Book an appointment <ArrowRight size={16} /></a>
        </nav>
      </div>
    </header>
  )
}

function HeroArt() {
  return (
    <div className="hero-art" role="img" aria-label="Illustration of a friendly dentist and a smiling patient in a calm clinic">
      <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
      <svg className="hero-illustration" viewBox="0 0 580 570" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="room" x1="110" y1="80" x2="500" y2="550" gradientUnits="userSpaceOnUse"><stop stopColor="#F3FBF8"/><stop offset="1" stopColor="#D4EBE4"/></linearGradient>
          <linearGradient id="coat" x1="200" y1="310" x2="330" y2="540" gradientUnits="userSpaceOnUse"><stop stopColor="white"/><stop offset="1" stopColor="#D9EDE8"/></linearGradient>
        </defs>
        <path d="M68 552V216C68 92 164 18 290 18s222 74 222 198v336H68Z" fill="url(#room)"/>
        <circle cx="416" cy="118" r="45" fill="#FAF9F6" opacity=".7"/>
        <path d="M105 365c61-17 86-6 128 20s104 33 163-3 86-26 116-11v181H68V397l37-32Z" fill="#B4DDD2"/>
        <path d="M105 552c10-105 38-182 90-219 23-17 50-17 76 1 31 21 52 83 55 218H105Z" fill="#0F766E"/>
        <path d="M171 334c-9-43-7-95 8-124 18-34 52-45 81-24 35 25 42 98 25 148l-55 40-59-40Z" fill="#263238"/>
        <ellipse cx="226" cy="247" rx="55" ry="68" fill="#C98768"/>
        <path d="M169 240c3-53 24-78 57-78 24 0 53 15 58 57-21-1-42-10-55-28-9 22-32 42-60 49Z" fill="#263238"/>
        <path d="M203 270c13 13 32 14 46 0" stroke="#8C4F42" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="207" cy="243" r="3.8" fill="#263238"/><circle cx="247" cy="243" r="3.8" fill="#263238"/>
        <path d="M190 342c11 27 22 41 38 41 19 0 31-16 40-42l-15-22h-48l-15 23Z" fill="#C98768"/>
        <path d="M225 373v177" stroke="#E8F5F2" strokeWidth="9" strokeLinecap="round" opacity=".6"/>
        <path d="M317 552c5-103 19-182 58-212 29-22 64-17 91 10 35 34 51 102 55 202H317Z" fill="url(#coat)"/>
        <path d="M367 346c12 20 28 31 44 31 18 0 35-12 47-32l-28-22h-39l-24 23Z" fill="#B86F53"/>
        <ellipse cx="411" cy="256" rx="57" ry="70" fill="#D89B7B"/>
        <path d="M352 255c-3-48 14-81 49-91 32-9 66 8 73 37 8 29-7 44-11 54-12-11-18-21-20-39-19 19-50 29-91 39Z" fill="#3A3C3B"/>
        <circle cx="392" cy="257" r="3.8" fill="#263238"/><circle cx="433" cy="257" r="3.8" fill="#263238"/>
        <path d="M392 286c12 12 28 12 40 0" stroke="#9F5F4B" strokeWidth="4" strokeLinecap="round"/>
        <path d="M384 379l25 32 28-32" stroke="#98C9BB" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M410 412v138" stroke="#98C9BB" strokeWidth="7" strokeLinecap="round"/>
        <path d="M345 424c-13 30-25 47-55 61" stroke="#D89B7B" strokeWidth="19" strokeLinecap="round"/>
        <path d="M290 486c-10-6-18-10-27-7-10 4-11 15-5 21 12 11 24 10 35 4" fill="#D89B7B"/>
        <circle cx="452" cy="445" r="23" fill="#E9917B"/><path d="M443 445h18M452 436v18" stroke="white" strokeWidth="4" strokeLinecap="round"/>
        <path d="M68 552h444" stroke="#0B625B" strokeWidth="12" strokeLinecap="round"/>
      </svg>
      <div className="hero-floating"><span className="floating-icon"><Heart size={22} fill="currentColor" /></span><span>Care that feels<br/><strong>personal.</strong></span></div>
      <div className="hero-sparkle sparkle-a">✦</div><div className="hero-sparkle sparkle-b">✦</div>
    </div>
  )
}

function SectionHeading({ eyebrow, title, text, centered = false }: { eyebrow: string; title: string; text?: string; centered?: boolean }) {
  return <div className={`section-heading ${centered ? 'section-heading-centered' : ''}`}><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{text && <p className="section-intro">{text}</p>}</div>
}

function DoctorCard({ doctor, index }: { doctor: Doctor; index: number }) {
  return <article className="doctor-card">
    <div className={`doctor-portrait portrait-${doctor.tone}`} aria-label={`Illustrated avatar for ${doctor.name}`} role="img">
      <span className="portrait-sun"/><span className="portrait-leaf leaf-left"/><span className="portrait-leaf leaf-right"/>
      <span className="portrait-avatar">{doctor.initials}</span>
      <span className="portrait-number">0{index + 1}</span>
    </div>
    <div className="doctor-content">
      <p className="doctor-role">{doctor.role}</p><h3>{doctor.name}</h3>
      <p className="doctor-bio">{doctor.bio}</p>
      <div className="doctor-meta"><span>{doctor.experience}</span><span>{doctor.focus}</span><span>Languages: {doctor.languages}</span></div>
    </div>
  </article>
}

function DemoBooking() {
  const [service, setService] = useState('')
  const [doctor, setDoctor] = useState('')
  const [time, setTime] = useState('')
  const [preview, setPreview] = useState(false)
  const canPreview = service && doctor && time
  return <div className="demo-booking">
    <div className="demo-title"><span className="demo-pill">Demo only</span><p>Explore how an appointment request could work. Times shown here are examples, not live availability.</p></div>
    <div className="demo-fields">
      <label>Service <span className="select-wrap"><select value={service} onChange={event => { setService(event.target.value); setPreview(false) }}><option value="">Choose a service</option>{services.map(item => <option key={item.title}>{item.title}</option>)}</select><ChevronDown size={17}/></span></label>
      <label>Doctor <span className="select-wrap"><select value={doctor} onChange={event => { setDoctor(event.target.value); setPreview(false) }}><option value="">Choose a doctor</option>{doctors.map(item => <option key={item.name}>{item.name}</option>)}</select><ChevronDown size={17}/></span></label>
      <label>Example time <span className="select-wrap"><select value={time} onChange={event => { setTime(event.target.value); setPreview(false) }}><option value="">Choose a sample time</option>{sampleTimes.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={17}/></span></label>
    </div>
    <div className="demo-bottom"><button className="button button-primary" type="button" disabled={!canPreview} onClick={() => setPreview(true)}>Preview selection <ArrowRight size={18}/></button><span>No details are submitted or stored.</span></div>
    {preview && <div className="demo-preview" role="status"><strong>Your demo selection</strong><p>{service} with {doctor} at {time} (example time). No appointment has been requested or confirmed.</p></div>}
  </div>
}

function Booking() {
  return <section className="booking-section section" id="booking" aria-labelledby="booking-title"><div className="container">
    <div className="booking-shell">
      <div className="booking-copy"><p className="eyebrow eyebrow-light">Your next step</p><h2 id="booking-title">Let’s make room for your smile.</h2><p>Choose a service, a dentist, and a time that suits you. We want every visit to begin with clarity and care.</p><div className="booking-note"><CalendarDays size={20}/><span>{widgetUrl ? 'Booking is handled by the connected clinic widget.' : 'This page currently shows a demonstration only.'}</span></div></div>
      <div className="booking-panel">{widgetUrl ? <><p className="widget-label">Appointment booking widget</p><iframe src={widgetUrl} title="Clinic appointment booking widget" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /></> : <DemoBooking />}</div>
    </div>
  </div></section>
}

function App() {
  return <>
    <Header />
    <main>
      <section className="hero" id="home"><div className="container hero-grid">
        <div className="hero-content"><p className="eyebrow hero-eyebrow"><span className="eyebrow-dot"/>WELCOME TO LOTUS DENTAL CARE</p><h1>A healthier smile starts with a <em>caring team.</em></h1><p className="hero-description">A calm place for thoughtful dental care. We take time to listen, explain your options, and help you feel comfortable at every visit.</p><div className="hero-actions"><a className="button button-primary" href="#booking">Book an appointment <ArrowRight size={18}/></a><a className="button button-outline" href="#doctors">Meet our doctors <ArrowDownRight size={18}/></a></div><div className="trust-row"><span><Check size={15}/> Experienced dentists</span><span><Check size={15}/> Modern care</span><span><Check size={15}/> Patient-first approach</span></div></div>
        <HeroArt />
      </div></section>

      <section className="welcome-strip" aria-label="Our approach"><div className="container welcome-inner"><span className="welcome-symbol" aria-hidden="true">✳</span><p>Good dental care starts with <strong>feeling heard.</strong> We’re here for the little questions and the big decisions.</p><a href="#about">Get to know us <ArrowRight size={17}/></a></div></section>

      <section className="section doctors-section" id="doctors"><div className="container"><div className="section-top"><SectionHeading eyebrow="The people behind your care" title="Meet the team that puts you at ease." text="Friendly faces, thoughtful conversations, and care shaped around you."/><p className="sample-tag">Fictional sample profiles</p></div><div className="doctor-grid">{doctors.map((doctor, index) => <DoctorCard key={doctor.name} doctor={doctor} index={index}/>)}</div></div></section>

      <section className="section services-section" id="services"><div className="container"><SectionHeading eyebrow="What we can help with" title="Care for every kind of smile." text="From everyday checkups to more focused treatment, we make room for questions and clear explanations." centered/><div className="services-grid">{services.map((service, index) => { const Icon = service.icon; return <article className="service-card" key={service.title}><div className="service-icon"><Icon size={27} strokeWidth={1.7}/></div><span className="service-index">0{index + 1}</span><h3>{service.title}</h3><p>{service.description}</p></article> })}</div></div></section>

      <section className="section about-section" id="about"><div className="container about-grid"><div className="about-visual" aria-hidden="true"><span className="about-circle about-circle-one"/><span className="about-circle about-circle-two"/><div className="about-card"><div className="about-card-icon"><Heart size={30} fill="currentColor"/></div><span>Care you can<br/><strong>feel good about.</strong></span></div><div className="about-leaf about-leaf-one"/><div className="about-leaf about-leaf-two"/><div className="about-leaf about-leaf-three"/></div><div className="about-copy"><SectionHeading eyebrow="A little about us" title="Comfort comes first. Always."/><p>At Lotus Dental Care, we believe a dental visit should feel welcoming and straightforward. Our approach is to listen closely, explain each step, and create space for your questions.</p><p>Whether you’re planning a routine visit or exploring treatment options, our team aims to make your care feel personal and transparent.</p><div className="about-values"><div><span><Heart size={20}/></span><strong>Warm, respectful care</strong><small>Thoughtful conversations at every visit.</small></div><div><span><ShieldCheck size={20}/></span><strong>Clear explanations</strong><small>Understand the options before deciding.</small></div></div></div></div></section>

      <Booking />

      <section className="section contact-section" id="contact"><div className="container contact-grid"><div><SectionHeading eyebrow="Come say hello" title="We’d love to welcome you in." text="These details are sample placeholders. Replace them with clinic-approved information before publishing."/><a className="button button-outline" href="#booking">Explore appointments <ArrowRight size={18}/></a></div><div className="contact-cards"><div className="contact-card"><MapPin size={23}/><div><strong>Visit us</strong><p>Sample address: 12 Garden Road, Bengaluru, Karnataka 560001</p></div></div><div className="contact-card"><Clock3 size={23}/><div><strong>Opening hours</strong><p>Sample hours: Monday–Saturday, 9:00 AM–6:00 PM</p></div></div><div className="contact-card"><Phone size={23}/><div><strong>Get in touch</strong><p>Sample contact: +91 00000 00000<br/>hello@example.com</p></div></div></div></div></section>
    </main>
    <footer className="footer"><div className="container"><div className="footer-top"><div><Brand light/><p className="footer-description">A fictional clinic experience designed to feel a little more human.</p></div><div className="footer-links"><strong>Explore</strong>{navItems.map(item => <a href={item.href} key={item.href}>{item.label}</a>)}</div><div className="footer-links"><strong>Sample information</strong><span>12 Garden Road, Bengaluru</span><span>Mon–Sat · 9:00 AM–6:00 PM</span><span>+91 00000 00000</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Lotus Dental Care. Fictional demo website.</span><span>Privacy note: This website does not collect or store patient information.</span></div></div></footer>
  </>
}

export default App
