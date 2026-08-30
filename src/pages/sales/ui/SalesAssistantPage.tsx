import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPut, apiPost } from '@/shared/services/api.service'
import { Card, Chip, Kpis, PageShell, Skeleton, fmtDateTime, useAutoRefresh, Btn } from './kit'

/**
 * Активность ассистента.
 *
 * Автоматика, которая пишет клиентам, обязана показывать, кому и что она
 * написала: иначе через неделю никто не ответит, почему клиент получил
 * сообщение, — и её выключат целиком, вместе с пользой.
 */

const ACTION_LABEL: Record<string, string> = {
  nurture_sent: 'отправлено клиенту',
  nurture_draft: 'черновик — отправьте вручную',
  nurture_failed: 'не отправилось',
  draft_failed: 'не смог написать',
  handover: 'передано сейлзу',
  inbox_lead: 'новое обращение',
  qualify_sent: 'квалификатор ответил',
  qualify_draft: 'квалификатор: черновик',
  qualify_extracted: 'выяснены факты',
  qualify_handover: 'квалификатор зовёт сейлза',
  qualify_failed: 'квалификатор не смог',
  qualify_silent: 'квалификатор промолчал',
}
const ACTION_TONE: Record<string, string> = {
  nurture_sent: 'green', nurture_draft: 'amber', nurture_failed: 'red',
  draft_failed: 'red', handover: 'blue',
  qualify_sent: 'violet', qualify_draft: 'amber', qualify_extracted: 'green',
  qualify_handover: 'blue', qualify_failed: 'red', inbox_lead: 'gray', qualify_silent: 'gray',
}

