import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useInsightsChat } from '../model/useInsightsChat'
import { SessionsSidebar } from './SessionsSidebar'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { QuickPrompts } from './QuickPrompts'

const PERIODS: Array<{ id: string; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '14d', label: '14 дней' },
  { id: '30d', label: '30 дней' },
  { id: '90d', label: '90 дней' },
]

const SOURCES: Array<{ id: 'all' | 'telegram' | 'whatsapp'; label: string }> = [
  { id: 'all', label: 'Все каналы' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

export function InsightsChat() {
  const {
    state,
    openSession,
    startNewSession,
    send,
    setPeriod,
    setSource,
    removeSession,
    renameSession,
  } = useInsightsChat()
  // Прокидываем "стартовое значение" в композер при клике на quick-prompt.
  const [composerSeed, setComposerSeed] = useState<string | undefined>(undefined)

  const empty = state.messages.length === 0 && !state.loadingMessages
  const sending = state.sending

  return (
    <div className="h-full flex bg-white">
      <SessionsSidebar
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        loading={state.loadingSessions}
        onSelect={(id) => openSession(id)}
        onNew={startNewSession}
        onDelete={removeSession}
        onRename={renameSession}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header c контролами периода и источника */}
        <div className="border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-sm font-semibold text-slate-900">ИИ-чат · Аналитика</h1>

          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-slate-400">Период:</span>
            <select
              value={state.period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <span className="text-slate-400 ml-2">Источник:</span>
            <select
              value={state.source}
              onChange={(e) => setSource(e.target.value as any)}
              className="bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Body */}
        {empty ? (
          <div className="flex-1 overflow-y-auto px-4 py-10 flex items-start justify-center">
            <QuickPrompts onPick={(t) => setComposerSeed(t)} />
          </div>
        ) : (
          <MessageList messages={state.messages} />
        )}

        {state.error && !sending && (
          <div className="px-4 pb-2">
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {state.error}
            </div>
          </div>
        )}

        <Composer
          onSend={(text) => {
            setComposerSeed(undefined)
            return send(text)
          }}
          disabled={sending}
          initialValue={composerSeed}
        />
      </div>
    </div>
  )
}
