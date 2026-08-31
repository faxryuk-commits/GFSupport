import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { readPbxConfig, pbxCallNow, pbxProbe, pbxRecordUrl, pbxCallStatus } from '../_lib/pbx.js'
import { acceptLead } from '../_lib/sales-intake.js'

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
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

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
    return json({
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
    const rawNum = String(b?.number || '').trim()
    const norm = rawNum.replace(/\D/g, '').slice(-9)
    if (norm.length < 7) return json({ error: 'Номер не распознан' }, 400)

    const [hit] = await sql`
      SELECT id, name FROM sales_leads
      WHERE org_id = ${orgId} AND archived_at IS NULL AND phone_norm LIKE ${'%' + norm}
      ORDER BY created_at DESC LIMIT 1
    ` as any[]
    if (hit) return json({ leadId: hit.id, name: hit.name, existing: true })

    const res: any = await acceptLead(sql, orgId, {
      source: 'call',
      external_id: `pbx_${norm}`,
      name: String(b?.name || '').trim().slice(0, 255) || `Звонок ${rawNum}`,
      phone: rawNum,
      lead_kind: 'call',
      raw: { created_from: 'dialer', by: ctx.agentId },
    }).catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
    if (!res?.ok || !res.lead_id) {
      return json({ error: res?.error || 'Не удалось создать лида' }, 500)
    }
    const [lead] = await sql`
      SELECT id, account_id FROM sales_leads WHERE id = ${res.lead_id} LIMIT 1
    ` as any[]
    // Звонки этого номера, лежавшие без хозяина, — в новую карточку.
    // Номер клиента — начало detail до разделителя; regex параметром: инлайновый
    // обратный слэш ломается в шаблоне neon
    await sql`
      UPDATE sales_touchpoints
      SET lead_id = ${lead.id}, account_id = ${lead.account_id}
      WHERE org_id = ${orgId} AND kind = 'call' AND lead_id IS NULL
        AND regexp_replace(split_part(detail, '·', 1), ${'\\D'}, '', 'g') LIKE ${'%' + norm}
    `.catch(() => {})
    // Если среди прикреплённых уже был состоявшийся разговор — это и есть
    // первое касание, пусть норматив меряется честно
    await sql`
      UPDATE sales_leads l SET first_touch_at = sub.t, updated_at = NOW()
      FROM (
        SELECT MIN(happened_at) AS t FROM sales_touchpoints
        WHERE org_id = ${orgId} AND lead_id = ${lead.id} AND kind = 'call' AND title LIKE '%сек%'
      ) sub
      WHERE l.id = ${lead.id} AND l.first_touch_at IS NULL AND sub.t IS NOT NULL
    `.catch(() => {})
    return json({ leadId: lead.id, existing: false })
  }

  const cfg = await readPbxConfig(sql, orgId)
  if (!cfg) {
    return json({ error: 'Телефония не настроена: укажите домен АТС и API-ключ OnlinePBX в настройках' }, 422)
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
  const [me] = await sql`
    SELECT pbx_ext FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1
  `.catch(() => [] as any[]) as any[]
  let ext = String(me?.pbx_ext || '').trim()
  if (!ext) {
    const rows = await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'onlinepbx_ext' LIMIT 1
    ` as any[]
    ext = String(rows[0]?.value || '').trim()
  }
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
          : 'АТС не приняла звонок'
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
        await sql`
          INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel, title, identity)
          VALUES (${`stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`}, ${orgId},
                  ${lead.account_id}, ${lead.id}, 'call', 'phone',
                  ${'Звонок из карточки'}, ${ext})
        `.catch(() => {})
      }
    }
    return json({
      ok: true,
      uuid: callUuid || null,
      lead: leadHit ? { id: leadHit.id, name: leadHit.name } : null,
    })
  } catch (e: any) {
    return json({ error: 'Телефония недоступна', details: String(e?.message || e).slice(0, 200) }, 502)
  }
}
