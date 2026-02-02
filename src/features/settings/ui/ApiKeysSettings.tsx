import { useState } from 'react'
import { Plus, Copy, Trash2, Check, Eye, EyeOff } from 'lucide-react'
import { Modal, ConfirmDialog, Badge } from '@/shared/ui'

export interface ApiKey {
  id: string
  name: string
  key: string
  createdAt: string
  lastUsed?: string
  permissions: string[]
}

interface ApiKeysSettingsProps {
  apiKeys: ApiKey[]
  onDelete: (id: string) => void
  onAdd: (name: string, permissions: string[]) => void
}

const permissionLabels: Record<string, string> = {
  read: 'Чтение',
  write: 'Запись',
  webhook: 'Вебхуки',
}

export function ApiKeysSettings({ apiKeys, onDelete, onAdd }: ApiKeysSettingsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [visibleKeyId, setVisibleKeyId] = useState<string | null>(null)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>(['read'])

  const handleCopy = async (key: ApiKey) => {
    await navigator.clipboard.writeText(key.key)
    setCopiedId(key.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleCreate = () => {
    if (newKeyName.trim()) {
      onAdd(newKeyName, newKeyPermissions)
      setIsModalOpen(false)
      setNewKeyName('')
      setNewKeyPermissions(['read'])
    }
  }

  const handleDelete = () => {
    if (selectedKey) {
      onDelete(selectedKey.id)
      setIsDeleteDialogOpen(false)
      setSelectedKey(null)
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">API Ключи</h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
          >
            <Plus className="w-4 h-4" />
            Создать ключ
          </button>
        </div>

        <div className="space-y-3">
          {apiKeys.map(apiKey => (
            <div key={apiKey.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-slate-800">{apiKey.name}</span>
                  {apiKey.permissions.map(p => (
                    <Badge key={p} size="sm" variant={p === 'write' ? 'warning' : 'default'}>
                      {permissionLabels[p]}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-slate-500 font-mono">
                    {visibleKeyId === apiKey.id ? apiKey.key : apiKey.key.replace(/./g, '•').slice(0, 24)}
                  </code>
                  <button
                    onClick={() => setVisibleKeyId(visibleKeyId === apiKey.id ? null : apiKey.id)}
                    className="p-1 hover:bg-slate-200 rounded"
                  >
                    {visibleKeyId === apiKey.id ? (
                      <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Создан {apiKey.createdAt}
                  {apiKey.lastUsed && ` • Использован ${apiKey.lastUsed}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(apiKey)}
                  className="p-2 hover:bg-slate-200 rounded-lg"
                  title="Копировать"
                >
                  {copiedId === apiKey.id ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                <button
                  onClick={() => { setSelectedKey(apiKey); setIsDeleteDialogOpen(true) }}
                  className="p-2 hover:bg-red-100 rounded-lg"
                  title="Удалить"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Новый API ключ" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Production API, Development..."
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Права доступа</label>
            <div className="flex gap-3">
              {Object.entries(permissionLabels).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newKeyPermissions.includes(key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewKeyPermissions(prev => [...prev, key])
                      } else {
                        setNewKeyPermissions(prev => prev.filter(p => p !== key))
                      }
                    }}
                    className="w-4 h-4 text-blue-500 rounded"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">
              Отмена
            </button>
            <button onClick={handleCreate} className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">
              Создать
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Удалить API ключ"
        message={`Вы уверены, что хотите удалить ключ "${selectedKey?.name}"? Это действие необратимо.`}
        confirmText="Удалить"
        variant="danger"
      />
    </>
  )
}
