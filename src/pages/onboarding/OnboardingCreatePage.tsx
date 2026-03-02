import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useToast, LoadingSpinner } from '@/shared/ui'
import type { OnboardingTemplate, CreateConnectionData } from '@/entities/onboarding'
import { CreateConnectionForm } from '@/features/onboarding/ui/CreateConnectionForm'
import { fetchTemplates, createConnection } from '@/shared/api/onboarding'
import { fetchAgents } from '@/shared/api/agents'

export function OnboardingCreatePage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [templates, setTemplates] = useState<OnboardingTemplate[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchTemplates(),
      fetchAgents().catch(() => []),
    ])
      .then(([tpls, agentsList]) => {
        setTemplates(tpls)
        setAgents(agentsList.map(a => ({ id: a.id, name: a.name })))
      })
      .catch(() => {
        toast.error('Ошибка', 'Не удалось загрузить данные')
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async (data: CreateConnectionData) => {
    try {
      const created = await createConnection(data)
      toast.success('Подключение создано', `Клиент: ${data.clientName}`)
      navigate(`/onboarding/${created.id}`)
    } catch {
      toast.error('Ошибка', 'Не удалось создать подключение')
    }
  }, [navigate, toast])

  const handleCancel = useCallback(() => {
    navigate(-1)
  }, [navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleCancel}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">Новое подключение</h1>
      </div>

      <CreateConnectionForm
        templates={templates}
        agents={agents}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  )
}
