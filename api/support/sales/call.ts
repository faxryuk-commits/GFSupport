import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { readPbxConfig, pbxCallNow, pbxProbe, pbxRecordUrl, pbxCallStatus, pbxHookSecret, pbxUserWebrtc, pbxUsers } from '../_lib/pbx.js'
import { leadFromPhone } from '../_lib/sales-intake.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Звонок с карточки. Сейлз жмёт «Позвонить» — АТС звонит на его внутренний
 * номер, он снимает трубку, АТС набирает клиента. Руки не набирают номер,
 * а звонок гарантированно проходит через запись.
 *
 * POST { to, leadId? }         — набрать номер
 * POST ?action=lead {number}   — карточка лида по номеру: найти или создать
 * POST ?action=probe {}        — диагностика: живой ли ключ, что отвечает история
 *
 * Первая нога звонка: личный номер сотрудника (support_agents.pbx_ext),
 * иначе общий из настроек (onlinepbx_ext). Годится и внутренний номер АТС
 * («100»), и мобильный («998…») — АТС принимает внешние номера первой ногой,
 * проверено на живом вызове; запись разговора идёт в обоих случаях.
 */
/** Первая нога звонка: личный номер сотрудника, иначе общий организации. */
async function resolveExt(sql: any, orgId: string, agentId: string): Promise<{ ext: string; personal: boolean }> {
  const [me] = await sql`
    SELECT pbx_ext FROM support_agents WHERE id = ${agentId} LIMIT 1
  `.catch(() => [] as any[]) as any[]
  const own = String(me?.pbx_ext || '').trim()
  if (own) return { ext: own, personal: true }
  const rows = await sql`
    SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'onlinepbx_ext' LIMIT 1
  ` as any[]
  return { ext: String(rows[0]?.value || '').trim(), personal: false }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // Дашборд звонков: агрегаты и список за период. Считается из касаний синка
  // (title/detail) — отдельного хранилища звонков нет, и для картины «сколько,
  // когда и с кем говорили» оно и не нужно. «Звонок из карточки» — служебная
  // отметка нажатия, не сам разговор, поэтому в статистику не входит
  if (req.method === 'GET' && url.searchParams.get('action') === 'stats') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7)))
    const [rows, extRows] = await Promise.all([
      sql`
        SELECT t.title, t.detail, t.identity, t.happened_at, t.lead_id,
               l.name AS lead_name, d.id AS deal_id, d.title AS deal_title
        FROM sales_touchpoints t
        LEFT JOIN sales_leads l ON l.id = t.lead_id
        LEFT JOIN LATERAL (
          SELECT id, title FROM sales_deals
          WHERE org_id = ${orgId} AND source_lead_id = t.lead_id
          ORDER BY created_at DESC LIMIT 1
        ) d ON true
        WHERE t.org_id = ${orgId} AND t.kind = 'call'
          AND (t.title LIKE 'Входящий%' OR t.title LIKE 'Исходящий%')
          AND t.happened_at > NOW() - make_interval(days => ${days})
        ORDER BY t.happened_at DESC
      `,
      sql`
        SELECT name, pbx_ext FROM support_agents
        WHERE org_id = ${orgId} AND pbx_ext IS NOT NULL AND merged_into IS NULL
      `,
    ]) as [any[], any[]]

    const extName = new Map<string, string>()
    for (const e of extRows) extName.set(String(e.pbx_ext).replace(/\D/g, ''), e.name)

    // Наивные UTC-таймстампы: Ташкент — фиксированный сдвиг +5, без переходов
    const TK = 5 * 3600 * 1000
    const byDay = new Map<string, { answered: number; missed: number }>()
    const byHour = Array.from({ length: 24 }, () => ({ answered: 0, missed: 0 }))
    const byAgent = new Map<string, {
      name: string; total: number; answered: number; talkSec: number
      inbound: number; outbound: number; days: Record<string, number>
    }>()
    let inbound = 0, outbound = 0, answered = 0, missedIn = 0, failedOut = 0, talkSec = 0
    const calls: any[] = []
    for (const r of rows) {
      const title = String(r.title || '')
      const dirIn = title.startsWith('Входящий')
      const m = title.match(/(\d+) сек/)
      const talk = m ? Number(m[1]) : 0
      const ok = talk > 0
      const parts = String(r.detail || '').split('·').map((s: string) => s.trim())
      const number = parts[0] || ''
      const sideRaw = parts[1] || ''
      // Имя сотрудника синк пишет третьим сегментом; старые касания без него
      // резолвятся по добавочному из профилей
      let who = parts[2] || ''
      if (!who) {
        if (/^внутр\./.test(sideRaw)) who = extName.get(sideRaw.replace(/\D/g, '')) || sideRaw
        else if (/^моб\./.test(sideRaw)) who = sideRaw.replace(/^моб\.\s*/, '')
      }
      if (dirIn) inbound++; else outbound++
      if (ok) { answered++; talkSec += talk } else if (dirIn) missedIn++; else failedOut++
      const t = new Date(r.happened_at).getTime() + TK
      const day = new Date(t).toISOString().slice(0, 10)
      const hour = new Date(t).getUTCHours()
      if (!byDay.has(day)) byDay.set(day, { answered: 0, missed: 0 })
      const dd = byDay.get(day)!
      if (ok) dd.answered++; else dd.missed++
      if (ok) byHour[hour].answered++; else byHour[hour].missed++
      // Неразрезолвленные узлы АТС («внутр. 10» — группа, «очередь 5200») —
      // не сотрудники: в таблице людей им делать нечего
      if (who && !/^(внутр\.|очередь)/.test(who)) {
        if (!byAgent.has(who)) {
          byAgent.set(who, { name: who, total: 0, answered: 0, talkSec: 0, inbound: 0, outbound: 0, days: {} })
        }
        const aa = byAgent.get(who)!
        aa.total++
        if (dirIn) aa.inbound++; else aa.outbound++
        aa.days[day] = (aa.days[day] || 0) + 1
        if (ok) { aa.answered++; aa.talkSec += talk }
      }
      if (calls.length < 80) {
        calls.push({
          uuid: r.identity, at: r.happened_at, direction: dirIn ? 'in' : 'out',
          answered: ok, talkSec: talk, number, who,
          leadId: r.lead_id, leadName: r.lead_name,
          dealId: r.deal_id, dealTitle: r.deal_title,
        })
      }
    }
    // Пустые дни тоже в тренде: провал в графике информативнее дырки в оси
    const daysArr: any[] = []
    const nowTk = Date.now() + TK
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(nowTk - i * 86400000).toISOString().slice(0, 10)
      daysArr.push({ day: k, ...(byDay.get(k) || { answered: 0, missed: 0 }) })
    }
    return json({
      period: days,
      totals: {
        total: rows.length, inbound, outbound, answered, missedIn, failedOut,
        talkSec, avgTalkSec: answered ? Math.round(talkSec / answered) : 0,
      },
      byDay: daysArr,
      byHour: byHour.map((v, h) => ({ h, ...v })),
      byAgent: [...byAgent.values()].sort((a, b) => b.total - a.total),
      calls,
    })
  }

  // Поиск по клиентской базе для звонилки: имя или кусок номера — и звонить
  // можно, не вспоминая, в каком списке живёт человек. Ищем в обращениях
  // и в контактах аккаунтов
  if (req.method === 'GET' && url.searchParams.get('action') === 'search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60)
    if (q.length < 2) return json({ results: [] })
    const digits = q.replace(/\D/g, '')
    const byPhone = digits.length >= 4
    const like = '%' + q + '%'
    const dlike = '%' + digits + '%'
    const [leads, contacts] = await Promise.all([
      byPhone
        ? sql`
          SELECT id, name, phone FROM sales_leads
          WHERE org_id = ${orgId} AND archived_at IS NULL AND phone IS NOT NULL
            AND (phone_norm LIKE ${dlike} OR name ILIKE ${like})
          ORDER BY created_at DESC LIMIT 6`
        : sql`
          SELECT id, name, phone FROM sales_leads
          WHERE org_id = ${orgId} AND archived_at IS NULL AND phone IS NOT NULL
            AND name ILIKE ${like}
          ORDER BY created_at DESC LIMIT 6`,
      byPhone
        ? sql`
          SELECT c.account_id AS id, c.name, c.phone, a.name AS account
          FROM sales_contacts c JOIN sales_accounts a ON a.id = c.account_id
          WHERE c.org_id = ${orgId} AND c.phone IS NOT NULL
            AND (regexp_replace(c.phone, ${'\\D'}, '', 'g') LIKE ${dlike}
                 OR c.name ILIKE ${like} OR a.name ILIKE ${like})
          LIMIT 6`
        : sql`
          SELECT c.account_id AS id, c.name, c.phone, a.name AS account
          FROM sales_contacts c JOIN sales_accounts a ON a.id = c.account_id
          WHERE c.org_id = ${orgId} AND c.phone IS NOT NULL
            AND (c.name ILIKE ${like} OR a.name ILIKE ${like})
          LIMIT 6`,
    ]) as [any[], any[]]
    const results = [
      ...leads.map(l => ({ kind: 'lead', id: l.id, name: l.name, phone: l.phone, sub: null })),
      ...contacts.map(c => ({
        kind: 'account', id: c.id, name: c.name || c.account, phone: c.phone,
        sub: c.account && c.name !== c.account ? c.account : null,
      })),
    ].slice(0, 8)
    return json({ results })
  }

  // Живые входящие: события вебхука АТС за последнюю минуту. Пока АТС шлёт
  // события — человек звонит или разговор идёт; отбой убирает карточку сам,
  // когда события кончаются
  if (req.method === 'GET' && url.searchParams.get('action') === 'live') {
    const rows = await sql`
      SELECT DISTINCT ON (caller) caller, event, created_at
      FROM sales_pbx_events
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '60 seconds'
        AND caller IS NOT NULL
        AND length(regexp_replace(caller, ${'\\D'}, '', 'g')) >= 7
        AND COALESCE(raw->>'direction', '') <> 'outbound'
      ORDER BY caller, created_at DESC
    `.catch(() => [] as any[]) as any[]
    const live = rows.filter(r => !/hangup|bye|end/i.test(String(r.event || '')))
    const calls: any[] = []
    for (const r of live.slice(0, 3)) {
      const norm = String(r.caller).replace(/\D/g, '').slice(-9)
      // Свой номер проверяем ПЕРВЫМ: раньше сотрудника искали только когда
      // лида нет, и одна ошибочно созданная карточка на номер коллеги навсегда
      // выдавала его за клиента — со всплывашкой и кнопкой «создать лида»
      const [st] = await sql`
        SELECT name FROM support_agents
        WHERE (regexp_replace(COALESCE(phone, ''), ${'\\D'}, '', 'g') LIKE ${'%' + norm}
               OR regexp_replace(COALESCE(pbx_ext, ''), ${'\\D'}, '', 'g') LIKE ${'%' + norm})
          AND merged_into IS NULL
        LIMIT 1
      `.catch(() => [] as any[]) as any[]
      const staff: string | null = st?.name || null
      const [lead] = staff ? [null] : await sql`
        SELECT id, name FROM sales_leads
        WHERE org_id = ${orgId} AND archived_at IS NULL AND phone_norm LIKE ${'%' + norm}
        ORDER BY created_at DESC LIMIT 1
      `.catch(() => [] as any[]) as any[]
      calls.push({
        number: r.caller, at: r.created_at,
        leadId: lead?.id || null, leadName: lead?.name || null,
        staff,
      })
    }
    return json({ calls })
  }

  // Линия прямо сейчас: события вебхука сворачиваются по uuid звонка в
  // состояния «звонит» / «разговор». Дашборд показывает живую картину —
  // кто на линии и как давно
  if (req.method === 'GET' && url.searchParams.get('action') === 'now') {
    const rows = await sql`
      SELECT event, caller, callee, raw->>'uuid' AS uuid, raw->>'direction' AS dir, created_at
      FROM sales_pbx_events
      WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '2 hours'
        AND raw->>'uuid' IS NOT NULL
      ORDER BY created_at ASC
    `.catch(() => [] as any[]) as any[]
    interface Line {
      uuid: string; dir: string; client: string; ext: string | null
      state: 'ringing' | 'talking' | 'done'; at: string
    }
    const byUuid = new Map<string, Line>()
    for (const r of rows) {
      const dir = String(r.dir || '')
      const client = dir === 'inbound' ? String(r.caller || '') : String(r.callee || '')
      const ext = dir === 'inbound' ? null : String(r.caller || '') || null
      const cur = byUuid.get(r.uuid) || {
        uuid: r.uuid, dir, client, ext, state: 'ringing' as const, at: r.created_at,
      }
      if (client && !cur.client) cur.client = client
      const ev = String(r.event || '')
      if (/answered/.test(ev)) { cur.state = 'talking'; cur.at = r.created_at }
      else if (/end|missed|hangup/.test(ev)) cur.state = 'done'
      byUuid.set(r.uuid, cur)
    }
    const nowMs = Date.now()
    const lines: any[] = []
    for (const l of byUuid.values()) {
      if (l.state === 'done') continue
      const ageSec = Math.round((nowMs - new Date(l.at).getTime()) / 1000)
      // Осиротевшие состояния (событие завершения потерялось) не должны
      // висеть вечно: гудки живут минуты, разговоры — до пары часов
      if (l.state === 'ringing' && ageSec > 180) continue
      if (l.state === 'talking' && ageSec > 2 * 3600) continue
      const digits = l.client.replace(/\D/g, '')
      if (digits.length < 7) continue
      const norm = digits.slice(-9)
      const [lead] = await sql`
        SELECT id, name FROM sales_leads
        WHERE org_id = ${orgId} AND archived_at IS NULL AND phone_norm LIKE ${'%' + norm}
        ORDER BY created_at DESC LIMIT 1
      `.catch(() => [] as any[]) as any[]
      lines.push({
        direction: l.dir === 'inbound' ? 'in' : 'out',
        state: l.state,
        number: l.client,
        ext: l.ext,
        sinceSec: ageSec,
        leadId: lead?.id || null,
        leadName: lead?.name || null,
      })
      if (lines.length >= 8) break
    }
    return json({ lines })
  }

  // Браузерный софтфон: Verto-креды по линии текущего оператора. Владелец
  // короткого добавочного получает свой; остальным (фаундер, поддержка) линия
  // выдаётся динамически из пула свободных — журнал sales_pbx_seats помнит,
  // кто какую держал, и звонки в учёте лягут на человека, а не на «внутр. N».
  // Ext берётся ТОЛЬКО на сервере, фронт чужой запросить не может; пароль АТС
  // не хранится у нас и не нужен сотруднику
  if (url.searchParams.get('action') === 'webrtc-creds') {
    const cfg = await readPbxConfig(sql, orgId)
    if (!cfg) return json({ success: false, code: 'PBX_SETTINGS_NOT_CONFIGURED', message: 'Телефония не настроена' }, 404)
    try {
      const { allocateSeat } = await import('../_lib/pbx-seats.js')
      const pool = (await pbxUsers(cfg))
        .map(u => u.num.replace(/\D/g, ''))
        .filter(n => n.length >= 2 && n.length <= 3)
      if (!pool.length) {
        return json({ success: false, code: 'PBX_OPERATOR_NOT_CONFIGURED', message: 'На АТС нет коротких добавочных' }, 404)
      }
      const seat = await allocateSeat(sql, orgId, ctx.agentId, pool)
      if ('error' in seat) {
        return json({ success: false, code: 'PBX_NO_FREE_SEAT', message: seat.error }, 409)
      }
      const ext = seat.ext
      const w = await pbxUserWebrtc(cfg, ext)
      if (!w) {
        return json({ success: false, code: 'PBX_WEBRTC_NOT_AVAILABLE', message: 'АТС не выдала WebRTC-креды для добавочного ' + ext }, 422)
      }
      if (!w.enabled) {
        return json({ success: false, code: 'PBX_ACCESS_DENIED', message: 'Добавочный ' + ext + ' выключен на АТС' }, 403)
      }
      // Свой tenant-шлюз из настроек — приоритетом; хост провайдера — рабочий
      // fallback (проверен реальным Verto-логином на нашей АТС)
      const [vh] = await sql`
        SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'onlinepbx_verto_host' LIMIT 1
      `.catch(() => [] as any[]) as any[]
      const rawHost = String(vh?.value || '').trim() || w.host
      if (!rawHost) {
        return json({ success: false, code: 'PBX_VERTO_HOST_NOT_CONFIGURED', message: 'Verto-шлюз не настроен' }, 422)
      }
      const host = /^wss?:\/\//i.test(rawHost) ? rawHost : `wss://${rawHost}`
      const login = w.user.includes('@') ? w.user : `${w.user}@${cfg.domain}`
      const [meName] = await sql`
        SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1
      `.catch(() => [] as any[]) as any[]
      return new Response(JSON.stringify({
        success: true, protocol: 'verto', host, login,
        user: login.split('@')[0], extension: ext,
        verto_password: w.password, expires_at: null,
        // Динамическая линия: фронт покажет «вы на линии N» и будет продлевать
        // аренду; имя уйдёт в caller_id_name — АТС видит, кто реально звонит
        seat: seat.shared ? 'shared' : 'personal',
        display_name: meName?.name || ext,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
      })
    } catch (e: any) {
      return json({ success: false, code: 'PBX_PROVIDER_ERROR', message: String(e?.message || e).slice(0, 200) }, 502)
    }
  }

  // Продление и возврат динамической линии: продление раз в 45с держит аренду,
  // отпущенная или протухшая линия возвращается в пул для следующего
  if (url.searchParams.get('action') === 'webrtc-renew') {
    const b = await req.json().catch(() => null)
    const { renewSeat } = await import('../_lib/pbx-seats.js')
    const ok = await renewSeat(sql, orgId, ctx.agentId, String(b?.ext || ''))
    return json({ ok })
  }
  if (url.searchParams.get('action') === 'webrtc-release') {
    const b = await req.json().catch(() => null)
    const { releaseSeat } = await import('../_lib/pbx-seats.js')
    await releaseSeat(sql, orgId, ctx.agentId, b?.ext ? String(b.ext) : undefined)
    return json({ ok: true })
  }

  // История для звонилки: последние звонки из касаний с привязкой к лидам.
  // Синк наполняет их раз в несколько минут — свежайший звонок может чуть
  // запаздывать, и это нормально
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT t.title, t.detail, t.happened_at, t.lead_id, l.name AS lead_name
      FROM sales_touchpoints t
      LEFT JOIN sales_leads l ON l.id = t.lead_id
      WHERE t.org_id = ${orgId} AND t.kind = 'call'
      ORDER BY t.happened_at DESC LIMIT 15
    ` as any[]
    // С какого номера уйдёт исходящий — звонилка показывает это до набора,
    // чтобы сейлз знал, какая трубка сейчас зазвонит
    const myExt = await resolveExt(sql, orgId, ctx.agentId)
    return json({
      ext: myExt.ext || null,
      extPersonal: myExt.personal,
      calls: rows.map((r: any) => ({
        // Номер клиента лежит в начале detail до разделителя
        number: String(r.detail || '').split('·')[0].trim(),
        title: r.title,
        at: r.happened_at,
        leadId: r.lead_id,
        leadName: r.lead_name,
      })),
    })
  }

  // Карточка из звонилки: разговор с новым номером состоялся — куда его класть?
  // Одно нажатие превращает номер в лида через общий приёмник (тот же путь,
  // что у входящих с неизвестных номеров). Совпадение по номеру возвращает
  // существующую карточку, а осиротевшие касания-звонки прикрепляются к новой.
  if (url.searchParams.get('action') === 'lead') {
    const b = await req.json().catch(() => null)
    const r = await leadFromPhone(sql, orgId, String(b?.number || ''), {
      name: b?.name, createdFrom: 'dialer', byAgent: ctx.agentId,
    })
    if (r.error) return json({ error: r.error }, r.error === 'Номер не распознан' ? 400 : 500)
    return json({ leadId: r.leadId, name: r.name, existing: r.existing })
  }

  const cfg = await readPbxConfig(sql, orgId)
  if (!cfg) {
    return json({ error: 'Телефония не настроена: укажите домен АТС и API-ключ OnlinePBX в настройках' }, 422)
  }

  // Адрес вебхука для личного кабинета АТС: с ним входящие всплывают в CRM
  // ещё до снятой трубки. Секрет — производная от API-ключа, сам ключ в URL
  // не попадает
  if (url.searchParams.get('action') === 'hookurl') {
    if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
      return json({ error: 'только администратор' }, 403)
    }
    const s = await pbxHookSecret(cfg.authKey)
    return json({ url: `https://www.gfsupport.uz/api/support/webhook/pbx?s=${s}` })
  }

  if (url.searchParams.get('action') === 'probe') {
    if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
      return json({ error: 'только администратор' }, 403)
    }
    try {
      const raw = await pbxProbe(cfg)
      return json({ ok: true, raw })
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 502)
    }
  }

  // Судьба вызова: АТС принимает заявку мгновенно, а провал случается позже —
  // занято, не ответили, транк не в строю. Звонилка опрашивает исход и
  // показывает правду вместо вечного «АТС звонит вам»
  if (url.searchParams.get('action') === 'status') {
    const b = await req.json().catch(() => null)
    const uuid = String(b?.uuid || '').trim()
    if (!/^[0-9a-f-]{20,60}$/i.test(uuid)) return json({ error: 'uuid не распознан' }, 400)
    try {
      const st = await pbxCallStatus(cfg, uuid)
      if (!st.found) return json({ done: false })
      const c = String(st.hangupCause || '')
      const human = st.talkSec > 0 ? `разговор состоялся · ${st.talkSec} сек`
        : /UNALLOCATED/i.test(c) ? 'номер не существует — или исходящая линия АТС не активна'
        : /USER_BUSY/i.test(c) ? 'занято'
        : /NO_ANSWER|ORIGINATOR_CANCEL|NO_USER_RESPONSE/i.test(c) ? 'не ответили'
        : /CALL_REJECT/i.test(c) ? 'сбросили вызов'
        : st.durationSec > 0 ? 'соединение было, но разговор не состоялся'
        : 'звонок не состоялся'
      return json({ done: true, ok: st.talkSec > 0, human, talkSec: st.talkSec })
    } catch {
      return json({ done: false })
    }
  }

  // Расшифровка и разбор звонка: готовое отдаём сразу, отсутствующее ставим
  // в очередь — крон обработает за минуту-другую
  if (url.searchParams.get('action') === 'insight') {
    const b = await req.json().catch(() => null)
    const uuid = String(b?.uuid || '').trim()
    if (!/^[0-9a-f-]{20,60}$/i.test(uuid)) return json({ error: 'uuid не распознан' }, 400)
    const { ensureInsightsSchema, queueInsight } = await import('../_lib/call-insights.js')
    await ensureInsightsSchema(sql)
    const [row] = await sql`
      SELECT status, summary, coach, transcript, error FROM sales_call_insights
      WHERE call_uuid = ${uuid} AND org_id = ${orgId} LIMIT 1
    ` as any[]
    if (row?.status === 'done') {
      return json({ status: 'done', summary: row.summary, coach: row.coach, transcript: row.transcript })
    }
    if (row?.status === 'failed') {
      // Повторная попытка по клику: ссылка на запись могла просто протухнуть
      await sql`
        UPDATE sales_call_insights SET status = 'pending', error = NULL
        WHERE call_uuid = ${uuid} AND org_id = ${orgId}
      `.catch(() => {})
      return json({ status: 'pending', note: `прошлая попытка не удалась (${row.error || 'без причины'}) — поставил заново` })
    }
    if (!row) await queueInsight(sql, orgId, uuid, 9999)
    return json({ status: 'pending' })
  }

  // Запись разговора: свежая подписанная ссылка на mp3 по uuid звонка.
  // Доступна любому вошедшему сотруднику — как и сама карточка клиента
  if (url.searchParams.get('action') === 'record') {
    const b = await req.json().catch(() => null)
    const uuid = String(b?.uuid || '').trim()
    if (!/^[0-9a-f-]{20,60}$/i.test(uuid)) return json({ error: 'uuid не распознан' }, 400)
    try {
      const rec = await pbxRecordUrl(cfg, uuid)
      if (!rec) return json({ error: 'Запись не найдена — возможно, разговор не записывался' }, 404)
      return json({ url: rec })
    } catch (e: any) {
      return json({ error: 'АТС не отдала запись', details: String(e?.message || e).slice(0, 200) }, 502)
    }
  }

  const body = await req.json().catch(() => null)
  const to = String(body?.to || '').replace(/[^\d+]/g, '')
  if (!to || to.length < 7) return json({ error: 'Номер не распознан' }, 400)

  // Внутренний номер: личный сотрудника или общий организации
  const resolved = await resolveExt(sql, orgId, ctx.agentId)
  const ext = resolved.ext
  if (!ext) {
    return json({ error: 'Не задан внутренний номер: укажите onlinepbx_ext в настройках или личный номер сотрудника' }, 422)
  }

  try {
    const res = await pbxCallNow(cfg, ext, to)
    if (!res.ok) {
      const raw = JSON.stringify(res.raw).slice(0, 200)
      const c = String(res.raw?.comment || '')
      const human = /DND/i.test(c)
        ? `Номер ${ext} не в сети или в режиме «не беспокоить» — включите софтфон, либо укажите в настройках свой мобильный: АТС позвонит на него`
        : /not (registered|found)|no such user/i.test(c)
          ? `Внутренний номер ${ext} не зарегистрирован на АТС — проверьте номер в настройках`
          : /busy/i.test(c)
            ? `Ваш номер ${ext} занят другим разговором — освободите линию и повторите`
            : `АТС не приняла звонок — проверьте, что ваш номер ${ext} свободен и в сети`
      return json({ error: human, details: raw }, 502)
    }
    const callUuid = String(res.raw?.data?.uuid || '')
    // Чей номер: звонилка по ответу либо ведёт в карточку, либо предлагает
    // создать лида — звонок новому клиенту не должен повисать в воздухе
    let leadHit: any = null
    if (!body?.leadId) {
      const norm = to.replace(/\D/g, '').slice(-9)
      const hits = await sql`
        SELECT id, name FROM sales_leads
        WHERE org_id = ${orgId} AND archived_at IS NULL AND phone_norm LIKE ${'%' + norm}
        ORDER BY created_at DESC LIMIT 1
      `.catch(() => [] as any[]) as any[]
      leadHit = hits[0] || null
    }
    // След в пути клиента: сейлз инициировал звонок. Сам разговор и его
    // длительность приедут синком истории и лягут отдельным касанием
    if (body?.leadId) {
      const [lead] = await sql`
        SELECT id, account_id FROM sales_leads WHERE id = ${body.leadId} AND org_id = ${orgId} LIMIT 1
      ` as any[]
      if (lead) {
        // В identity — uuid вызова, а не добавочный: по нему кнопка «запись»
        // достаёт разговор; добавочный там выглядел как uuid и ломал её
        await sql`
          INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel, title, identity)
          VALUES (${`stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`}, ${orgId},
                  ${lead.account_id}, ${lead.id}, 'call', 'phone',
                  ${'Звонок из карточки'}, ${callUuid || null})
        `.catch(() => {})
      }
    }
    return json({
      ok: true,
      uuid: callUuid || null,
      ext,
      lead: leadHit ? { id: leadHit.id, name: leadHit.name } : null,
    })
  } catch (e: any) {
    return json({ error: 'Телефония недоступна', details: String(e?.message || e).slice(0, 200) }, 502)
  }
}
