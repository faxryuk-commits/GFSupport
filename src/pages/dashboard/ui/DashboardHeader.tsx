import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  dateRange: string
  onDateRangeChange: (range: string) => void
  onRefresh: () => void
  isRefreshing: boolean
}

export function DashboardHeader({ dateRange, onDateRangeChange, onRefresh, isRefreshing }: Props) {
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)

  const handleCustomDateApply = () => {
    if (customDateFrom && customDateTo) {
      onDateRangeChange(`custom:${customDateFrom}:${customDateTo}`)
      setShowDatePicker(false)
    }
  }

  const getDateRangeLabel = () => {
    if (dateRange.startsWith('custom:')) {
      const [, from, to] = dateRange.split(':')
      return `${new Date(from).toLocaleDateString('ru-RU')} - ${new Date(to).toLocaleDateString('ru-RU')}`
    }
    const labels: Record<string, string> = { today: 'Сегодня', yesterday: 'Вчера', week: 'Эта неделя', month: 'Этот месяц' }
    return labels[dateRange] || dateRange
  }

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Обзор</h1>
          <p className="text-slate-500 mt-0.5">Добро пожаловать! Вот что происходит сегодня.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={dateRange.startsWith('custom:') ? 'custom' : dateRange}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setShowDatePicker(true)
                } else {
                  onDateRangeChange(e.target.value)
                  setShowDatePicker(false)
                }
              }}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[140px]"
            >
              <option value="today">Сегодня</option>
              <option value="yesterday">Вчера</option>
              <option value="week">Эта неделя</option>
              <option value="month">Этот месяц</option>
              <option value="custom">Выбрать даты...</option>
            </select>

            {showDatePicker && (
              <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-20 min-w-[280px]">
                <div className="text-sm font-medium text-slate-700 mb-3">Выберите период</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">От</label>
                    <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">До</label>
                    <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setShowDatePicker(false)}
                      className="flex-1 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                      Отмена
                    </button>
                    <button onClick={handleCustomDateApply} disabled={!customDateFrom || !customDateTo}
                      className="flex-1 px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50">
                      Применить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {dateRange.startsWith('custom:') && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
              {getDateRangeLabel()}
            </span>
          )}

          <button onClick={onRefresh} disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>
    </div>
  )
}
