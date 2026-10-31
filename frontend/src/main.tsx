import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PovProvider } from './theme/PovProvider'
import { AuthProvider } from './auth/AuthProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PovProvider>
      <AuthProvider><App /></AuthProvider>
    </PovProvider>
  </StrictMode>,
)
