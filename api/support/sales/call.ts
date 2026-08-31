import { getRequestOrgId } from '../_lib/org.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { readPbxConfig, pbxCallNow, pbxProbe, pbxRecordUrl } from '../_lib/pbx.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Звонок с карточки. Сейлз жмёт «Позвонить» — АТС звонит на его внутренний
 * номер, он снимает трубку, АТС набирает клиента. Руки не набирают номер,
 * а звонок гарантированно проходит через запись.
 *
 * POST { to, leadId? }         — набрать номер
 * POST ?action=probe {}        — диагностика: живой ли ключ, что отвечает история
 *
 * Первая нога звонка: личный номер сотрудника (support_agents.pbx_ext),
 * иначе общий из настроек (onlinepbx_ext). Годится и внутренний номер АТС
 * («100»), и мобильный («998…») — АТС принимает внешние номера первой ногой,
 * проверено на живом вызове; запись разговора идёт в обоих случаях.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

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
    return json({ ok: true })
  } catch (e: any) {
    return json({ error: 'Телефония недоступна', details: String(e?.message || e).slice(0, 200) }, 502)
  }
}
