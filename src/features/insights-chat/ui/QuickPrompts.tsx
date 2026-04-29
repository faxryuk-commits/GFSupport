import { Sparkles } from 'lucide-react'

const PROMPTS = [
  'Как у нас дела на этой неделе?',
  'Покажи лидерборд по FRT за 7 дней',
  'Сравни SLA Telegram и WhatsApp за месяц',
  'Кто из команды сильнее всего отстаёт по времени реакции?',
  'Сколько кейсов застряло сегодня?',
]

export function QuickPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="text-center mb-6">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Sparkles className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Чем помочь по данным?</h2>
        <p className="text-sm text-slate-500 mt-1">
          Спроси своими словами или выбери шаблон. Я схожу за свежими цифрами и покажу, откуда их взял.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="text-left text-sm text-slate-700 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
