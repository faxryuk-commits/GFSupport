import { useState, useEffect, useCallback } from 'react'
import { 
  AlertTriangle, 
  Brain, 
  Download, 
  RefreshCw, 
  TrendingUp, 
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Zap,
  Tag
} from 'lucide-react'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Badge, Modal, Button } from '@/shared/ui'

interface ProblemType {
  key: string
  description: string
  category: string
  count: number
  examples: Array<{ id: string; text: string; date: string }>
}

interface CategoryData {
  category: string
  label: string
  total: number
  problems: ProblemType[]
}

interface AnalysisSummary {
  totalMessages: number
  markedAsProblems: number
  matchedByPatterns: number
  uniqueProblemTypes: number
}

interface AnalysisData {
  summary: AnalysisSummary
  topProblems: ProblemType[]
  byCategory: CategoryData[]
  patterns: Array<{ key: string; category: string; description: string; patternCount: number }>
}

const CATEGORY_COLORS: Record<string, string> = {
  technical: 'bg-red-100 text-red-800',
  order: 'bg-orange-100 text-orange-800',
  billing: 'bg-yellow-100 text-yellow-800',
  delivery: 'bg-blue-100 text-blue-800',
  menu: 'bg-green-100 text-green-800',
  integration: 'bg-purple-100 text-purple-800',
  onboarding: 'bg-teal-100 text-teal-800',
  complaint: 'bg-pink-100 text-pink-800',
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Технические',
  order: 'Заказы',
  billing: 'Оплата',
  delivery: 'Доставка',
  menu: 'Меню',
  integration: 'Интеграции',
  onboarding: 'Подключение',
  complaint: 'Жалобы',
}

