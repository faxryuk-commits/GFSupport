import { useState, useEffect, useRef, useCallback } from 'react'
import {
  RefreshCw, CheckCircle, Loader2, Wifi, WifiOff,
  MessageSquare, Users2, Activity, AlertTriangle, Settings2,
} from 'lucide-react'
import { Modal } from '@/shared/ui'
import { apiGet, apiPost } from '@/shared/services/api.service'

export interface Integration {
  id: string
  name: string
  description: string
  icon: string
  status: 'connected' | 'disconnected' | 'error'
  lastSync?: string
}

type FilterMode = 'all' | 'groups_only'
type ServiceStatus = 'active' | 'inactive' | 'error'

export interface HealthData {
  telegram: { status: ServiceStatus; botUsername?: string; botName?: string; channelsCount: number }
  openai: { status: ServiceStatus; model: string }
  whisper: { status: ServiceStatus; language: string }
  notify: { status: ServiceStatus; chatId: string | null }
  whatsapp: { status: ServiceStatus; phone: string | null; filterMode: string | null; channelsCount: number }
}

interface WhatsAppStatus {
  connected: boolean
  phone: string | null
  qr: string | null
  configured: boolean
  error?: string
  lastError?: string | null
  filterMode?: FilterMode
}

interface IntegrationsSettingsProps {
  integrations: Integration[]
  health: HealthData | null
  healthLoading: boolean
  onRefreshHealth: () => void
  selectedIntegration: Integration | null
  isModalOpen: boolean
  onOpenModal: (integration: Integration) => void
  onCloseModal: () => void
  onConnect: (integration: Integration) => void
  onDisconnect: (id: string) => void
}

function StatusDot({ status }: { status: ServiceStatus }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
    )
  }
  return <span className="inline-flex rounded-full h-2.5 w-2.5 bg-slate-300" />
}

const statusLabel: Record<ServiceStatus, string> = {
  active: 'Активен',
  inactive: 'Отключён',
  error: 'Ошибка',
}

const statusColor: Record<ServiceStatus, string> = {
  active: 'bg-green-50 text-green-700',
  inactive: 'bg-slate-100 text-slate-600',
  error: 'bg-red-50 text-red-700',
}

