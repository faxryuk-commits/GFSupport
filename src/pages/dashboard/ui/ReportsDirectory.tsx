import { Link } from 'react-router-dom'
import {
  BarChart3, Gauge, BookOpen, TrendingUp, Bot, ClipboardList, Network,
  type LucideIcon,
} from 'lucide-react'

/**
 * Указатель отчётов.
 *
 * Меню сократили с двадцати пунктов до семи, и аналитика из него ушла — с
 * оговоркой «её место в Обзоре». Место ей выделили, а саму её не перенесли:
 * внизу осталась одна ссылка на «Аналитику», остальные отчёты открывались
 * только прямой ссылкой, которую никто не помнит. Отчёт, о котором не знаешь,
 * не существует.
 *
 * Здесь они собраны категориями — с честной строкой о том, что внутри, чтобы
 * не открывать наугад.
 */
interface Report {
  path: string
  label: string
  hint: string
  icon: LucideIcon
}

const GROUPS: Array<{ title: string; note: string; items: Report[] }> = [
  {
    title: 'Поддержка',
    note: 'как отвечаем и где проседаем',
    items: [
      { path: '/analytics', label: 'Аналитика', icon: BarChart3,
        hint: 'пульс, диагноз и детали: время ответа и SLA по сотрудникам, состояние клиентов' },
      { path: '/benchmarks', label: 'Бенчмарки', icon: Gauge,
        hint: 'планки по времени ответа и решения — свои и в сравнении с рынком' },
      { path: '/knowledge?tab=patterns', label: 'Проблемы и знания', icon: BookOpen,
        hint: 'что ломается повторно, разбор обращений и документы для команды' },
    ],
  },
  {
    title: 'Продажи',
    note: 'откуда приходят и чем заканчивается',
    items: [
      { path: '/sales/reports', label: 'Отчёты продаж', icon: TrendingUp,
        hint: 'воронка по этапам, источники лидов, аналитика сайта и горячие посетители' },
      { path: '/sales/assistant', label: 'ИИ-ассистент', icon: Bot,
        hint: 'кто сейчас на прогреве, цепочка касаний и журнал того, что писал агент' },
    ],
  },
  {
    title: 'Операции',
    note: 'обещания и устройство системы',
    items: [
      { path: '/commitments', label: 'Обязательства', icon: ClipboardList,
        hint: 'что пообещали клиентам, кто пообещал и когда истекает срок' },
      { path: '/system-map', label: 'Карта системы', icon: Network,
        hint: 'какие каналы, боты и интеграции подключены и подают ли признаки жизни' },
    ],
  },
]

export function ReportsDirectory() {
  return (
    <div className="bg-white rounded-xl border border-[#e8edf3] overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-[#e8edf3]">
        <h3 className="font-semibold text-slate-800">Отчёты</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          всё, что считается по данным системы — из меню это убрали, чтобы не плодить пункты
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#e8edf3]">
        {GROUPS.map(group => (
          <div key={group.title} className="p-4">
            <div className="mb-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </div>
              <div className="text-[11.5px] text-slate-400 mt-0.5">{group.note}</div>
            </div>

            <div className="space-y-1">
              {group.items.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="group flex gap-2.5 px-2.5 py-2 -mx-1 rounded-lg hover:bg-slate-50
                             transition-colors"
                >
                  <item.icon className="w-4 h-4 mt-0.5 flex-none text-slate-400
                                        group-hover:text-blue-600 transition-colors" />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-slate-700
                                    group-hover:text-blue-700 transition-colors">
                      {item.label}
                    </div>
                    <div className="text-[11.5px] text-slate-500 leading-snug mt-0.5">
                      {item.hint}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
