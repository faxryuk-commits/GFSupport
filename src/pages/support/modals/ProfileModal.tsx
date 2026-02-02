import { useState } from 'react'
import { X, LogOut } from 'lucide-react'

interface ProfileForm {
  name: string
  email: string
  phone: string
  telegram: string
  position: string
  department: string
}

interface ConfirmDialog {
  show: boolean
  title: string
  message: string
  danger: boolean
  onConfirm: () => void
}

interface ProfileModalProps {
  show: boolean
  onClose: () => void
  setConfirmDialog: (dialog: ConfirmDialog) => void
  onLogout: () => void
}

export function ProfileModal({ show, onClose, setConfirmDialog, onLogout }: ProfileModalProps) {
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => {
    const agentData = localStorage.getItem('support_agent_data')
    if (agentData) {
      const agent = JSON.parse(agentData)
      return {
        name: agent.name || '',
        email: agent.email || '',
        phone: agent.phone || '',
        telegram: agent.username || '',
        position: agent.position || '',
        department: agent.department || ''
      }
    }
    return { name: '', email: '', phone: '', telegram: '', position: '', department: '' }
  })

  if (!show) return null

  const handleSave = async () => {
    const agentData = localStorage.getItem('support_agent_data')
    if (!agentData) return
    const agent = JSON.parse(agentData)
    const token = localStorage.getItem('support_agent_token') || 'Bearer admin'
    
    try {
      const res = await fetch('/api/support/agents', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
        },
        body: JSON.stringify({
          id: agent.id,
          name: profileForm.name,
          email: profileForm.email,
          username: profileForm.telegram,
          phone: profileForm.phone,
          position: profileForm.position,
          department: profileForm.department
        })
      })
      
      if (res.ok) {
        const updatedAgent = {
          ...agent,
          name: profileForm.name,
          email: profileForm.email,
          username: profileForm.telegram,
          phone: profileForm.phone,
          position: profileForm.position,
          department: profileForm.department
        }
        localStorage.setItem('support_agent_data', JSON.stringify(updatedAgent))
        onClose()
        alert('Профиль обновлён')
      } else {
        const error = await res.json()
        alert('Ошибка: ' + error.error)
      }
    } catch (e) {
      alert('Ошибка сохранения')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Мой профиль</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ФИО</label>
            <input
              type="text"
              value={profileForm.name}
              onChange={e => setProfileForm({ ...profileForm, name: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })}
                placeholder="+998 90 123 45 67"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Telegram</label>
              <div className="flex">
                <span className="px-3 py-2 bg-slate-100 border border-r-0 border-slate-200 rounded-l-lg text-slate-500">@</span>
                <input
                  type="text"
                  value={profileForm.telegram}
                  onChange={e => setProfileForm({ ...profileForm, telegram: e.target.value.replace('@', '') })}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Должность</label>
              <input
                type="text"
                value={profileForm.position}
                onChange={e => setProfileForm({ ...profileForm, position: e.target.value })}
                placeholder="Специалист"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Отдел</label>
            <input
              type="text"
              value={profileForm.department}
              onChange={e => setProfileForm({ ...profileForm, department: e.target.value })}
              placeholder="Служба поддержки"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            />
          </div>
        </div>
        
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-brand-blue text-white rounded-lg hover:bg-brand-darkBlue"
          >
            Сохранить
          </button>
        </div>
        
        <div className="mt-6 pt-6 border-t">
          <button
            onClick={() => {
              onClose()
              setConfirmDialog({
                show: true,
                title: 'Выход из системы',
                message: 'Вы уверены, что хотите выйти?',
                danger: false,
                onConfirm: onLogout
              })
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти из системы
          </button>
        </div>
      </div>
    </div>
  )
}
