import { useState, useEffect } from 'react'
import { FileText, Search, Plus, FolderOpen, Star, Clock, Loader2 } from 'lucide-react'
import { DocsSearch } from '@/features/docs'
import { fetchDocs, type Doc } from '@/shared/api/docs'
import { DOC_CATEGORY_CONFIG, getDocHelpfulnessRatio, type DocCategory } from '@/entities/doc'

type View = 'search' | 'browse' | 'recent'

export function DocsPage() {
  const [view, setView] = useState<View>('search')
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  useEffect(() => {
    if (view === 'browse') {
      loadDocs()
    }
  }, [view, selectedCategory])

  const loadDocs = async () => {
    setLoading(true)
    try {
      const response = await fetchDocs({ 
        category: selectedCategory || undefined,
        limit: 50 
      })
      setDocs(response.docs)
      setCategories(response.categories)
    } catch (e) {
      console.error('Failed to load docs:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Документация</h1>
              <p className="text-sm text-slate-500">База знаний для клиентов и сотрудников</p>
            </div>
          </div>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors">
            <Plus className="w-4 h-4" />
            Новый документ
          </button>
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {[
            { id: 'search', label: 'Поиск', icon: Search },
            { id: 'browse', label: 'Каталог', icon: FolderOpen },
            { id: 'recent', label: 'Недавние', icon: Clock },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id as View)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                view === id
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
        {view === 'search' && (
          <div className="max-w-4xl mx-auto">
            <DocsSearch
              onSelectDoc={(doc) => {
                console.log('Selected doc:', doc)
                // TODO: открыть документ
              }}
            />
          </div>
        )}

        {view === 'browse' && (
          <div className="max-w-6xl mx-auto">
            <div className="flex gap-6">
              {/* Categories Sidebar */}
              <div className="w-64 flex-shrink-0">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="font-medium text-slate-900 mb-3">Категории</h3>
                  <div className="space-y-1">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        !selectedCategory
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Все документы
                    </button>
                    {Object.entries(DOC_CATEGORY_CONFIG).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedCategory(key)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                          selectedCategory === key
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span>{config.icon}</span>
                        {config.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Docs Grid */}
              <div className="flex-1">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  </div>
                ) : docs.length === 0 ? (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <FileText className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">Нет документов</h3>
                    <p className="text-slate-500 mb-4">
                      {selectedCategory 
                        ? 'В этой категории пока нет документов'
                        : 'Создайте первый документ для базы знаний'}
                    </p>
                    <button className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600">
                      Создать документ
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {docs.map((doc) => {
                      const categoryConfig = DOC_CATEGORY_CONFIG[doc.category as DocCategory]
                      const helpfulness = getDocHelpfulnessRatio(doc)
                      
                      return (
                        <div
                          key={doc.id}
                          className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all cursor-pointer"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{categoryConfig?.icon || '📄'}</span>
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                doc.isPublic ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {doc.isPublic ? 'Публичный' : 'Внутренний'}
                              </span>
                            </div>
                            {helpfulness > 0 && (
                              <div className="flex items-center gap-1 text-xs text-yellow-600">
                                <Star className="w-3 h-3 fill-yellow-400" />
                                {helpfulness}%
                              </div>
                            )}
                          </div>
                          
                          <h4 className="font-medium text-slate-900 mb-1 line-clamp-1">
                            {doc.title}
                          </h4>
                          
                          <p className="text-sm text-slate-500 line-clamp-2 mb-3">
                            {doc.content ? doc.content.slice(0, 100) + '...' : 'Нет описания'}
                          </p>
                          
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{doc.viewCount} просмотров</span>
                            <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'recent' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <Clock className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">Недавно просмотренные</h3>
              <p className="text-slate-500">
                Здесь будет история просмотренных документов
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
