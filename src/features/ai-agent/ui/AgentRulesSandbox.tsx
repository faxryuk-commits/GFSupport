import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, Plus, Trash2, ToggleLeft, ToggleRight, Save,
  Loader2, MessageSquare, Shield, Route, Languages, Ban, Sparkles,
  ChevronDown, ChevronRight, GripVertical, Search, Filter,
} from 'lucide-react'
import {
  fetchAgentSettings, updateAgentSettings, testAgentDecision,
  type AgentRule, type AgentSettings,
} from '@/shared/api'

const CATEGORIES = [
  { id: 'style' as const, label: 'Стиль общения', icon: MessageSquare, color: 'blue' },
  { id: 'escalation' as const, label: 'Эскалация', icon: Shield, color: 'red' },
  { id: 'routing' as const, label: 'Маршрутизация', icon: Route, color: 'green' },
  { id: 'language' as const, label: 'Язык', icon: Languages, color: 'purple' },
  { id: 'restrictions' as const, label: 'Запреты', icon: Ban, color: 'orange' },
  { id: 'custom' as const, label: 'Другое', icon: Sparkles, color: 'slate' },
]

const CATEGORY_COLORS: Record<string, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  red: 'bg-red-50 border-red-200 text-red-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  slate: 'bg-slate-50 border-slate-200 text-slate-700',
}

const BADGE_COLORS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-700',
  red: 'bg-red-100 text-red-700',
  green: 'bg-green-100 text-green-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
  slate: 'bg-slate-100 text-slate-700',
}

const TEMPLATES: { category: AgentRule['category']; text: string }[] = [
  { category: 'style', text: 'Всегда обращайся на "вы" и по имени клиента' },
  { category: 'style', text: 'Отвечай дружелюбно, но профессионально' },
  { category: 'style', text: 'Не используй эмодзи в ответах' },
  { category: 'escalation', text: 'При жалобах на оплату — сразу эскалируй' },
  { category: 'escalation', text: 'Если клиент пишет "позовите менеджера" — эскалируй немедленно' },
  { category: 'routing', text: 'Вопросы по iiko — тегай сотрудника iiko-специалиста' },
  { category: 'routing', text: 'Вопросы по оплате — тегай @Финансы' },
  { category: 'language', text: 'На узбекском отвечай мягко и уважительно' },
  { category: 'language', text: 'Определяй язык клиента по первому сообщению' },
  { category: 'restrictions', text: 'Никогда не обещай скидки или бонусы' },
  { category: 'restrictions', text: 'Не давай технических инструкций по API без подтверждения менеджера' },
]

function genId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

interface TestResult {
  action: string
  replyText?: string
  reasoning: string
  confidence: number
}

