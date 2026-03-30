import { useState, useEffect } from 'react'
import { Plus, Loader2, Copy, Check, Link, Mail } from 'lucide-react'
import { apiPost, apiGet } from '@/shared/services/api.service'
import { Modal } from '@/shared/ui'

interface Invite {
  id: string
  token: string
  url: string
  email?: string
  role: string
  expiresAt: string
  createdAt: string
  isUsed: boolean
  isExpired: boolean
}

export function InviteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
    >
      <Plus className="w-4 h-4" />
      Пригласить
    </button>
  )
}

export function InviteModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'agent' | 'manager' | 'admin'>('agent')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])

  useEffect(() => {
    if (isOpen) loadInvites()
  }, [isOpen])

  async function loadInvites() {
    try {
      const data = await apiGet<{ invites: Invite[] }>('/invites')
      setInvites(data.invites.filter((i: Invite) => !i.isUsed && !i.isExpired))
    } catch { /* skip */ }
  }

  async function createInvite() {
    try {
      setLoading(true)
      const resp = await apiPost<{ invite: Invite }>('/invites', {
        email: email || undefined, role, expiresInDays: 7,
      })
      setUrl(resp.invite.url)
      loadInvites()
    } catch { /* skip */ } finally {
      setLoading(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClose() {
    setEmail('')
    setRole('agent')
    setUrl('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Пригласить сотрудника">
      <div className="space-y-4">
        {!url ? (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email (необязательно)</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="employee@company.com"
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">Если указать email, ссылка будет привязана к нему</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as 'agent' | 'manager' | 'admin')}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="agent">Агент поддержки</option>
                <option value="manager">Менеджер</option>
                <option value="admin">Администратор</option>
              </select>
            </div>

            <button
              onClick={createInvite}
              disabled={loading}
              className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Link className="w-5 h-5" /> Создать ссылку</>}
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-medium mb-2">Ссылка создана! Отправьте её сотруднику:</p>
              <div className="flex gap-2">
                <input type="text" value={url} readOnly className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-sm" />
                <button
                  onClick={copy}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                >
                  {copied ? <><Check className="w-4 h-4" /> Скопировано</> : <><Copy className="w-4 h-4" /> Копировать</>}
                </button>
              </div>
              <p className="text-xs text-green-600 mt-2">Ссылка действительна 7 дней</p>
            </div>
            <button
              onClick={() => setUrl('')}
              className="w-full py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Создать ещё одну ссылку
            </button>
          </div>
        )}

        {invites.length > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <h4 className="text-sm font-medium text-slate-700 mb-2">
              Активные приглашения ({invites.length})
            </h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {invites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm">
                  <div>
                    <span className="text-slate-700">{inv.email || 'Без email'}</span>
                    <span className="text-slate-400 ml-2">• {inv.role}</span>
                  </div>
                  <span className="text-xs text-slate-500">до {new Date(inv.expiresAt).toLocaleDateString('ru')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
