import { useState, useEffect } from 'react'
import { Bot } from 'lucide-react'
import { AgentSettingsPanel, AgentDecisionsLog, AgentTestPanel, AgentRulesSandbox } from '@/features/ai-agent'
import { fetchChannels } from '@/shared/api'

type Tab = 'log' | 'rules' | 'settings' | 'test'

const TABS: { id: Tab; label: string }[] = [
  { id: 'log', label: 'Журнал решений' },
  { id: 'rules', label: 'Правила' },
  { id: 'settings', label: 'Настройки' },
  { id: 'test', label: 'Тестирование' },
]

export function AIAgentPage() {
  const [tab, setTab] = useState<Tab>('log')
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetchChannels()
      .then(data => {
        const list = Array.isArray(data) ? data : (data as any)?.channels || []
        setChannels(list.map((c: any) => ({ id: c.id, name: c.name })))
      })
      .catch(() => {})
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Агент</h1>
          <p className="text-sm text-slate-500">Автономный агент на базе Qwen 2.5 — анализирует, отвечает, эскалирует</p>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' && <AgentDecisionsLog />}
      {tab === 'rules' && <AgentRulesSandbox />}
      {tab === 'settings' && <AgentSettingsPanel />}
      {tab === 'test' && <AgentTestPanel channels={channels} />}
    </div>
  )
}

export default AIAgentPage
