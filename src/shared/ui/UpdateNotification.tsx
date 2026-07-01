import { RefreshCw, X, Sparkles } from 'lucide-react'
import { useVersionCheck } from '../hooks/useVersionCheck'

export function UpdateNotification() {
  const { hasUpdate, newVersion, refresh, dismiss } = useVersionCheck({
    checkInterval: 60000, // Проверка каждую минуту
    enabled: true
  })

  if (!hasUpdate) return null

  return (
    <>
      {/* Overlay backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] animate-fade-in" />
      
      {/* Modal */}
      <div className="fixed inset-0 z-[301] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in">
          {/* Header with gradient */}
          <div className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 px-6 py-8 text-center text-white">
            <div className="w-16 h-16 mx-auto mb-4 bg-white/20 rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold mb-2">Доступно обновление!</h2>
            <p className="text-white/80 text-sm">
              Новая версия приложения готова к использованию
            </p>
            {newVersion && (
              <div className="mt-3 inline-block px-3 py-1 bg-white/20 rounded-full text-xs">
                Версия: {newVersion}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">🚀</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">Новые функции</p>
                  <p className="text-xs text-slate-500">Улучшения и исправления ошибок</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">⚡</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">Оптимизация</p>
                  <p className="text-xs text-slate-500">Повышенная производительность</p>
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-500 text-center mb-6">
              Обновите страницу, чтобы изменения вступили в силу.
              <br />
              <span className="text-xs">Ваши данные сохранятся.</span>
            </p>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={dismiss}
                className="flex-1 px-4 py-3 border border-[#e8edf3] rounded-xl text-slate-600 hover:bg-slate-50 transition-colors font-medium text-sm"
              >
                Позже
              </button>
              <button
                onClick={refresh}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 transition-all font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить сейчас
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Мини-версия для ненавязчивого уведомления (баннер)
export function UpdateBanner() {
  const { hasUpdate, refresh, dismiss } = useVersionCheck({
    checkInterval: 60000,
    enabled: true
  })

  if (!hasUpdate) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[200] animate-slide-in">
      <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl shadow-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Доступно обновление</p>
            <p className="text-xs text-white/80">Обновите страницу для новых функций</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={dismiss}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Отложить"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={refresh}
              className="px-3 py-2 bg-white text-blue-600 rounded-lg font-medium text-sm hover:bg-blue-50 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Обновить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
