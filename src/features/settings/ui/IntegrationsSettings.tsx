import { RefreshCw } from 'lucide-react'
import { Modal } from '@/shared/ui'

export interface Integration {
  id: string
  name: string
  description: string
  icon: string
  status: 'connected' | 'disconnected' | 'error'
  lastSync?: string
}

interface IntegrationsSettingsProps {
  integrations: Integration[]
  selectedIntegration: Integration | null
  isModalOpen: boolean
  onOpenModal: (integration: Integration) => void
  onCloseModal: () => void
  onConnect: (integration: Integration) => void
  onDisconnect: (id: string) => void
}

const statusColors = {
  connected: 'bg-green-100 text-green-700',
  disconnected: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-700',
}

const statusLabels = {
  connected: 'Подключено',
  disconnected: 'Отключено',
  error: 'Ошибка',
}

export function IntegrationsSettings({
  integrations,
  selectedIntegration,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  onConnect,
  onDisconnect,
}: IntegrationsSettingsProps) {
  return (
    <>
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Интеграции</h2>
        
        <div className="grid gap-4">
          {integrations.map(integration => (
            <div
              key={integration.id}
              className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="text-3xl">{integration.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-slate-800">{integration.name}</h3>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[integration.status]}`}>
                      {statusLabels[integration.status]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">{integration.description}</p>
                  {integration.lastSync && (
                    <p className="text-xs text-slate-400 mt-1">Синхронизация: {integration.lastSync}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {integration.status === 'connected' ? (
                  <>
                    <button className="p-2 hover:bg-white rounded-lg" title="Синхронизировать">
                      <RefreshCw className="w-4 h-4 text-slate-500" />
                    </button>
                    <button
                      onClick={() => onDisconnect(integration.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium"
                    >
                      Отключить
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onOpenModal(integration)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
                  >
                    Подключить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connect Modal */}
      <Modal isOpen={isModalOpen} onClose={onCloseModal} title={`Подключить ${selectedIntegration?.name}`} size="md">
        {selectedIntegration && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
              <span className="text-4xl">{selectedIntegration.icon}</span>
              <div>
                <h3 className="font-semibold text-slate-800">{selectedIntegration.name}</h3>
                <p className="text-sm text-slate-500">{selectedIntegration.description}</p>
              </div>
            </div>

            {selectedIntegration.name === 'Telegram Bot' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bot Token</label>
                <input
                  type="text"
                  placeholder="123456789:ABCdefGHI..."
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}

            {selectedIntegration.name === 'Slack' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Webhook URL</label>
                <input
                  type="text"
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}

            {selectedIntegration.name === 'Email (SMTP)' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Server</label>
                  <input
                    type="text"
                    placeholder="smtp.example.com"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Порт</label>
                    <input
                      type="number"
                      placeholder="587"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Шифрование</label>
                    <select className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                      <option value="tls">TLS</option>
                      <option value="ssl">SSL</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button onClick={onCloseModal} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">
                Отмена
              </button>
              <button
                onClick={() => onConnect(selectedIntegration)}
                className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600"
              >
                Подключить
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
