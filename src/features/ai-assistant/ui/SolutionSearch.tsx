import { useState, useCallback } from 'react'
import { Search, Sparkles, CheckCircle, History, Loader2 } from 'lucide-react'
import { searchSolutions, type AISearchResponse, type AISearchResult } from '@/shared/api/ai'
import { SOLUTION_CATEGORY_CONFIG, type SolutionCategory } from '@/entities/solution'

interface SolutionSearchProps {
  onSelectSolution?: (solution: AISearchResult) => void
  initialQuery?: string
  category?: string
  className?: string
}

export function SolutionSearch({ 
  onSelectSolution, 
  initialQuery = '', 
  category,
  className = ''
}: SolutionSearchProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<AISearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    
    setLoading(true)
    setError(null)
    
    try {
      const response = await searchSolutions(query, { category, limit: 10 })
      setResults(response)
    } catch (e: any) {
      setError(e.message || 'Ошибка поиска')
    } finally {
      setLoading(false)
    }
  }, [query, category])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Опишите проблему для поиска решения..."
          className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Поиск
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* AI Summary */}
      {results?.aiSummary && (
        <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">AI Рекомендация</h4>
              <p className="text-sm text-blue-800">{results.aiSummary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results && results.results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm text-slate-500">
            Найдено {results.results.length} результатов
          </div>
          
          {results.results.map((result) => (
            <div
              key={result.id}
              onClick={() => onSelectSolution?.(result)}
              className={`p-4 bg-white border rounded-xl cursor-pointer transition-all hover:shadow-md ${
                onSelectSolution ? 'hover:border-blue-300' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {result.type === 'solution' ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <History className="w-4 h-4 text-slate-400" />
                  )}
                  <span className="text-xs font-medium text-slate-500">
                    {result.type === 'solution' ? 'Решение' : 'Из истории'}
                  </span>
                  {result.isVerified && (
                    <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                      Проверено
                    </span>
                  )}
                </div>
                <span className={`text-xs font-medium ${
                  SOLUTION_CATEGORY_CONFIG[result.category as SolutionCategory]?.color || 'text-slate-600'
                }`}>
                  {SOLUTION_CATEGORY_CONFIG[result.category as SolutionCategory]?.label || result.category}
                </span>
              </div>
              
              {result.title && (
                <h4 className="font-medium text-slate-900 mb-1">{result.title}</h4>
              )}
              
              <p className="text-sm text-slate-600 line-clamp-2">
                {result.text || result.resolution}
              </p>
              
              {result.steps && result.steps.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">
                  {result.steps.length} шагов решения
                </div>
              )}
              
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Релевантность: {Math.round(result.relevanceScore * 100)}%
                </span>
                {result.successScore && (
                  <span className="text-xs text-green-600">
                    Успешность: {result.successScore}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {results && results.results.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Решения не найдены</p>
          <p className="text-sm mt-1">Попробуйте другой запрос</p>
        </div>
      )}

      {/* Stats */}
      {results?.stats && (
        <div className="text-xs text-slate-400 text-center">
          Проанализировано: {results.stats.solutionsSearched} решений, {results.stats.casesSearched} кейсов
        </div>
      )}
    </div>
  )
}
