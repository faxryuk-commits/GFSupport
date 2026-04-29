import { useState } from 'react'
import { Plus, MessageCircle, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react'
import type { InsightsSession } from '../model/types'

interface SessionsSidebarProps {
  sessions: InsightsSession[]
  activeSessionId: string | null
  loading?: boolean
  onSelect: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => void
}

export function SessionsSidebar({
  sessions,
  activeSessionId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: SessionsSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(s: InsightsSession) {
    setEditingId(s.id)
    setDraft(s.title)
  }
  function commitEdit() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-slate-50/40 flex flex-col">
      <div className="p-3 border-b border-slate-200">
        <button
          type="button"
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> Новый чат
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400 px-2 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Загрузка…
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="text-xs text-slate-400 px-2 py-3">Сессий пока нет. Задай первый вопрос — она появится сама.</div>
        )}
        {sessions.map((s) => {
          const active = s.id === activeSessionId
          const isEditing = editingId === s.id
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer ${
                active ? 'bg-white border border-slate-200 shadow-sm' : 'hover:bg-white/70'
              }`}
              onClick={() => !isEditing && onSelect(s.id)}
            >
              <MessageCircle className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-indigo-500' : 'text-slate-400'}`} />
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="flex-1 min-w-0 text-sm bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); commitEdit() }}
                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingId(null) }}
                    className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 min-w-0 truncate ${active ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                    {s.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startEdit(s) }}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded opacity-0 group-hover:opacity-100"
                    title="Переименовать"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Удалить чат «${s.title}»?`)) onDelete(s.id)
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded opacity-0 group-hover:opacity-100"
                    title="Удалить"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
