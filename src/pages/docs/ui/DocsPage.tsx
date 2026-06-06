import { useState, useEffect } from 'react'
import { FileText, Search, Plus, FolderOpen, Star, Clock, Loader2, Trash2 } from 'lucide-react'
import { DocsSearch } from '@/features/docs'
import { fetchDocs, createDoc, deleteDoc, type Doc } from '@/shared/api/docs'
import { DOC_CATEGORY_CONFIG, getDocHelpfulnessRatio, type DocCategory } from '@/entities/doc'

type View = 'search' | 'browse' | 'recent'

export function DocsPage({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = useState<View>('browse')
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', category: 'general', content: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (view === 'browse') {
      loadDocs()
    }
  }, [view, selectedCategory])

  const handleCreate = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await createDoc({ title: form.title, content: form.content, category: form.category, tags: [] })
      setShowCreate(false)
      setForm({ title: '', category: 'general', content: '' })
      setView('browse')
      await loadDocs()
    } catch (e) {
      console.error('Failed to create doc:', e)
      alert('Не удалось создать документ')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string | number) => {
    if (!confirm('Удалить документ?')) return
    try {
      await deleteDoc(String(id))
      setDocs((prev) => prev.filter((d) => String(d.id) !== String(id)))
    } catch (e) {
      console.error('Failed to delete doc:', e)
    }
  }

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
          {!embedded ? (
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Документация</h1>
                <p className="text-sm text-slate-500">База знаний для клиентов и сотрудников</p>
              </div>
            </div>
          ) : <div />}

          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors">
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
                    <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600">
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
                            <div className="flex items-center gap-2">
                              {helpfulness > 0 && (
                                <div className="flex items-center gap-1 text-xs text-yellow-600">
                                  <Star className="w-3 h-3 fill-yellow-400" />
                                  {helpfulness}%
                                </div>
                              )}
                              <button onClick={() => handleDelete(doc.id)} className="text-slate-300 hover:text-red-500" title="Удалить">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
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
              <h3 className="text-lg font-medium text-slate-900 mb-2">Недавние</h3>
              <p className="text-slate-500 mb-4">Открой «Каталог» — там все документы, отсортированы по дате обновления.</p>
              <button onClick={() => setView('browse')} className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600">К каталогу</button>
            </div>
          </div>
        )}
      </div>

      {/* Модал создания документа */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800 mb-4">Новый документ</h3>
            <div className="space-y-3">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Заголовок"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg bg-white"
              >
                {Object.entries(DOC_CATEGORY_CONFIG).map(([key, c]) => (
                  <option key={key} value={key}>{c.icon} {c.label}</option>
                ))}
              </select>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Содержание"
                rows={6}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Отмена</button>
              <button onClick={handleCreate} disabled={saving || !form.title.trim()} className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50">
                {saving ? 'Сохраняю…' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
