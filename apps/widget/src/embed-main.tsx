import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Embed from './Embed.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Embed />
  </StrictMode>,
)
