// Web Worker for background polling - not throttled by browser
let pollInterval = null
let apiBase = ''
let authToken = ''

self.onmessage = function(e) {
  const { type, data } = e.data
  
  if (type === 'start') {
    apiBase = data.apiBase || ''
    authToken = data.token || ''
    startPolling()
  } else if (type === 'stop') {
    stopPolling()
  } else if (type === 'updateToken') {
    // Allow updating token without restarting
    authToken = data.token || ''
  }
}

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) {
    headers['Authorization'] = authToken.startsWith('Bearer') ? authToken : `Bearer ${authToken}`
  }
  return headers
}

function startPolling() {
  if (pollInterval) return
  
  // Don't poll without auth token
  if (!authToken) {
    console.log('[Worker] No auth token, skipping poll')
    return
  }
  
  // Poll every 3 seconds - Web Workers are not throttled
  pollInterval = setInterval(async () => {
    if (!authToken) return // Skip if token was cleared
    
    try {
      const response = await fetch(`${apiBase}/api/support/channels?limit=50`, {
        headers: getHeaders()
      })
      if (response.ok) {
        const data = await response.json()
        self.postMessage({ type: 'channels', data })
      } else if (response.status === 401) {
        // Token expired - notify main thread
        self.postMessage({ type: 'authError' })
      }
    } catch (e) {
      // Silent fail
    }
  }, 3000)
  
  // Immediate first poll
  fetch(`${apiBase}/api/support/channels?limit=50`, {
    headers: getHeaders()
  })
    .then(r => r.json())
    .then(data => self.postMessage({ type: 'channels', data }))
    .catch(() => {})
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
