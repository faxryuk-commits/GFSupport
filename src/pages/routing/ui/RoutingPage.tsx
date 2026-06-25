import { useState } from 'react'
import { Waypoints, ArrowRight, Zap, Clock, ShieldAlert } from 'lucide-react'

/**
 * Маршрутизация (шаг 4 редизайна). SLA-матрица по приоритетам, skill-based
 * правила маршрутизации, лестница эскалации L1→L2→L3.
 * Конфигурационный экран; тумблеры правил сохраняются локально (бэкенд — позже).
 */

interface SlaTier {
  key: string
  label: string
  color: string   // border-top + акцент
  frt: string
  resolve: string
  escalate: string
}

const SLA_MATRIX: SlaTier[] = [
  { key: 'urgent', label: 'Срочный', color: '#dc2626', frt: '5 мин', resolve: '1 час', escalate: '15 мин → лид' },
  { key: 'high', label: 'Высокий', color: '#ea580c', frt: '10 мин', resolve: '4 часа', escalate: '1 час → L2' },
  { key: 'normal', label: 'Обычный', color: '#2563eb', frt: '15 мин', resolve: '1 день', escalate: '4 часа → L2' },
  { key: 'low', label: 'Низкий', color: '#64748b', frt: '30 мин', resolve: '3 дня', escalate: '—' },
]

interface SkillRule {
  key: string
  label: string
  desc: string
  target: string
}
const DEFAULT_RULES: SkillRule[] = [
  { key: 'order_create', label: 'Заказ не создаётся', desc: 'Сбои создания/приёма заказа (rpc, вебхук, NotFound)', target: 'Интеграция / инженерка' },
  { key: 'menu', label: 'Меню и стоп-лист', desc: 'Синхронизация меню, цены, недоступные товары', target: 'Поддержка (меню)' },
  { key: 'payment', label: 'Оплата', desc: 'Неверная сумма, тип оплаты, платёжный сбой', target: 'Инженерка' },
  { key: 'zone', label: 'Зона доставки', desc: 'Адрес вне зоны, настройка полигона', target: 'Account / онбординг' },
  { key: 'general', label: 'Общие вопросы', desc: 'Всё, что не попало в специализацию', target: 'L1 поддержка' },
]

const ESCALATION = [
  { level: 'L1', label: 'Первая линия', color: '#2563eb', share: 68, desc: 'Типовые обращения, FAQ, базовые операции' },
  { level: 'L2', label: 'Вторая линия', color: '#7c3aed', share: 26, desc: 'Интеграция, сложные кейсы, эскалации L1' },
  { level: 'L3', label: 'Инженерка', color: '#dc2626', share: 6, desc: 'Платформенные баги, инциденты' },
]

const RULES_KEY = 'routing_rules_enabled'

export function RoutingPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(RULES_KEY)
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return Object.fromEntries(DEFAULT_RULES.map(r => [r.key, true]))
  })
  const toggle = (key: string) => {
    setEnabled(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(RULES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
          <Waypoints className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-[19px] font-extrabold text-slate-900 leading-tight">Маршрутизация</h1>
          <p className="text-sm text-slate-500">SLA по приоритетам, правила распределения и эскалация</p>
        </div>
      </div>

      {/* SLA matrix */}
      <section>
        <h2 className="text-[15.5px] font-bold text-slate-800 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500" /> SLA-матрица
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SLA_MATRIX.map(t => (
            <div key={t.key} className="bg-white rounded-xl border border-[#e8edf3] p-4" style={{ borderTop: `3px solid ${t.color}` }}>
              <div className="text-sm font-bold text-slate-800 mb-2">{t.label}</div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-slate-500">Первый ответ</dt><dd className="font-semibold text-slate-800 tabular-nums">{t.frt}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Решение</dt><dd className="font-semibold text-slate-800 tabular-nums">{t.resolve}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Эскалация</dt><dd className="font-semibold text-slate-700">{t.escalate}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* Skill-based routing */}
      <section>
        <h2 className="text-[15.5px] font-bold text-slate-800 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" /> Правила маршрутизации по типу
        </h2>
        <div className="bg-white rounded-xl border border-[#e8edf3] divide-y divide-slate-100">
          {DEFAULT_RULES.map(r => {
            const on = enabled[r.key] ?? true
            return (
              <div key={r.key} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{r.label}</div>
                  <div className="text-xs text-slate-500">{r.desc}</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 flex-shrink-0">
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">{r.target}</span>
                </div>
                <button
                  onClick={() => toggle(r.key)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-500' : 'bg-slate-300'}`}
                  title={on ? 'Включено' : 'Выключено'}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Escalation ladder */}
      <section>
        <h2 className="text-[15.5px] font-bold text-slate-800 mb-3 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-500" /> Лестница эскалации
        </h2>
        <div className="flex items-stretch gap-2">
          {ESCALATION.map((e, i) => (
            <div key={e.level} className="flex items-center gap-2 flex-1">
              <div className="flex-1 bg-white rounded-xl border border-[#e8edf3] p-4" style={{ borderTop: `3px solid ${e.color}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-extrabold" style={{ color: e.color }}>{e.level}</span>
                  <span className="text-lg font-extrabold tabular-nums text-slate-900">{e.share}%</span>
                </div>
                <div className="text-xs font-medium text-slate-700">{e.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{e.desc}</div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${e.share}%`, background: e.color }} />
                </div>
              </div>
              {i < ESCALATION.length - 1 && <ArrowRight className="w-5 h-5 text-slate-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">Распределение нагрузки по линиям — целевая структура. Живые очереди по навыкам подключим к данным агентов на следующем шаге.</p>
      </section>
    </div>
  )
}

export default RoutingPage
