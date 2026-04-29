import { Sparkles } from 'lucide-react'

// Страница ИИ-чата (аналитический ассистент по данным системы).
// Сейчас — заглушка; реальный чат подключим следующим коммитом, когда
// будет готов бэкенд insights-chat и стрим.
export function InsightsChatPage() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Sparkles className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">ИИ-чат</h1>
        <p className="mt-2 text-sm text-slate-500">
          Аналитический ассистент по данным системы. Скоро здесь можно будет задавать
          вопросы о SLA, командах, кейсах, каналах — и получать ответы с цифрами и
          ссылками на источники.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Бэкенд готовится. Если ты это видишь — подключение страницы прошло.
        </p>
      </div>
    </div>
  )
}

export default InsightsChatPage
