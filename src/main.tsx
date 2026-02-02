import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@/shared/ui'
import { CacheProvider, OfflineIndicator } from '@/shared/store'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/gfs">
      <CacheProvider>
        <ToastProvider>
          <App />
          <OfflineIndicator />
        </ToastProvider>
      </CacheProvider>
    </BrowserRouter>
  </StrictMode>
)