export function SalesAssistantPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Режим квалификатора: auto — пишет сам, draft — только черновики, off — молчит
  const [qMode, setQMode] = useState<string | null>(null)

  useEffect(() => {
    apiGet<any>('/settings', false)
      .then(d => setQMode(String(d?.settings?.sales_qualifier_mode || 'auto')))
      .catch(() => setQMode('auto'))
  }, [])

  const saveQMode = async (m: string) => {
    setQMode(m)
    try { await apiPut('/settings', { settings: { sales_qualifier_mode: m } }) }
    catch { setError('Режим не сохранился — попробуйте ещё раз') }
  }

  const load = useCallback(() => {
    apiGet<any>('/sales/assistant', false)
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e?.message || 'Не удалось загрузить журнал'))
  }, [])

  useEffect(() => { load() }, [load])
  useAutoRefresh(load, 30000)

  const toggle = async (leadId: string, paused: boolean) => {
    setBusy(leadId)
    try {
      await apiPost(`/sales/assistant?action=${paused ? 'resume' : 'pause'}`, { leadId })
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось изменить')
    } finally { setBusy(null) }
  }

  if (error && !data) return <div className="p-6 text-sm text-gray-900">{error}</div>
  if (!data) return <Skeleton rows={7} />

  const s = data.stats || {}

  return (
    <PageShell header={
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">ИИ-ассистент</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Прогреватель пишет тем, кто молчит. Квалификатор отвечает тем, кто написал:
            выясняет кассу, филиалы и поток заказов, пересчитывает балл и зовёт сейлза,
            когда клиент готов говорить о деле.
          </p>
        </div>
        {/* Квалификатор можно осадить, не трогая прогрев: черновики или тишина */}
        <div className="flex-none">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Квалификатор
          </div>
          <div className="flex gap-1">
            {([['auto', 'Сам пишет'], ['draft', 'Черновики'], ['off', 'Выключен']] as const).map(([m, label]) => (
              <button key={m} onClick={() => saveQMode(m)}
                title={m === 'auto' ? 'Отвечает клиентам сам и заполняет квалификацию'
                  : m === 'draft' ? 'Готовит ответы в журнал, отправляет человек'
                  : 'Не пишет и не извлекает — полная тишина'}
                className={`text-[11.5px] px-2.5 py-1 rounded-lg border ${
                  qMode === m ? 'bg-violet-600 border-violet-600 text-white'
                              : 'border-gray-300 text-gray-600 hover:border-violet-400'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    }>

      <Kpis items={[
        ['Отправлено', String(s.sent ?? 0), 'сообщений за 30 дней'],
        ['Черновиков', String(s.drafts ?? 0), 'ждут отправки человеком'],
        ['Передано сейлзу', String(s.handovers ?? 0), 'клиент ответил'],
        ['Ошибок', String(s.errors ?? 0), 'не отправилось'],
        ['На прогреве', String((data.queue || []).length), 'лидов в цепочке'],
      ]} />

      <Card
        title="Цепочка касаний"
        sub="жёсткая рамка: максимум четыре сообщения, без обещаний скидок и сроков"
      >
        <div className="px-4 py-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(data.steps || []).map((st: any, i: number) => (
            <div key={i} className="border border-gray-200 rounded-lg p-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">
                Шаг {i + 1} · день {st.day}
              </div>
              <div className="text-[12px] text-gray-700 mt-1">{st.goal}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Кто сейчас на прогреве" sub="шаг цепочки и когда следующее касание">
        {!(data.queue || []).length ? (
          <div className="px-4 py-4 text-[12.5px] text-gray-400">Никого — очередь пуста.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.queue.map((l: any) => (
              <div key={l.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[12.5px] font-medium text-gray-900">{l.name}</div>
                  <div className="text-[11px] text-gray-400">
                    {[l.city, l.source, l.phone].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Chip tone="gray">шаг {l.nurture_step ?? 0} из {data.maxSteps}</Chip>
                {!l.channel_id && <Chip tone="amber">канал не привязан</Chip>}
                {l.nurture_paused_at
                  ? <Chip tone="red">на паузе</Chip>
                  : <span className="text-[11px] text-gray-500">
                      {l.nurture_next_at ? `следующее ${fmtDateTime(l.nurture_next_at)}` : 'в ближайший тик'}
                    </span>}
                <Btn disabled={busy === l.id} onClick={() => toggle(l.id, Boolean(l.nurture_paused_at))}>
                  {l.nurture_paused_at ? 'Возобновить' : 'Пауза'}
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Журнал" sub="каждое действие ассистента: кому, что и с каким исходом">
        {!(data.log || []).length ? (
          <div className="px-4 py-4 text-[12.5px] text-gray-400">
            Пока пусто. Ассистент просыпается вместе с кроном продаж и берёт лиды со статусом «на прогреве».
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
            {data.log.map((r: any) => (
              <div key={r.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip tone={ACTION_TONE[r.action] || 'gray'}>
                    {ACTION_LABEL[r.action] || r.action}
                  </Chip>
                  <span className="text-[12.5px] text-gray-900">{r.lead_name || '—'}</span>
                  {r.step ? <span className="text-[11px] text-gray-400">шаг {r.step}</span> : null}
                  <span className="text-[11px] text-gray-400 ml-auto">{fmtDateTime(r.created_at)}</span>
                </div>
                {r.message && (
                  <div className="text-[12px] text-gray-700 mt-1 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
                    {r.message}
                    {/* Черновик без канала — не тупик: текст готов, отправить
                        его человек может сам, не переписывая */}
                    {r.action === 'nurture_draft' && (
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(r.message)
                          setCopied(r.id)
                          setTimeout(() => setCopied(null), 1500)
                        }}
                        className="ml-2 text-[11px] text-blue-600 hover:underline"
                      >
                        {copied === r.id ? 'скопировано' : 'скопировать'}
                      </button>
                    )}
                  </div>
                )}
                {r.reply && (
                  <div className="text-[12px] text-blue-800 mt-1 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5">
                    Ответ клиента: {r.reply}
                  </div>
                )}
                {r.error && <div className="text-[11.5px] text-red-600 mt-1">{r.error}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {error && <div className="text-[12.5px] text-red-600">{error}</div>}
    </PageShell>
  )
}

export default SalesAssistantPage
