import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import {
  fetchBackfillTaxonomyStats,
  runBackfillTaxonomy,
  type BackfillTaxonomyStats,
  type HealthPeriod,
} from '@/shared/api'

interface Props {
  period: HealthPeriod
}

const PERIOD_DAYS: Record<HealthPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function TaxonomyBackfillPanel({ period }: Props) {
  const days = PERIOD_DAYS[period]
  const [stats, setStats] = useState<BackfillTaxonomyStats | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ processed: number; updated: number; failed: number } | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchBackfillTaxonomyStats(days)
      setStats(s)
    } catch {
      /* no-op */
    }
  }, [days])

  useEffect(() => { loadStats() }, [loadStats])

  const startBackfill = async () => {
    if (running) return
    setRunning(true)
    setProgress({ processed: 0, updated: 0, failed: 0 })

    try {
      let keepGoing = true
      let iterations = 0
      const MAX_ITERATIONS = 50 // safety: до 50 батчей = 1250 сообщений
      let totals = { processed: 0, updated: 0, failed: 0 }

      while (keepGoing && iterations < MAX_ITERATIONS) {
        iterations++
        const res = await runBackfillTaxonomy({ days, batchSize: 25, force: false })
        totals = {
          processed: totals.processed + res.processed,
          updated: totals.updated + res.updated,
          failed: totals.failed + res.failed,
        }
        setProgress({ ...totals })
        if (res.remaining <= 0 || res.processed === 0) keepGoing = false
      }

      await loadStats()
    } catch (e) {
      console.error('[backfill]', e)
    } finally {
      setRunning(false)
    }
  }

  if (!stats) {
    return null // Нечего показывать, пока не знаем статуса
  }

  const taggedPct = stats.total > 0 ? Math.round((stats.tagged / stats.total) * 100) : 0
  const hasRemaining = stats.remaining > 0

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            AI-разметка категорий
            {hasRemaining ? (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                надо разметить ещё {stats.remaining}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> размечено
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            За {days} дн.: размечено {stats.tagged} из {stats.total} ({taggedPct}%)
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          <p className="text-sm text-slate-600">
            Чтобы карта проблем показывала реальные домены/подкатегории — нужно разметить сообщения через AI.
            Это происходит автоматически для новых сообщений. Для старых можно запустить разметку вручную.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={startBackfill}
              disabled={running || !hasRemaining}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium inline-flex items-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {running ? 'Размечаю…' : hasRemaining ? `Разметить ${Math.min(stats.remaining, 1250)} сообщений` : 'Всё размечено'}
            </button>
            {progress && (
              <span className="text-xs text-slate-500">
                Обработано: {progress.processed} · Размечено: {progress.updated} · Ошибок: {progress.failed}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Каждый батч — 25 сообщений через gpt-4o-mini. За раз покрывает до ~1250. Запусти ещё раз, если остались.
          </p>
        </div>
      )}
    </div>
  )
}
