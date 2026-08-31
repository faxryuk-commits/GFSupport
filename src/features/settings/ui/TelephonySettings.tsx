import { useCallback, useEffect, useState } from 'react'
import { Phone, PlugZap, Users } from 'lucide-react'
import { apiGet, apiPut, apiPost } from '@/shared/services/api.service'

/**
 * Телефония — отдельная вкладка, а не три поля в «Основных».
 *
 * Здесь живёт всё, что нужно, чтобы звонки работали: подключение АТС,
 * проверка связи одним нажатием и номера сейлзов — с чьего номера кому
 * звонит система. Дальше сюда же приедет аналитика записей разговоров.
 */

interface AgentRow {
  id: string
  name: string
  role?: string
  department?: string | null
  pbx_ext?: string | null
  mergedInto?: string | null
  isActive?: boolean
}

/**
 * Отделы в человеческом порядке: телефония — прежде всего инструмент продаж,
 * поэтому они сверху, дальше по убыванию причастности к звонкам.
 */
const DEPT_ORDER = ['sales', 'sale', 'support', 'admin', 'agent', 'product', 'it']
const DEPT_LABEL: Record<string, string> = {
  sales: 'Продажи', sale: 'Продажи', support: 'Поддержка', admin: 'Администрация',
  agent: 'Агенты', product: 'Продукт', it: 'IT',
}

function groupByDept(agents: AgentRow[]): Array<{ label: string; rows: AgentRow[] }> {
  const groups = new Map<string, AgentRow[]>()
  for (const a of agents) {
    const key = String(a.department || a.role || '').toLowerCase() || '—'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }
  return [...groups.entries()]
    .sort((x, y) => {
      const xi = DEPT_ORDER.indexOf(x[0]); const yi = DEPT_ORDER.indexOf(y[0])
      return (xi === -1 ? 99 : xi) - (yi === -1 ? 99 : yi) || x[0].localeCompare(y[0])
    })
    .map(([key, rows]) => ({
      label: DEPT_LABEL[key] || (key === '—' ? 'Без отдела' : key),
      rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }))
}

