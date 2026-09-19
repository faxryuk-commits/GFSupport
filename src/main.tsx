import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider, NotificationProvider, UpdateBanner, DialogHost } from '@/shared/ui'
import { CacheProvider, OfflineIndicator } from '@/shared/store'
import App from './App'
import { reloadForNewVersion } from '@/shared/lib/stale-chunk'
import './index.css'

// Vite сообщает о недогруженном чанке до того, как ошибка дойдёт до React:
// после выкладки старая вкладка просит чанк, которого уже нет
window.addEventListener('vite:preloadError', e => {
  if (reloadForNewVersion()) e.preventDefault()
})

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