function IntegrationCard({
  icon,
  name,
  status,
  details,
  actions,
}: {
  icon: string
  name: string
  status: ServiceStatus
  details: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl hover:bg-slate-100/80 transition-colors">
      <span className="text-3xl mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1">
          <h3 className="font-medium text-slate-800">{name}</h3>
          <StatusDot status={status} />
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor[status]}`}>
            {statusLabel[status]}
          </span>
        </div>
        <div className="text-sm text-slate-500 space-y-0.5">{details}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
    </div>
  )
}

function WhatsAppConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterSaving, setFilterSaving] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleFilterChange = async (mode: FilterMode) => {
    setFilterSaving(true)
    try {
      await apiPost('/integrations/whatsapp-status', { mode })
      setWaStatus(prev => prev ? { ...prev, filterMode: mode } : prev)
    } catch { /* ignore */ }
    setFilterSaving(false)
  }

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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
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
          <div className="flex flex-col items-center py-6">
            <CheckCircle className="w-14 h-14 text-green-500 mb-3" />
            <p className="text-lg font-semibold text-green-700">Подключено</p>
            {waStatus.phone && (
              <p className="text-sm text-slate-500 mt-1">Номер: +{waStatus.phone}</p>
            )}
            <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-green-50 rounded-full">
              <Wifi className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-700">WhatsApp активен</span>
            </div>

            <div className="w-full mt-6 p-4 bg-slate-50 rounded-xl">
              <p className="text-sm font-medium text-slate-700 mb-3">Какие чаты слушать?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleFilterChange('all')}
                  disabled={filterSaving}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    waStatus.filterMode !== 'groups_only'
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  Все сообщения
                </button>
                <button
                  onClick={() => handleFilterChange('groups_only')}
                  disabled={filterSaving}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    waStatus.filterMode === 'groups_only'
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Users2 className="w-4 h-4" />
                  Только группы
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {waStatus.filterMode === 'groups_only'
                  ? 'Личные сообщения игнорируются, только групповые чаты'
                  : 'Все личные и групповые сообщения попадают в систему'}
              </p>
            </div>
          </div>
        )}

        {!loading && !waStatus?.connected && waStatus?.qr && (
          <div className="flex flex-col items-center">
            <img src={waStatus.qr} alt="WhatsApp QR Code" className="w-64 h-64 rounded-lg border border-slate-200" />
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
  health,
  healthLoading,
  onRefreshHealth,
  selectedIntegration,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  onConnect,
  onDisconnect,
}: IntegrationsSettingsProps) {
  const [waModalOpen, setWaModalOpen] = useState(false)

  const tg = health?.telegram
  const ai = health?.openai
  const wh = health?.whisper
  const nt = health?.notify
  const wa = health?.whatsapp

  return (
    <>
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800">Интеграции</h2>
          <button
            onClick={onRefreshHealth}
            disabled={healthLoading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            Проверить все
          </button>
        </div>

        {healthLoading && !health && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            <span className="ml-3 text-sm text-slate-500">Проверка сервисов...</span>
          </div>
        )}

        <div className="grid gap-3">
          {/* Telegram Bot */}
          <IntegrationCard
            icon="📱"
            name="Telegram Bot"
            status={tg?.status || 'inactive'}
            details={
              tg?.status === 'active' ? (
                <>
                  <p>@{tg.botUsername} {tg.botName && `— ${tg.botName}`}</p>
                  <p className="text-xs text-slate-400">{tg.channelsCount} каналов</p>
                </>
              ) : tg?.status === 'error' ? (
                <p className="text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Нет соединения с Telegram API
                </p>
              ) : (
                <p>Токен бота не настроен</p>
              )
            }
            actions={
              <button
                onClick={() => {
                  const fakeIntegration: Integration = { id: '1', name: 'Telegram Bot', description: '', icon: '📱', status: 'disconnected' }
                  onOpenModal(fakeIntegration)
                }}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            }
          />

          {/* OpenAI API */}
          <IntegrationCard
            icon="🤖"
            name="OpenAI API"
            status={ai?.status || 'inactive'}
            details={
              ai?.status === 'active' ? (
                <p>Модель: <span className="font-medium text-slate-700">{ai.model}</span></p>
              ) : ai?.status === 'error' ? (
                <p className="text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> API ключ недействителен
                </p>
              ) : (
                <p>API ключ не настроен</p>
              )
            }
            actions={null}
          />

          {/* Whisper */}
          <IntegrationCard
            icon="🎤"
            name="Whisper (Транскрибация)"
            status={wh?.status || 'inactive'}
            details={
              wh?.status === 'active' ? (
                <p>Язык: {wh.language === 'ru' ? 'Русский' : wh.language}</p>
              ) : (
                <p>Транскрибация выключена</p>
              )
            }
            actions={null}
          />

          {/* Уведомления Telegram */}
          <IntegrationCard
            icon="🔔"
            name="Уведомления в Telegram"
            status={nt?.status || 'inactive'}
            details={
              nt?.status === 'active' ? (
                <p>Chat ID: <span className="font-mono text-xs">{nt.chatId}</span></p>
              ) : (
                <p>Не настроено</p>
              )
            }
            actions={null}
          />

          {/* WhatsApp */}
          <IntegrationCard
            icon="💬"
            name="WhatsApp"
            status={wa?.status || 'inactive'}
            details={
              wa?.status === 'active' ? (
                <>
                  <p>Номер: +{wa.phone} — {wa.filterMode === 'groups_only' ? 'только группы' : 'все чаты'}</p>
                  <p className="text-xs text-slate-400">{wa.channelsCount} каналов</p>
                </>
              ) : wa?.status === 'error' ? (
                <p className="text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Мост недоступен
                </p>
              ) : (
                <p>Не подключено</p>
              )
            }
            actions={
              <button
                onClick={() => setWaModalOpen(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  wa?.status === 'active'
                    ? 'text-slate-600 bg-white border border-slate-200 hover:bg-slate-50'
                    : 'bg-green-500 text-white hover:bg-green-600'
                }`}
              >
                {wa?.status === 'active' ? 'Настройки' : 'Подключить'}
              </button>
            }
          />
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
