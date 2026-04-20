import { useState, useEffect, useRef, useCallback } from 'react'
import {
  RefreshCw, CheckCircle, Loader2, Wifi, WifiOff,
  MessageSquare, Users2, Activity, AlertTriangle, Settings2,
  QrCode, Phone, Copy, Check as CheckIcon,
} from 'lucide-react'
import { Modal } from '@/shared/ui'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { OpenAISettingsModal } from './OpenAISettingsModal'

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
  openai: { status: ServiceStatus; model: string; source?: 'db' | 'env' | 'none'; detail?: string; httpStatus?: number }
  whisper: { status: ServiceStatus; language: string }
  notify: { status: ServiceStatus; chatId: string | null }
  whatsapp: { status: ServiceStatus; phone: string | null; filterMode: string | null; channelsCount: number }
}

type LinkMode = 'qr' | 'pair_code'

interface WhatsAppStatus {
  connected: boolean
  phone: string | null
  qr: string | null
  configured: boolean
  error?: string
  lastError?: string | null
  filterMode?: FilterMode
  mode?: LinkMode
  pairCode?: string | null
  pairCodeExpiresAt?: number | null
  pairCodePhone?: string | null
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
  const cls = status === 'active' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : ''
  if (status === 'active' || status === 'error') {
    const dot = status === 'active' ? 'bg-green-500' : 'bg-red-500'
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cls} opacity-75`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dot}`} />
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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function WhatsAppConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterSaving, setFilterSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [linkTab, setLinkTab] = useState<LinkMode>('qr')
  const [phoneInput, setPhoneInput] = useState('')
  const [requestingCode, setRequestingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [copiedCode, setCopiedCode] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleRequestPairCode = async () => {
    const digits = phoneInput.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) {
      setCodeError('Введите номер в международном формате (10-15 цифр)')
      return
    }
    setCodeError(null)
    setRequestingCode(true)
    try {
      const res = await apiPost<{ success?: boolean; code?: string; expiresAt?: number; error?: string }>(
        '/integrations/whatsapp-status',
        { action: 'pair-code', phone: digits }
      )
      if (res?.error) {
        setCodeError(res.error === 'already_connected' ? 'Аккаунт уже подключён' : `Не удалось получить код: ${res.error}`)
      } else if (res?.code) {
        setWaStatus((prev) => ({
          ...(prev || { connected: false, phone: null, qr: null, configured: true }),
          mode: 'pair_code',
          pairCode: res.code,
          pairCodeExpiresAt: res.expiresAt || null,
          pairCodePhone: digits,
        }))
      }
    } catch (e: any) {
      setCodeError(`Ошибка соединения с мостом: ${e?.message || 'unknown'}`)
    }
    setRequestingCode(false)
  }

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code.replace(/-/g, ''))
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    } catch { /* noop */ }
  }

  const handleFilterChange = async (mode: FilterMode) => {
    setFilterSaving(true)
    try {
      await apiPost('/integrations/whatsapp-status', { mode })
      setWaStatus(prev => prev ? { ...prev, filterMode: mode } : prev)
    } catch { /* ignore */ }
    setFilterSaving(false)
  }

  const handleLogout = async () => {
    if (!confirm('Отключить WhatsApp аккаунт? Потребуется повторное сканирование QR-кода.')) return
    setLoggingOut(true)
    try {
      await apiPost('/integrations/whatsapp-status', { action: 'logout' })
      setWaStatus(prev => prev ? { ...prev, connected: false, phone: null, qr: null } : prev)
    } catch { /* ignore */ }
    setLoggingOut(false)
  }

  useEffect(() => {
    if (!isOpen) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
      setWaStatus(null)
      setLoading(true)
      setPhoneInput('')
      setCodeError(null)
      setLinkTab('qr')
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
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
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

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              {loggingOut ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Отключение...</>
              ) : (
                <><WifiOff className="w-4 h-4" /> Отключить аккаунт</>
              )}
            </button>
          </div>
        )}

        {!loading && !waStatus?.connected && waStatus?.configured !== false && (
          <div>
            {/* Переключатель способа привязки */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
              <button
                onClick={() => setLinkTab('qr')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  linkTab === 'qr' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <QrCode className="w-4 h-4" />
                QR-код
              </button>
              <button
                onClick={() => setLinkTab('pair_code')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  linkTab === 'pair_code' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Phone className="w-4 h-4" />
                Код по номеру
              </button>
            </div>

            {linkTab === 'qr' && (
              <div className="flex flex-col items-center">
                {waStatus?.qr ? (
                  <>
                    <img src={waStatus.qr} alt="WhatsApp QR Code" className="w-64 h-64 rounded-lg border border-slate-200" />
                    <p className="text-sm text-slate-500 mt-3 text-center">
                      Откройте WhatsApp → Настройки → Связанные устройства → Привязать устройство
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Ожидание сканирования...
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center py-10">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                    <p className="text-sm font-medium text-slate-700">Генерация QR-кода...</p>
                    {waStatus?.lastError && (
                      <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">{waStatus.lastError}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-3 text-center max-w-xs">
                      Если QR не появляется или WhatsApp пишет «Can't link new devices» — попробуйте «Код по номеру».
                    </p>
                  </div>
                )}
              </div>
            )}

            {linkTab === 'pair_code' && (
              <div className="space-y-4">
                {waStatus?.pairCode && waStatus.pairCodeExpiresAt && waStatus.pairCodeExpiresAt > nowTick ? (
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-5 text-center">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Код привязки</p>
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="text-4xl font-mono font-bold text-slate-900 tracking-widest select-all">
                        {waStatus.pairCode}
                      </span>
                      <button
                        onClick={() => handleCopyCode(waStatus.pairCode!)}
                        className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                        title="Скопировать код"
                      >
                        {copiedCode ? <CheckIcon className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
                      </button>
                    </div>
                    <p className="text-sm text-slate-600">
                      Истекает через <span className="font-mono font-semibold text-emerald-700">
                        {formatCountdown(waStatus.pairCodeExpiresAt - nowTick)}
                      </span>
                    </p>
                    {waStatus.pairCodePhone && (
                      <p className="text-xs text-slate-400 mt-1">для номера +{waStatus.pairCodePhone}</p>
                    )}
                    <div className="mt-4 pt-4 border-t border-emerald-200 text-left">
                      <p className="text-xs font-semibold text-slate-700 mb-2">На телефоне:</p>
                      <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside">
                        <li>Откройте WhatsApp → Настройки → Связанные устройства</li>
                        <li>Привязать устройство → <b>Привязать с помощью номера телефона</b></li>
                        <li>Введите ваш номер и затем код выше</li>
                      </ol>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Номер телефона WhatsApp</label>
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => { setPhoneInput(e.target.value); setCodeError(null) }}
                        placeholder="+998 90 123 45 67"
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        В международном формате, пробелы и скобки можно.
                      </p>
                    </div>
                    {codeError && (
                      <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{codeError}</span>
                      </div>
                    )}
                    <button
                      onClick={handleRequestPairCode}
                      disabled={requestingCode || !phoneInput.trim()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {requestingCode ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Запрашиваем код у WhatsApp…</>
                      ) : (
                        <><Phone className="w-4 h-4" /> Получить код привязки</>
                      )}
                    </button>
                    <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                      <b>Когда помогает:</b> если QR выдаёт «Can't link new devices at this time» —
                      этот способ идёт по другому API WhatsApp и часто проходит, когда QR-flow временно заблокирован.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && !waStatus?.connected && waStatus?.configured === false && (
          <div className="flex flex-col items-center py-8">
            <WifiOff className="w-12 h-12 text-slate-400 mb-3" />
            <p className="text-sm font-medium text-slate-700">Мост не настроен</p>
            <p className="text-xs text-slate-400 mt-1 text-center">
              Добавьте WHATSAPP_BRIDGE_URL в переменные Vercel
            </p>
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
  const [aiModalOpen, setAiModalOpen] = useState(false)

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
                <>
                  <p>Модель: <span className="font-medium text-slate-700">{ai.model}</span></p>
                  <p className="text-xs text-slate-400">Источник: {ai.source === 'db' ? 'настройки системы' : 'переменная окружения'}</p>
                </>
              ) :               ai?.status === 'error' ? (
                <div className="text-red-500 space-y-0.5">
                  <p className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> API ключ недействителен
                  </p>
                  {ai.detail && <p className="text-xs text-red-400 truncate max-w-xs">{ai.detail.slice(0, 100)}</p>}
                </div>
              ) : (
                <p>API ключ не настроен</p>
              )
            }
            actions={
              <button
                onClick={() => setAiModalOpen(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  ai?.status === 'active'
                    ? 'text-slate-600 bg-white border border-slate-200 hover:bg-slate-50'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {ai?.status === 'active' ? 'Настройки' : 'Настроить'}
              </button>
            }
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
      <OpenAISettingsModal isOpen={aiModalOpen} onClose={() => setAiModalOpen(false)} onSaved={onRefreshHealth} />

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
                <input type="text" placeholder="123456789:ABCdefGHI..." className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
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
