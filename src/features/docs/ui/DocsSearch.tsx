import { useState, useCallback } from 'react'
import { Search, FileText, ExternalLink, ThumbsUp, Loader2 } from 'lucide-react'
import { searchDocs, type DocSearchResult } from '@/shared/api/docs'
import { DOC_CATEGORY_CONFIG, type DocCategory } from '@/entities/doc'

interface DocsSearchProps {
  onSelectDoc?: (doc: DocSearchResult) => void
  category?: string
  className?: string
}

export function DocsSearch({ onSelectDoc, category, className = '' }: DocsSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocSearchResult[]>([])
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    
    setLoading(true)
    setError(null)
    
    try {
      const response = await searchDocs(query, { category, limit: 10 })
      setResults(response.results)
      setAiSummary(response.aiSummary || null)
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
          placeholder="Поиск в документации..."
          className="w-full pl-10 pr-24 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Найти'
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* AI Summary */}
      {aiSummary && (
        <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
          <h4 className="font-medium text-blue-900 mb-1">Краткий ответ</h4>
          <p className="text-sm text-blue-800">{aiSummary}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((doc) => {
            const categoryConfig = DOC_CATEGORY_CONFIG[doc.category as DocCategory]
            
            return (
              <div
                key={doc.id}
                onClick={() => onSelectDoc?.(doc)}
                className={`p-4 bg-white border rounded-xl transition-all ${
                  onSelectDoc ? 'cursor-pointer hover:shadow-md hover:border-blue-300' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-slate-900">{doc.title}</h4>
                      {categoryConfig && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded">
                          {categoryConfig.icon} {categoryConfig.label}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-sm text-slate-600 line-clamp-2">
                      {doc.snippet || (doc.content ? doc.content.slice(0, 150) + '...' : 'Нет описания')}
                    </p>
                    
                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                      <span>Релевантность: {Math.round(doc.relevanceScore * 100)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* No Results */}
      {!loading && results.length === 0 && query && (
        <div className="text-center py-8 text-slate-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Документы не найдены</p>
          <p className="text-sm mt-1">Попробуйте другой запрос</p>
        </div>
      )}
    </div>
  )
}
