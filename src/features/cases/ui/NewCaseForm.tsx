import { useState } from 'react'
import { CASE_PRIORITY_CONFIG, type CasePriority } from '@/entities/case'

const CATEGORIES = [
  'Заказы', 'Оплата', 'Доступ', 'Техническая', 
  'Безопасность', 'Интерфейс', 'Производительность', 'Аккаунт', 'Другое'
]

interface NewCaseFormData {
  title: string
  description: string
  company: string
  contactName: string
  contactEmail: string
  priority: CasePriority
  category: string
}

interface NewCaseFormProps {
  onClose: () => void
  onSubmit: (data: NewCaseFormData) => void
}

export function NewCaseForm({ onClose, onSubmit }: NewCaseFormProps) {
  const [formData, setFormData] = useState<NewCaseFormData>({
    title: '',
    description: '',
    company: '',
    contactName: '',
    contactEmail: '',
    priority: 'medium',
    category: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Название *</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Краткое описание проблемы"
          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Подробное описание проблемы..."
          rows={3}
          className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Компания *</label>
          <input
            type="text"
            value={formData.company}
            onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
            placeholder="Название компании"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Категория *</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            required
          >
            <option value="">Выберите категорию</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Контактное лицо</label>
          <input
            type="text"
            value={formData.contactName}
            onChange={(e) => setFormData(prev => ({ ...prev, contactName: e.target.value }))}
            placeholder="Имя контакта"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={formData.contactEmail}
            onChange={(e) => setFormData(prev => ({ ...prev, contactEmail: e.target.value }))}
            placeholder="email@company.com"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Приоритет</label>
        <div className="flex gap-2">
          {(Object.keys(CASE_PRIORITY_CONFIG) as CasePriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, priority: p }))}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                formData.priority === p
                  ? `${CASE_PRIORITY_CONFIG[p].bgColor} ${CASE_PRIORITY_CONFIG[p].color}`
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {CASE_PRIORITY_CONFIG[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
        <button 
          type="button" 
          onClick={onClose} 
          className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100"
        >
          Отмена
        </button>
        <button 
          type="submit" 
          className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600"
        >
          Создать кейс
        </button>
      </div>
    </form>
  )
}
