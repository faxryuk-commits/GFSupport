// Фоновый опрос уведомлений: воркер не тормозится браузером, поэтому за ним
// нужно следить самим.
//
// Раньше он дёргал полный список каналов каждые 3 секунды — 1200 запросов в
// час на каждого открытого сотрудника, круглосуточно, и каждый лез в базу.
// Это не только тратило её ресурсы, но и конкурировало с запросами, которых
// человек реально ждёт.
let pollInterval = null
let apiBase = ''
let authToken = ''
let paused = false

// Уведомление, опоздавшее на пятнадцать секунд, никого не подводит; запрос,
// отнявший время у открывающейся страницы, — подводит
const POLL_MS = 15000

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
  } else if (type === 'visibility') {
    // Вкладка скрыта — уведомления некому показывать, и опрос смысла не имеет
    paused = data.hidden === true
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
    if (!authToken || paused) return
    
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
  }, POLL_MS)
  
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
