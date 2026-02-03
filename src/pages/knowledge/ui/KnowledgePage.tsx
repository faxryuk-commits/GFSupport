import { useState } from 'react'
import { Brain, Search, Lightbulb, History, Plus, Settings } from 'lucide-react'
import { SolutionSearch, AIContextPanel } from '@/features/ai-assistant'
import { SOLUTION_CATEGORY_CONFIG, type SolutionCategory } from '@/entities/solution'

type Tab = 'search' | 'solutions' | 'patterns'

export function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<Tab>('search')
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>()

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">База знаний</h1>
              <p className="text-sm text-slate-500">AI-поиск решений и паттернов</p>
            </div>
          </div>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            <Plus className="w-4 h-4" />
            Добавить решение
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {[
            { id: 'search', label: 'Поиск', icon: Search },
            { id: 'solutions', label: 'Решения', icon: Lightbulb },
            { id: 'patterns', label: 'Паттерны', icon: History },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as Tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'search' && (
          <div className="max-w-4xl mx-auto">
            {/* Category Filter */}
            <div className="mb-6">
              <div className="text-sm font-medium text-slate-700 mb-2">Категория</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory(undefined)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    !selectedCategory
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Все
                </button>
                {Object.entries(SOLUTION_CATEGORY_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedCategory(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      selectedCategory === key
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Component */}
            <SolutionSearch
              category={selectedCategory}
              onSelectSolution={(solution) => {
                console.log('Selected solution:', solution)
                // TODO: открыть модальное окно с деталями решения
              }}
            />
          </div>
        )}

        {activeTab === 'solutions' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <Lightbulb className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">Каталог решений</h3>
              <p className="text-slate-500 mb-4">
                Здесь будет каталог всех решений с возможностью редактирования и добавления новых
              </p>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                Добавить решение
              </button>
            </div>
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <History className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">AI Паттерны</h3>
              <p className="text-slate-500 mb-4">
                Автоматически выявленные паттерны проблем и успешных решений на основе истории обращений
              </p>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                Запустить анализ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