export function AgentRulesSandbox() {
  const [rules, setRules] = useState<AgentRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [newText, setNewText] = useState('')
  const [newCategory, setNewCategory] = useState<AgentRule['category']>('custom')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.id)))

  const [showTemplates, setShowTemplates] = useState(false)

  const [testMessage, setTestMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  useEffect(() => {
    fetchAgentSettings()
      .then((s: AgentSettings) => setRules(s.rules || []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false))
  }, [])

  const saveRules = useCallback(async (rulesToSave: AgentRule[]) => {
    setSaving(true)
    setSaved(false)
    try {
      await updateAgentSettings({ rules: rulesToSave })
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }, [])

  function addRule() {
    if (!newText.trim()) return
    const rule: AgentRule = {
      id: genId(),
      category: newCategory,
      text: newText.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    const next = [rule, ...rules]
    setRules(next)
    setNewText('')
    setDirty(true)
  }

  function addTemplate(tpl: typeof TEMPLATES[0]) {
    if (rules.some(r => r.text === tpl.text)) return
    const rule: AgentRule = {
      id: genId(),
      category: tpl.category,
      text: tpl.text,
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    const next = [rule, ...rules]
    setRules(next)
    setDirty(true)
  }

  function toggleRule(id: string) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
    setDirty(true)
  }

  function removeRule(id: string) {
    setRules(prev => prev.filter(r => r.id !== id))
    setDirty(true)
  }

  function updateRuleText(id: string, text: string) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, text } : r))
    setDirty(true)
  }

  async function handleTest() {
    if (!testMessage.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testAgentDecision('test-sandbox', testMessage, 'Тест песочницы')
      setTestResult(res as unknown as TestResult)
    } catch {
      setTestResult({ action: 'error', reasoning: 'Ошибка тестирования', confidence: 0 })
    } finally {
      setTesting(false)
    }
  }

  const filteredRules = rules.filter(r => {
    if (filterCategory !== 'all' && r.category !== filterCategory) return false
    if (search && !r.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const groupedRules = CATEGORIES.map(cat => ({
    ...cat,
    rules: filteredRules.filter(r => r.category === cat.id),
  })).filter(g => g.rules.length > 0)

  const activeCount = rules.filter(r => r.enabled).length

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
        <p className="text-sm text-slate-500 mt-2">Загрузка правил...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Песочница правил</h2>
              <p className="text-sm text-slate-500">
                {rules.length} правил · {activeCount} активных
              </p>
            </div>
          </div>
          <button
            onClick={() => saveRules(rules)}
            disabled={saving || !dirty}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              dirty
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : saved
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : saved ? <Save className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить'}
          </button>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addRule() } }}
              placeholder="Напишите правило... Например: «При жалобах — извиняйся и проси детали»"
              rows={2}
              className="flex-1 px-3 py-2 border border-indigo-200 rounded-lg text-sm resize-none bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <div className="flex flex-col gap-2">
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value as AgentRule['category'])}
                className="px-3 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white"
              >
                {CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <button
                onClick={addRule}
                disabled={!newText.trim()}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Добавить
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="mt-3 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            {showTemplates ? 'Скрыть шаблоны' : 'Показать готовые шаблоны'}
          </button>

          {showTemplates && (
            <div className="mt-3 flex flex-wrap gap-2">
              {TEMPLATES.map((tpl, i) => {
                const exists = rules.some(r => r.text === tpl.text)
                const cat = CATEGORIES.find(c => c.id === tpl.category)!
                return (
                  <button
                    key={i}
                    onClick={() => addTemplate(tpl)}
                    disabled={exists}
                    className={`px-2.5 py-1.5 rounded-md text-xs border transition-all ${
                      exists
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : `${CATEGORY_COLORS[cat.color]} hover:shadow-sm cursor-pointer`
                    }`}
                  >
                    {tpl.text}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {rules.length > 3 && (
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Искать правило..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm appearance-none bg-white"
              >
                <option value="all">Все категории</option>
                {CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {groupedRules.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">Правил пока нет</p>
            <p className="text-xs mt-1">Добавьте правило выше или используйте готовые шаблоны</p>
          </div>
        )}

        <div className="space-y-3">
          {groupedRules.map(group => {
            const Icon = group.icon
            const isExpanded = expandedCategories.has(group.id)
            return (
              <div key={group.id} className="border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => {
                    const next = new Set(expandedCategories)
                    isExpanded ? next.delete(group.id) : next.add(group.id)
                    setExpandedCategories(next)
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <Icon className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">{group.label}</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${BADGE_COLORS[group.color]}`}>
                    {group.rules.filter(r => r.enabled).length}/{group.rules.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="divide-y divide-slate-100">
                    {group.rules.map(rule => (
                      <div
                        key={rule.id}
                        className={`flex items-start gap-3 px-4 py-3 group transition-colors ${
                          rule.enabled ? 'bg-white' : 'bg-slate-50'
                        }`}
                      >
                        <GripVertical className="w-4 h-4 text-slate-300 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                        <button
                          onClick={() => toggleRule(rule.id)}
                          title={rule.enabled ? 'Выключить' : 'Включить'}
                          className="mt-0.5 shrink-0"
                        >
                          {rule.enabled
                            ? <ToggleRight className="w-5 h-5 text-indigo-600" />
                            : <ToggleLeft className="w-5 h-5 text-slate-300" />}
                        </button>
                        <input
                          value={rule.text}
                          onChange={e => updateRuleText(rule.id, e.target.value)}
                          className={`flex-1 text-sm bg-transparent border-none outline-none ${
                            rule.enabled ? 'text-slate-800' : 'text-slate-400 line-through'
                          }`}
                        />
                        <button
                          onClick={() => removeRule(rule.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 rounded"
                          title="Удалить"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-600" />
          Быстрый тест
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Проверьте как агент ответит с учётом текущих правил. Правила подхватываются сразу после сохранения.
        </p>
        <div className="flex gap-2">
          <input
            value={testMessage}
            onChange={e => setTestMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleTest() }}
            placeholder="Введите тестовое сообщение клиента..."
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <button
            onClick={handleTest}
            disabled={testing || !testMessage.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Тест
          </button>
        </div>

        {testResult && (
          <div className="mt-4 bg-slate-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                testResult.action === 'reply' ? 'bg-blue-100 text-blue-700'
                  : testResult.action === 'escalate' ? 'bg-red-100 text-red-700'
                  : testResult.action === 'tag_agent' ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-700'
              }`}>
                {testResult.action}
              </span>
              <span className="text-xs text-slate-500">
                Уверенность: {Math.round(testResult.confidence * 100)}%
              </span>
            </div>
            {testResult.replyText && (
              <p className="text-sm text-slate-800 bg-white rounded-lg p-3 border border-slate-200">
                {testResult.replyText}
              </p>
            )}
            <p className="text-xs text-slate-500">{testResult.reasoning}</p>
          </div>
        )}
      </div>
    </div>
  )
}
