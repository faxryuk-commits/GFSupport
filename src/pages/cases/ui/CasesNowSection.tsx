import { useMemo, useState } from 'react'
import { ChevronDown, AlertTriangle, Clock, CheckCircle, Timer, User } from 'lucide-react'
import type { Case } from '@/entities/case'
import { getUiColumn } from '@/entities/case'

interface CasesNowSectionProps {
  cases: Case[]
  onSelectCase: (caseId: string) => void
}

interface Bucket {
  id: 'attention' | 'stuck' | 'done'
  title: string
  hint: string
  icon: typeof AlertTriangle
  accent: string
  items: Case[]
}

const HOUR = 3600_000
const DAY = 24 * HOUR

function hoursSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0
  return (Date.now() - new Date(dateStr).getTime()) / HOUR
}

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

export function CasesNowSection({ cases, onSelectCase }: CasesNowSectionProps) {
  const [collapsed, setCollapsed] = useState(false)

  const { attention, stuck, done } = useMemo(() => {
    const attention: Case[] = []
    const stuck: Case[] = []
    const done: Case[] = []

    for (const c of cases) {
      const col = getUiColumn(c.status)

      // 1. Требуют внимания: новые без ассигни, живут > 1ч
      if (col === 'new' && !c.assignedTo) {
        const ageH = hoursSince(c.createdAt)
        if (ageH > 1) attention.push(c)
      }

      // 2. Висят без движения: in_progress / waiting без смены статуса > 24ч
      if (col === 'in_progress' || col === 'waiting') {
        const base = c.lastStatusChangeAt || c.createdAt
        if (hoursSince(base) > 24) stuck.push(c)
      }

      // 3. Закрыто сегодня
      if (col === 'done' && (isToday(c.resolvedAt || null) || isToday(c.lastStatusChangeAt || null))) {
        done.push(c)
      }
    }

    // Сортировки: attention — по возрасту (старше сверху)
    attention.sort((a, b) => hoursSince(b.createdAt) - hoursSince(a.createdAt))
    // stuck — по «застою» (дольше сверху)
    stuck.sort((a, b) => hoursSince(b.lastStatusChangeAt || b.createdAt) - hoursSince(a.lastStatusChangeAt || a.createdAt))
    // done — по времени закрытия (свежие сверху)
    done.sort((a, b) => {
      const ta = new Date(a.resolvedAt || a.lastStatusChangeAt || a.updatedAt || a.createdAt).getTime()
      const tb = new Date(b.resolvedAt || b.lastStatusChangeAt || b.updatedAt || b.createdAt).getTime()
      return tb - ta
    })

    return { attention, stuck, done }
  }, [cases])

  const buckets: Bucket[] = [
    {
      id: 'attention',
      title: 'Требуют внимания',
      hint: 'Новые без ответственного > 1ч',
      icon: AlertTriangle,
      accent: 'text-red-600 bg-red-50 border-red-200',
      items: attention,
    },
    {
      id: 'stuck',
      title: 'Висят без движения',
      hint: 'Не меняли статус > 24ч',
      icon: Timer,
      accent: 'text-amber-700 bg-amber-50 border-amber-200',
      items: stuck,
    },
    {
      id: 'done',
      title: 'Закрыто сегодня',
      hint: 'Для ощущения прогресса',
      icon: CheckCircle,
      accent: 'text-green-700 bg-green-50 border-green-200',
      items: done,
    },
  ]

  const total = attention.length + stuck.length + done.length
  if (total === 0) return null

  return (
    <div className="mb-4 flex-shrink-0">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Clock className="w-4 h-4 text-slate-500" />
          Что происходит сейчас
          <span className="px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">
            {attention.length} • {stuck.length} • {done.length}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          {buckets.map(b => (
            <BucketCard key={b.id} bucket={b} onSelectCase={onSelectCase} />
          ))}
        </div>
      )}
    </div>
  )
}

interface BucketCardProps {
  bucket: Bucket
  onSelectCase: (id: string) => void
}

function BucketCard({ bucket, onSelectCase }: BucketCardProps) {
  const Icon = bucket.icon
  const items = bucket.items.slice(0, 5)

  return (
    <div className={`border rounded-xl bg-white overflow-hidden`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${bucket.accent}`}>
        <Icon className="w-4 h-4" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{bucket.title}</div>
          <div className="text-[10px] opacity-80 truncate">{bucket.hint}</div>
        </div>
        <span className="px-1.5 py-0.5 text-xs bg-white/70 rounded font-bold">
          {bucket.items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="px-3 py-4 text-xs text-slate-400 text-center">Пусто</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(c => (
            <li
              key={c.id}
              onClick={() => onSelectCase(c.id)}
              className="px-3 py-2 hover:bg-slate-50 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-blue-600 font-semibold flex-shrink-0">
                  {c.ticketNumber ? `#${c.ticketNumber}` : c.id.slice(0, 6).toUpperCase()}
                </span>
                <AgeBadge case_={c} bucketId={bucket.id} />
              </div>
              <div className="text-sm text-slate-800 line-clamp-1 mt-0.5">{c.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                {c.channelName && <span className="truncate max-w-[140px]">{c.channelName}</span>}
                {c.assigneeName ? (
                  <span className="flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{c.assigneeName}</span>
                ) : bucket.id === 'attention' ? (
                  <span className="text-red-600">не назначен</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {bucket.items.length > items.length && (
        <div className="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-50 text-center">
          и ещё {bucket.items.length - items.length}
        </div>
      )}
    </div>
  )
}

function AgeBadge({ case_: c, bucketId }: { case_: Case; bucketId: Bucket['id'] }) {
  if (bucketId === 'attention') {
    const h = hoursSince(c.createdAt)
    return <span className="text-[10px] text-red-600 font-medium">{h >= 24 ? `${Math.floor(h / 24)}д` : `${Math.floor(h)}ч`}</span>
  }
  if (bucketId === 'stuck') {
    const h = hoursSince(c.lastStatusChangeAt || c.createdAt)
    return <span className="text-[10px] text-amber-700 font-medium">{h >= 24 ? `${Math.floor(h / 24)}д` : `${Math.floor(h)}ч`} без изм.</span>
  }
  // done
  const base = c.resolvedAt || c.lastStatusChangeAt || c.updatedAt || c.createdAt
  const d = new Date(base)
  const label = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return <span className="text-[10px] text-green-700 font-medium">{label}</span>
}
