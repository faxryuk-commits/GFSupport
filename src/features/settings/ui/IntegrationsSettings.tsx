import { useState, useEffect, useRef } from 'react'
import { RefreshCw, CheckCircle, Loader2, Wifi, WifiOff } from 'lucide-react'
import { Modal } from '@/shared/ui'
import { apiGet } from '@/shared/services/api.service'

export interface Integration {
  id: string
  name: string
  description: string
  icon: string
  status: 'connected' | 'disconnected' | 'error'
  lastSync?: string
}

interface WhatsAppStatus {
  connected: boolean
  phone: string | null
  qr: string | null
  configured: boolean
  error?: string
  lastError?: string | null
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

function WhatsAppConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isOpen) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setWaStatus(null)
      setLoading(true)
      return
    }

    const poll = async () => {
      try {
        const data = await apiGet<WhatsAppStatus>('/integrations/whatsapp-status')
        setWaStatus(data)
      } catch {
        setWaStatus({ connected: false, phone: null, qr: null, configured: false })
      } finally {
        setLoading(false)
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isOpen])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="WhatsApp" size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
          <span className="text-4xl">💬</span>
          <div>
            <h3 className="font-semibold text-slate-800">WhatsApp</h3>
            <p className="text-sm text-slate-500">Отсканируйте QR-код в WhatsApp → Связанные устройства</p>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="mt-3 text-sm text-slate-500">Подключение к мосту...</p>
          </div>
        )}

        {!loading && waStatus?.connected && (
          <div className="flex flex-col items-center py-8">
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <p className="text-lg font-semibold text-green-700">Подключено</p>
            {waStatus.phone && (
              <p className="text-sm text-slate-500 mt-1">Номер: +{waStatus.phone}</p>
            )}
            <div className="flex items-center gap-2 mt-3 px-3 py-1.5 bg-green-50 rounded-full">
              <Wifi className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-700">WhatsApp активен</span>
            </div>
          </div>
        )}

        {!loading && !waStatus?.connected && waStatus?.qr && (
          <div className="flex flex-col items-center">
            <img
              src={waStatus.qr}
              alt="WhatsApp QR Code"
              className="w-64 h-64 rounded-lg border border-slate-200"
            />
            <p className="text-sm text-slate-500 mt-3 text-center">
              Откройте WhatsApp → Настройки → Связанные устройства → Привязать устройство
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Ожидание сканирования...
            </div>
          </div>
        )}

        {!loading && !waStatus?.connected && !waStatus?.qr && (
          <div className="flex flex-col items-center py-8">
            <WifiOff className="w-12 h-12 text-slate-400 mb-3" />
            {!waStatus?.configured ? (
              <>
                <p className="text-sm font-medium text-slate-700">Мост не настроен</p>
                <p className="text-xs text-slate-400 mt-1 text-center">
                  Добавьте WHATSAPP_BRIDGE_URL в переменные Vercel
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  {waStatus?.lastError ? 'Ожидание QR-кода...' : 'Мост недоступен'}
                </p>
                <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                  {waStatus?.lastError || waStatus?.error || 'Проверьте что сервис запущен на Railway'}
                </p>
                {waStatus?.lastError && (
                  <div className="flex items-center gap-2 mt-3 text-xs text-amber-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    QR генерируется, подождите...
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-200">
          <button onClick={onClose} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  )
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
  const [waModalOpen, setWaModalOpen] = useState(false)

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
                {integration.id === 'whatsapp' ? (
                  <button
                    onClick={() => setWaModalOpen(true)}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600"
                  >
                    {integration.status === 'connected' ? 'Настройки' : 'Подключить'}
                  </button>
                ) : integration.status === 'connected' ? (
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

      <WhatsAppConnectModal isOpen={waModalOpen} onClose={() => setWaModalOpen(false)} />

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
