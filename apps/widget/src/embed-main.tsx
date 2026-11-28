import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Embed from './Embed.tsx'

import ClinicChat from './components/ClinicChat'

const query = new URLSearchParams(window.location.search)
const mode = query.get('mode')
const clinicId = query.get('clinicId') || 'harbor'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {mode === 'chat' ? <ClinicChat embedded clinicId={clinicId} bookingUrl={"/embed.html?" + new URLSearchParams({ clinicId, mode: 'page' })} /> : <Embed standalone={mode === 'page'} />}
  </StrictMode>,
)
