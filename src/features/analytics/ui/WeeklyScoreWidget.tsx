import { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, Minus, Trophy, Timer, CheckCircle,
  ShieldCheck, Brain, SmilePlus, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'
import { fetchWeeklyScore, type WeeklyScoreData, type WeekData } from '@/shared/api'

const TREND_CONFIG = {
  improving: { icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Рост' },
  stable: { icon: Minus, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Стабильно' },
  declining: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Снижение' },
}

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={6} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-900">{score}</span>
        <span className="text-[10px] text-slate-400 -mt-0.5">из 100</span>
      </div>
    </div>
  )
}

function MiniBar({ weeks, height = 40 }: { weeks: WeekData[]; height?: number }) {
  const max = Math.max(...weeks.map(w => w.score), 1)
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {weeks.map((w, i) => {
        const h = Math.max(4, (w.score / max) * height)
        const isLast = i === weeks.length - 1
        const color = w.score >= 75 ? 'bg-emerald-400' : w.score >= 50 ? 'bg-amber-400' : 'bg-red-400'
        return (
          <div key={i} className="group relative flex-1">
            <div
              className={`rounded-sm ${isLast ? color : 'bg-slate-200'} transition-all hover:opacity-80`}
              style={{ height: h }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
              <div className="bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                {w.label}: {w.score}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricRow({ icon: Icon, label, value, suffix, color }: {
  icon: any; label: string; value: string | number; suffix?: string; color: string
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <span className="text-xs text-slate-500 flex-1">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}{suffix && <span className="text-xs text-slate-400 ml-0.5">{suffix}</span>}</span>
    </div>
  )
}

export function WeeklyScoreWidget() {
  const [data, setData] = useState<WeeklyScoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchWeeklyScore(8)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-center h-[200px]">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!data || data.weeks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm text-slate-400 text-center">Недостаточно данных</p>
      </div>
    )
  }

  const { currentScore, delta, streak, trend, weeks } = data
  const cur = weeks[weeks.length - 1]
  const trendCfg = TREND_CONFIG[trend]
  const TrendIcon = trendCfg.icon

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold text-slate-800">Качество команды</h3>
          </div>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${trendCfg.bg} ${trendCfg.color}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            {trendCfg.label}
            {streak >= 3 && <span className="ml-0.5">({streak} нед.)</span>}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <ScoreRing score={currentScore} />
          <div className="flex-1 space-y-2">
            <div className="flex items-baseline gap-2">
              {delta !== 0 && (
                <span className={`text-sm font-medium ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta > 0 ? '+' : ''}{delta} vs прошлой
                </span>
              )}
            </div>
            <MiniBar weeks={weeks} />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{weeks[0].label}</span>
              <span>Текущая</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-center gap-1 py-2 text-xs text-slate-500 hover:bg-slate-50 border-t border-slate-100 transition-colors"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? 'Свернуть' : 'Детали'}
      </button>

      {expanded && (
        <div className="px-5 pb-4 border-t border-slate-100">
          <div className="divide-y divide-slate-50">
            <MetricRow
              icon={Timer} label="Скорость ответа" color="text-blue-500"
              value={cur.avgResponseMin !== null ? `${cur.avgResponseMin}` : '—'} suffix="мин"
            />
            <MetricRow
              icon={CheckCircle} label="Решение кейсов" color="text-emerald-500"
              value={`${cur.resolveRate}`} suffix="%"
            />
            <MetricRow
              icon={ShieldCheck} label="Выполнение обещаний" color="text-violet-500"
              value={`${cur.commitmentRate}`} suffix="%"
            />
            <MetricRow
              icon={Brain} label="Точность AI" color="text-amber-500"
              value={`${cur.aiAccuracy}`} suffix="%"
            />
            <MetricRow
              icon={SmilePlus} label="Удовлетворённость" color="text-pink-500"
              value={`${cur.satisfactionRate}`} suffix="%"
            />
          </div>
        </div>
      )}
    </div>
  )
}
