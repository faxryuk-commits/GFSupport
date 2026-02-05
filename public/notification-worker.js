// Web Worker for background polling - not throttled by browser
let pollInterval = null
let apiBase = ''

self.onmessage = function(e) {
  const { type, data } = e.data
  
  if (type === 'start') {
    apiBase = data.apiBase || ''
    startPolling()
  } else if (type === 'stop') {
    stopPolling()
  }
}

function startPolling() {
  if (pollInterval) return
  
  // Poll every 3 seconds - Web Workers are not throttled
  pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${apiBase}/api/support/channels?limit=50`)
      if (response.ok) {
        const data = await response.json()
        self.postMessage({ type: 'channels', data })
      }
    } catch (e) {
      // Silent fail
    }
  }, 3000)
  
  // Immediate first poll
  fetch(`${apiBase}/api/support/channels?limit=50`)
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
