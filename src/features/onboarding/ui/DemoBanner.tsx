import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Trash2, Loader2, X, CheckCircle } from 'lucide-react'

export function DemoBanner() {
  const [hasDemo, setHasDemo] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const check = useCallback(async () => {
    try {
      const token = localStorage.getItem('support_agent_token')
      if (!token) return
      const res = await fetch('/api/support/demo/seed', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setHasDemo(data.hasDemo === true)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { check() }, [check])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/demo/seed', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setDeleted(true)
        setHasDemo(false)
        setTimeout(() => setDismissed(true), 3000)
      }
    } catch { /* ignore */ }
    setDeleting(false)
  }

  if (!hasDemo || dismissed) return null

  if (deleted) {
    return (
      <div className="mx-6 mt-4 mb-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
        <p className="text-sm text-green-800 font-medium">Демо-данные удалены! Обновите страницу, чтобы увидеть чистую систему.</p>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto text-sm text-green-700 hover:text-green-900 font-medium underline"
        >
          Обновить
        </button>
      </div>
    )
  }

  return (
    <div className="mx-6 mt-4 mb-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <Sparkles className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-900 font-medium">Сейчас в системе демо-данные</p>
        <p className="text-xs text-amber-700">Это примеры чатов, кейсов и каналов для ознакомления. Удалите их, когда будете готовы работать.</p>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex-shrink-0"
      >
        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        {deleting ? 'Удаление...' : 'Удалить демо'}
      </button>
      <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600 flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
