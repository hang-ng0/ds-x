import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import InkDojo from './InkDojo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InkDojo />
  </StrictMode>,
)