export function TelephonySettings() {
  const [domain, setDomain] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [ext, setExt] = useState('')
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [saving, setSaving] = useState(false)
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null)
  const [probing, setProbing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [hookUrl, setHookUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    apiGet<any>('/settings', false).then(d => {
      setDomain(String(d?.settings?.onlinepbx_domain || ''))
      setApiKey(String(d?.settings?.onlinepbx_api_key || ''))
      setExt(String(d?.settings?.onlinepbx_ext || ''))
    }).catch(() => {})
    apiGet<any>('/agents', false).then(d => {
      // Дубли скрываем: один человек пишет из нескольких мессенджеров и
      // получает несколько учёток, но канонизация (merged_into) знает главную
      setAgents((d?.agents || []).filter((a: AgentRow) =>
        a.name && !a.mergedInto && a.isActive !== false))
    }).catch(() => {})
    // Адрес вебхука видит только администратор — остальным API откажет, и
    // блок просто не покажется
    apiPost<any>('/sales/call?action=hookurl', {})
      .then(d => setHookUrl(String(d?.url || '')))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const saveConnection = async () => {
    setSaving(true); setMsg(null)
    try {
      const settings: Record<string, string> = {
        onlinepbx_domain: domain.trim(),
        onlinepbx_ext: ext.trim(),
      }
      // Маскированный ключ («abc...123») отправлять обратно нельзя
      if (apiKey && !apiKey.includes('...')) settings.onlinepbx_api_key = apiKey.trim()
      await apiPut('/settings', { settings })
      setMsg('Сохранено')
      setTimeout(() => setMsg(null), 2500)
    } catch (e: any) {
      setMsg(e?.message || 'Не сохранилось')
    } finally { setSaving(false) }
  }

  const testConnection = async () => {
    setProbing(true); setProbe(null)
    try {
      const r = await apiPost<any>('/sales/call?action=probe', {})
      const n = Array.isArray(r?.raw?.data) ? r.raw.data.length : 0
      setProbe({ ok: true, text: `АТС отвечает · звонков за последние сутки: ${n}` })
    } catch (e: any) {
      setProbe({ ok: false, text: e?.message || 'АТС не отвечает — проверьте домен и ключ' })
    } finally { setProbing(false) }
  }

  const saveAgentExt = async (a: AgentRow, value: string) => {
    const v = value.trim()
    if (v === String(a.pbx_ext || '')) return
    try {
      await apiPut('/agents', { id: a.id, pbxExt: v })
      setAgents(prev => prev.map(x => x.id === a.id ? { ...x, pbx_ext: v || null } : x))
    } catch { /* поле вернётся при перезагрузке — молча не перетираем */ }
  }

  const input = 'w-full px-4 py-2.5 bg-slate-50 border border-[#e8edf3] rounded-xl text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all'

  return (
    <div className="space-y-6">

      {/* Подключение АТС */}
      <div className="bg-white rounded-2xl border border-[#e8edf3] p-6">
        <div className="flex items-center gap-2 mb-1">
          <PlugZap className="w-4 h-4 text-cyan-600" />
          <h3 className="font-semibold text-slate-800">Подключение OnlinePBX</h3>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          API-ключ выпускается в личном кабинете АТС: Настройки → API.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Домен АТС</label>
            <input className={input + ' font-mono'} value={domain}
              onChange={e => setDomain(e.target.value)} placeholder="pbx27296.onpbx.ru" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">API-ключ</label>
            <input className={input + ' font-mono'} type="password" value={apiKey}
              onChange={e => setApiKey(e.target.value)} placeholder="ключ из ЛК АТС" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Общий номер для звонков</label>
            <input className={input + ' font-mono'} value={ext}
              onChange={e => setExt(e.target.value)} placeholder="внутр. 100 или мобильный" />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={saveConnection} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button onClick={testConnection} disabled={probing}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
            {probing ? 'Проверяю…' : 'Проверить связь'}
          </button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
          {probe && (
            <span className={`text-sm ${probe.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {probe.text}
            </span>
          )}
        </div>
      </div>

      {/* Номера сейлзов */}
      <div className="bg-white rounded-2xl border border-[#e8edf3] p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-violet-600" />
          <h3 className="font-semibold text-slate-800">Номера сотрудников</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Исходящий звонок идёт с личного номера сотрудника; если он не задан — с общего.
          Годится внутренний номер АТС («101») или мобильный («998…»): АТС сначала
          позвонит сотруднику, потом клиенту, разговор запишется в обоих случаях.
        </p>
        <div className="space-y-5">
          {groupByDept(agents).map(g => (
            <div key={g.label}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {g.label}
                </span>
                <span className="text-[11px] text-slate-300">{g.rows.length}</span>
                <span className="flex-1 border-t border-slate-100" />
              </div>
              <div className="divide-y divide-slate-100">
                {g.rows.map(a => (
                  <div key={a.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1 text-sm font-medium text-slate-800 truncate">
                      {a.name}
                    </div>
                    <input
                      defaultValue={a.pbx_ext || ''}
                      onBlur={e => saveAgentExt(a, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder="не задан"
                      className="w-44 px-3 py-1.5 bg-slate-50 border border-[#e8edf3] rounded-lg text-sm font-mono
                                 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!agents.length && <div className="text-sm text-slate-400 py-3">Команда не загрузилась</div>}
        </div>
      </div>

      {/* Как это устроено */}
      <div className="bg-white rounded-2xl border border-[#e8edf3] p-6">
        <div className="flex items-center gap-2 mb-3">
          <Phone className="w-4 h-4 text-emerald-600" />
          <h3 className="font-semibold text-slate-800">Как это устроено</h3>
        </div>
        <div className="space-y-2.5 text-sm text-slate-600">
          <p>
            <b>Исходящие.</b> Кнопка «Позвонить» на карточке: АТС звонит сотруднику
            (на его номер из списка выше), после ответа набирает клиента.
          </p>
          <p>
            <b>Входящие.</b> На кого подавать входящий — очередь, группа, «первому
            свободному» — настраивается в кабинете OnlinePBX (Настройки → Входящие
            звонки), CRM подхватывает результат: звонок ложится касанием на лида,
            неизвестный номер создаёт нового лида в очереди «Новые».
          </p>
          {hookUrl && (
            <div className="rounded-xl bg-slate-50 border border-[#e8edf3] p-3">
              <p className="mb-2">
                <b>Всплывающий входящий.</b> Добавьте этот адрес в OnlinePBX
                (Сервисы → Webhooks, отметьте все события) — звонок будет
                всплывать в CRM ещё до снятой трубки:
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={hookUrl}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 px-3 py-1.5 bg-white border border-[#e8edf3] rounded-lg text-[12px] font-mono text-slate-600" />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(hookUrl).then(() => {
                      setCopied(true); setTimeout(() => setCopied(false), 2000)
                    }).catch(() => {})
                  }}
                  className="px-3 py-1.5 bg-slate-100 rounded-lg text-[12px] text-slate-700 hover:bg-slate-200 flex-none">
                  {copied ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
            </div>
          )}
          <p>
            <b>Без софтфона.</b> Укажите сотруднику мобильный вместо внутреннего —
            АТС будет звонить ему на сотовый. Софтфон нужен, только если хочется
            принимать и совершать звонки с компьютера.
          </p>
          <p className="text-slate-400">
            Дальше здесь появится аналитика записей: расшифровка разговоров и
            подсказки по ним. Записи уже собираются на стороне АТС.
          </p>
        </div>
      </div>
    </div>
  )
}
