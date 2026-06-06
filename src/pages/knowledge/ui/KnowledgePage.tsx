import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Brain, Search, FileText, History } from 'lucide-react'
import { SolutionSearch } from '@/features/ai-assistant'
import { SOLUTION_CATEGORY_CONFIG } from '@/entities/solution'
import { DocsPage } from '@/pages/docs/ui/DocsPage'
import ProblemAnalysisPage from '@/pages/learning/ui/ProblemAnalysisPage'

type Tab = 'search' | 'docs' | 'patterns'

export function KnowledgePage() {
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const activeTab: Tab = (rawTab === 'docs' || rawTab === 'patterns' || rawTab === 'search') ? rawTab : 'search'
  const setActiveTab = (t: Tab) => { const m = new URLSearchParams(params); m.set('tab', t); setParams(m, { replace: true }) }
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
              <p className="text-sm text-slate-500">Поиск решений · документы · паттерны проблем</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {[
            { id: 'search', label: 'Поиск решений', icon: Search },
            { id: 'docs', label: 'Документы', icon: FileText },
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
      {activeTab === 'search' && (
        <div className="flex-1 overflow-auto p-6">
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
        </div>
      )}

      {/* Документы и Паттерны — встроенные модули (full-bleed, без доп. паддинга) */}
      {activeTab === 'docs' && (
        <div className="flex-1 overflow-hidden">
          <DocsPage embedded />
        </div>
      )}
      {activeTab === 'patterns' && (
        <div className="flex-1 overflow-auto">
          <ProblemAnalysisPage />
        </div>
      )}
    </div>
  )
}
