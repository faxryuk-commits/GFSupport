import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider, NotificationProvider, UpdateBanner, DialogHost } from '@/shared/ui'
import { CacheProvider, OfflineIndicator } from '@/shared/store'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CacheProvider>
        <ToastProvider>
          <NotificationProvider>
            <App />
            <OfflineIndicator />
            <UpdateBanner />
            <DialogHost />
          </NotificationProvider>
        </ToastProvider>
      </CacheProvider>
    </BrowserRouter>
  </StrictMode>
)
