import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Embed from './Embed.tsx'

const standalone = new URLSearchParams(window.location.search).get('mode') === 'page'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Embed standalone={standalone} />
  </StrictMode>,
)