export default function ProblemAnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [selectedProblem, setSelectedProblem] = useState<ProblemType | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchAnalysis = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiGet<AnalysisData>('/patterns?action=analyze_history&limit=6000')
      setData(result)
      // Автоматически раскрываем категории с проблемами
      const categoriesWithProblems = new Set<string>(result.byCategory.map((c: CategoryData) => c.category))
      setExpandedCategories(categoriesWithProblems)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const copyPatternsForAI = () => {
    if (!data) return
    
    const text = data.topProblems.map(p => 
      `[${p.category}] ${p.description} (${p.count} случаев)\n` +
      `Примеры:\n${p.examples.slice(0, 3).map(e => `  - "${e.text}"`).join('\n')}`
    ).join('\n\n')
    
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const savePatternsToDb = async () => {
    setSaving(true)
    try {
      await apiPost('/patterns', { patterns: {} })
      alert('Паттерны успешно сохранены в базу данных')
    } catch (e: any) {
      alert('Ошибка: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const exportToJSON = () => {
    if (!data) return
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      summary: data.summary,
      patterns: data.topProblems.map(p => ({
        id: p.key,
        category: p.category,
        description: p.description,
        matchCount: p.count,
        examples: p.examples.slice(0, 5)
      }))
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `problem-patterns-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Brain className="w-7 h-7 text-purple-600" />
            Анализ проблем клиентов
          </h1>
          <p className="text-slate-500 mt-1">
            Семантический анализ истории сообщений для обучения AI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchAnalysis}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Обновить
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={copyPatternsForAI}
            disabled={!data}
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            Копировать
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportToJSON}
            disabled={!data}
          >
            <Download className="w-4 h-4" />
            Экспорт JSON
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={savePatternsToDb}
            disabled={saving || !data}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Сохранить в БД
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <AlertTriangle className="w-5 h-5 inline mr-2" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-4" />
            <p className="text-slate-600">Анализ 5600+ сообщений...</p>
            <p className="text-slate-400 text-sm">Это может занять до минуты</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-800">
                    {data.summary.totalMessages.toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-500">Всего сообщений</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-800">
                    {data.summary.matchedByPatterns.toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-500">Найдено проблем</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Tag className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-800">
                    {data.summary.uniqueProblemTypes}
                  </p>
                  <p className="text-sm text-slate-500">Типов проблем</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-800">
                    {data.summary.totalMessages > 0 
                      ? Math.round((data.summary.matchedByPatterns / data.summary.totalMessages) * 100)
                      : 0}%
                  </p>
                  <p className="text-sm text-slate-500">Доля проблем</p>
                </div>
              </div>
            </div>
          </div>

          {/* Top Problems */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="font-semibold text-slate-800">
                ТОП-20 наиболее частых проблем
              </h2>
              <p className="text-sm text-slate-500">
                Используйте эти паттерны для обучения AI распознаванию проблем
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.topProblems.map((problem, idx) => (
                <div 
                  key={problem.key}
                  className="px-6 py-4 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedProblem(problem)}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-slate-400 w-8">
                      #{idx + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-800">
                          {problem.description}
                        </span>
                        <Badge className={CATEGORY_COLORS[problem.category] || 'bg-slate-100 text-slate-800'}>
                          {CATEGORY_LABELS[problem.category] || problem.category}
                        </Badge>
                      </div>
                      {problem.examples[0] && (
                        <p className="text-sm text-slate-500 truncate max-w-xl">
                          "{problem.examples[0].text}"
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-slate-800">
                        {problem.count}
                      </p>
                      <p className="text-xs text-slate-500">случаев</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Category */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="font-semibold text-slate-800">
                Проблемы по категориям
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {data.byCategory.map(cat => (
                <div key={cat.category}>
                  <button
                    onClick={() => toggleCategory(cat.category)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {expandedCategories.has(cat.category) 
                        ? <ChevronDown className="w-5 h-5 text-slate-400" />
                        : <ChevronRight className="w-5 h-5 text-slate-400" />
                      }
                      <Badge className={CATEGORY_COLORS[cat.category] || 'bg-slate-100 text-slate-800'}>
                        {cat.label}
                      </Badge>
                      <span className="text-slate-600">
                        {cat.problems.length} типов проблем
                      </span>
                    </div>
                    <span className="text-lg font-bold text-slate-800">
                      {cat.total} случаев
                    </span>
                  </button>
                  
                  {expandedCategories.has(cat.category) && (
                    <div className="bg-slate-50 border-t border-slate-100">
                      {cat.problems.map(problem => (
                        <div 
                          key={problem.key}
                          className="px-6 py-3 pl-14 border-b border-slate-100 last:border-0 hover:bg-slate-100 cursor-pointer"
                          onClick={() => setSelectedProblem(problem)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-slate-700">{problem.description}</span>
                            <span className="text-sm font-medium text-slate-600">
                              {problem.count} случаев
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Patterns Reference */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-800 mb-4">
              Справка по паттернам для AI
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.patterns.slice(0, 16).map(p => (
                <div key={p.key} className="bg-white rounded-lg p-3 border border-slate-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge size="sm" className={CATEGORY_COLORS[p.category] || 'bg-slate-100'}>
                      {p.category}
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {p.patternCount} regex
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Problem Detail Modal */}
      <Modal 
        isOpen={!!selectedProblem} 
        onClose={() => setSelectedProblem(null)}
        title={selectedProblem?.description || 'Детали проблемы'}
        size="lg"
      >
        {selectedProblem && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge className={CATEGORY_COLORS[selectedProblem.category] || 'bg-slate-100'}>
                {CATEGORY_LABELS[selectedProblem.category] || selectedProblem.category}
              </Badge>
              <span className="text-slate-500">
                {selectedProblem.count} случаев
              </span>
            </div>
            
            <div>
              <h4 className="font-medium text-slate-700 mb-2">
                Примеры сообщений ({selectedProblem.examples.length})
              </h4>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {selectedProblem.examples.map((ex, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <p className="text-slate-700">{ex.text}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(ex.date).toLocaleString('ru-RU')}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <h4 className="font-medium text-slate-700 mb-2">
                Regex паттерн (ID: {selectedProblem.key})
              </h4>
              <code className="block bg-slate-800 text-green-400 p-3 rounded-lg text-sm overflow-x-auto">
                {selectedProblem.key}
              </code>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
