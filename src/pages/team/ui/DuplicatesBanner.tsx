import { useEffect, useState } from 'react'
import { AlertTriangle, Users, Loader2, Check, X, ChevronRight } from 'lucide-react'
import { Modal } from '@/shared/ui'

interface DuplicateMember {
  id: string
  name: string
  username: string | null
  email: string | null
  role: string
  status: string | null
  telegramId: string | null
  createdAt: string | null
  lastActiveAt: string | null
  totalMessages: number
  totalCases: number
  isRecommendedKeep: boolean
}

interface DuplicateGroup {
  key: string
  reason: 'name' | 'telegram_id' | 'email'
  members: DuplicateMember[]
}

interface DuplicatesBannerProps {
  onMerged: () => void
}

const REASON_LABEL: Record<DuplicateGroup['reason'], string> = {
  name: 'одинаковое имя',
  telegram_id: 'один Telegram ID',
  email: 'один email',
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  agent: 'Агент',
}

export function DuplicatesBanner({ onMerged }: DuplicatesBannerProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const loadGroups = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/agents/duplicates', {
        headers: { Authorization: `Bearer ${token || ''}` },
      })
      const json = await res.json().catch(() => null)
      setGroups(Array.isArray(json?.groups) ? json.groups : [])
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGroups()
  }, [])

  if (loading || groups.length === 0) return null

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-amber-100 text-amber-700">
          <AlertTriangle className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Найдено {groups.length} {pluralRu(groups.length, 'группа', 'группы', 'групп')} дубликатов
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            В команде есть несколько записей одного и того же человека. Их можно объединить, чтобы статистика не дублировалась.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 inline-flex items-center gap-1"
        >
          Просмотреть
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <DuplicatesModal
        isOpen={open}
        onClose={() => setOpen(false)}
        groups={groups}
        onMerged={() => {
          loadGroups()
          onMerged()
        }}
      />
    </>
  )
}

function DuplicatesModal({
  isOpen, onClose, groups, onMerged,
}: {
  isOpen: boolean
  onClose: () => void
  groups: DuplicateGroup[]
  onMerged: () => void
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Объединение дубликатов" size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-slate-600">
          Для каждой группы выберите запись, которую оставить. Кейсы, обязательства и метрики будут
          переназначены на неё, остальные дубликаты будут удалены.
        </p>
        {groups.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-500">
            Дубликатов больше нет
          </div>
        )}
        {groups.map((g) => (
          <DuplicateGroupCard key={g.key} group={g} onMerged={onMerged} />
        ))}
      </div>
    </Modal>
  )
}

function DuplicateGroupCard({ group, onMerged }: { group: DuplicateGroup; onMerged: () => void }) {
  const recommended = group.members.find((m) => m.isRecommendedKeep)?.id || group.members[0].id
  const [keepId, setKeepId] = useState<string>(recommended)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleMerge = async () => {
    if (!keepId) return
    const mergeIds = group.members.filter((m) => m.id !== keepId).map((m) => m.id)
    if (mergeIds.length === 0) return
    setMerging(true)
    setError(null)
    try {
      const token = localStorage.getItem('support_agent_token')
      const res = await fetch('/api/support/agents/duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ keepId, mergeIds }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`)
      setDone(true)
      onMerged()
    } catch (e: any) {
      setError(e?.message || 'Не удалось объединить')
    } finally {
      setMerging(false)
    }
  }

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-sm text-green-800">
        <Check className="w-4 h-4" />
        Группа объединена в выбранного сотрудника.
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
        <Users className="w-3.5 h-3.5" />
        <span>
          Совпадение по: <span className="font-medium text-slate-700">{REASON_LABEL[group.reason]}</span>
        </span>
        <span className="text-slate-400">·</span>
        <span>{group.members.length} записи</span>
      </div>

      <div className="space-y-2">
        {group.members.map((m) => {
          const isKeep = keepId === m.id
          return (
            <label
              key={m.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                isKeep
                  ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <input
                type="radio"
                checked={isKeep}
                onChange={() => setKeepId(m.id)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {ROLE_LABEL[m.role] || m.role}
                  </span>
                  {m.isRecommendedKeep && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      рекомендуется
                    </span>
                  )}
                  {m.status === 'online' && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                      онлайн
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 flex-wrap">
                  {m.username && <span>@{m.username}</span>}
                  {m.email && <span>{m.email}</span>}
                  {m.telegramId && <span>tg:{m.telegramId}</span>}
                  <span>{m.totalMessages} сообщ.</span>
                  <span>{m.totalCases} кейсов</span>
                  {m.lastActiveAt && (
                    <span>был {new Date(m.lastActiveAt).toLocaleDateString('ru-RU')}</span>
                  )}
                </div>
              </div>
            </label>
          )
        })}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
          <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleMerge}
          disabled={merging || group.members.length < 2}
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {merging ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Объединяю…
            </>
          ) : (
            <>
              Объединить в выбранного
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
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
