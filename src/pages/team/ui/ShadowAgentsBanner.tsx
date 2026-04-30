import { useEffect, useState } from 'react'
import { ChevronRight, Loader2, UserPlus, Users, Check, X } from 'lucide-react'
import { Modal } from '@/shared/ui'
import { fetchShadowAgents, restoreShadowAgent, type ShadowSender } from '@/shared/api'

interface Props {
  onRestored: () => void
}

export function ShadowAgentsBanner({ onRestored }: Props) {
  const [shadows, setShadows] = useState<ShadowSender[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchShadowAgents(60)
      setShadows(data.shadowSenders || [])
    } catch {
      setShadows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading || shadows.length === 0) return null

  const totalMessages = shadows.reduce((s, x) => s + x.messages, 0)

  return (
    <>
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-purple-100 text-purple-700">
          <Users className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-purple-900">
            Найдено {shadows.length} {pluralRu(shadows.length, 'теневой', 'теневых', 'теневых')} {pluralRu(shadows.length, 'сотрудник', 'сотрудника', 'сотрудников')}
          </p>
          <p className="text-xs text-purple-800 mt-0.5">
            Эти люди отвечают клиентам ({totalMessages.toLocaleString('ru-RU')} сообщений за 60 дней),
            но не зарегистрированы в команде. Их активность не учитывается в дашбордах и аналитике.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 inline-flex items-center gap-1"
        >
          Просмотреть
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <ShadowAgentsModal
        isOpen={open}
        onClose={() => setOpen(false)}
        shadows={shadows}
        onChanged={() => {
          load()
          onRestored()
        }}
      />
    </>
  )
}

function ShadowAgentsModal({
  isOpen, onClose, shadows, onChanged,
}: {
  isOpen: boolean
  onClose: () => void
  shadows: ShadowSender[]
  onChanged: () => void
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Теневые сотрудники" size="lg">
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-slate-600">
          Эти люди отправляют сообщения от имени поддержки, но в таблице сотрудников их нет.
          Восстановите их одной кнопкой — все исторические сообщения сразу подвяжутся к новой
          записи и появятся в дашбордах.
        </p>
        {shadows.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-500">
            Все сотрудники, отвечающие клиентам, учтены.
          </div>
        )}
        {shadows.map((s) => (
          <ShadowAgentCard key={s.senderId} shadow={s} onChanged={onChanged} />
        ))}
      </div>
    </Modal>
  )
}

function ShadowAgentCard({
  shadow, onChanged,
}: {
  shadow: ShadowSender
  onChanged: () => void
}) {
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ messagesAttached: number; action: string } | null>(null)
  const hasMatch = shadow.possibleMatches.length > 0

  const handleRestore = async () => {
    setRestoring(true)
    setError(null)
    try {
      const r = await restoreShadowAgent({
        senderId: shadow.senderId,
        senderName: shadow.senderName || undefined,
        senderUsername: shadow.senderUsername || undefined,
      })
      if (r.success) {
        setDone({ messagesAttached: r.messagesAttached, action: r.action })
        onChanged()
      } else {
        setError(r.error || 'Не удалось восстановить')
      }
    } catch (e: any) {
      setError(e?.message || 'Ошибка восстановления')
    } finally {
      setRestoring(false)
    }
  }

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-sm text-green-800">
        <Check className="w-4 h-4" />
        <span>
          {done.action === 'already_exists'
            ? `${shadow.senderName || shadow.senderId} уже был в системе. К нему привязано ${done.messagesAttached} сообщений.`
            : `${shadow.senderName || shadow.senderId} восстановлен. Привязано ${done.messagesAttached} исторических сообщений.`}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-medium text-sm flex-shrink-0">
          {(shadow.senderName || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">
              {shadow.senderName || 'Без имени'}
            </span>
            {shadow.senderUsername && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                @{shadow.senderUsername}
              </span>
            )}
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
              {shadow.messages.toLocaleString('ru-RU')} сообщ.
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {shadow.channels} {pluralRu(shadow.channels, 'канал', 'канала', 'каналов')}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 break-all">
            sender_id: <span className="font-mono">{shadow.senderId}</span>
            {' · '}
            был {new Date(shadow.lastSeen).toLocaleDateString('ru-RU')}
          </div>
          {hasMatch && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
              <span className="font-medium">Возможно дубликат:</span>{' '}
              {shadow.possibleMatches.map((m) => `${m.name} (@${m.username || '?'}, tg:${m.telegramId || '?'})`).join(', ')}
              {' '}— проверьте, может быть лучше привязать к существующему.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleRestore}
          disabled={restoring}
          className="px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1.5 flex-shrink-0"
        >
          {restoring ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Восстанавливаю…
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Восстановить
            </>
          )}
        </button>
      </div>
      {error && (
        <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
          <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
