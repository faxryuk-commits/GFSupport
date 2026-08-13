import type { NeonQueryFunction } from '@neondatabase/serverless'
import { salesId, normPhone } from './sales-schema.js'
import { scoreIcp, routeByBand, FIRST_TOUCH_SLA_MIN } from './sales-icp.js'
import { notifyLeadAssigned } from './sales-bot.js'

type SQL = NeonQueryFunction<false, false>

/**
 * Ядро приёма лида. Один путь для всех поставщиков: HTTP-приёмник (мост Amo,
 * сайт, ручной ввод) и вебхуки каналов (Instagram Direct и далее). Логика
 * склейки, оценки и маршрутизации живёт здесь, чтобы не разъезжаться между
 * входами.
 */

export interface IntakePayload {
  source: string
  external_id?: string | null
  name?: string | null
  phone?: string | null
  contact_name?: string | null
  city?: string | null
  market?: string | null
  campaign?: string | null
  form_id?: string | null
  ad_id?: string | null
  text?: string | null
  orders_per_day?: string | number | null
  points?: string | number | null
  pos?: string | null
  aggregators?: string | null
  delivery_type?: string | null
  channel_key?: string | null   // внешний id диалога: ig-scoped id, chat_id
  owner_hint?: string | null    // ответственный из системы-источника
  raw?: any
}

export interface IntakeResult {
  ok: boolean
  error?: string
  lead_id?: string
  account_id?: string
  deduped?: boolean
  merged_account?: boolean
  icp?: number
  band?: string
  status?: string
  assigned_agent_id?: string | null
}

export async function acceptLead(sql: SQL, orgId: string, body: IntakePayload): Promise<IntakeResult> {
  const sourceKey = String(body.source || '').trim()
  if (!sourceKey) return { ok: false, error: 'source is required' }

  const [source] = await sql`
    SELECT id, label, kind FROM sales_sources
    WHERE org_id = ${orgId} AND key = ${sourceKey} AND is_active = true LIMIT 1
  `
  // Источник обязателен и должен быть заведён: «прочее» превращает отчёт
  // по каналам в кашу, поэтому лучше явная ошибка, чем тихий мусор
  if (!source) return { ok: false, error: `unknown source: ${sourceKey}` }

  const externalId = body.external_id ? String(body.external_id) : null
  const name = String(body.name || body.contact_name || 'Без названия').slice(0, 255)
  const phone = body.phone ? String(body.phone) : null
  const phoneNorm = normPhone(phone)

  // 1. Идемпотентность: повторная доставка одного лида не создаёт дубль
  if (externalId) {
    const [existing] = await sql`
      SELECT id, account_id FROM sales_leads
      WHERE org_id = ${orgId} AND source_id = ${source.id} AND external_id = ${externalId}
      LIMIT 1
    `
    if (existing) {
      // Лид приезжает почти пустым, а менеджер заполняет поля в Amo позже.
      // Поэтому при повторной доставке обновляем то, что могло уточниться, и
      // пересчитываем оценку — иначе в карточке навсегда остаётся первый снимок
      // с названием вида «Заявка с рекламной формы».
      const icpFresh = scoreIcp({
        ordersPerDay: body.orders_per_day, points: body.points, pos: body.pos,
        aggregators: body.aggregators, deliveryType: body.delivery_type,
        city: body.city, text: body.text,
      })
      const betterName = name && !/^Заявка (с|из)|^Без названия$/i.test(name) ? name : null
      await sql`
        UPDATE sales_leads SET
          raw = ${JSON.stringify(body.raw ?? body)}::jsonb,
          name = COALESCE(${betterName}, name),
          city = COALESCE(${body.city || null}, city),
          phone = COALESCE(${phone}, phone),
          phone_norm = COALESCE(${phoneNorm}, phone_norm),
          campaign = COALESCE(${body.campaign || null}, campaign),
          text = COALESCE(${body.text || null}, text),
          icp_score = ${icpFresh.score},
          icp_reasons = ${JSON.stringify(icpFresh.reasons)}::jsonb
        WHERE id = ${existing.id}
      `
      // Название аккаунта тоже подтягиваем: именно оно видно в списках
      if (betterName && existing.account_id) {
        await sql`
          UPDATE sales_accounts SET name = ${betterName}, city = COALESCE(${body.city || null}, city)
          WHERE id = ${existing.account_id} AND (name ~* '^(Заявка |Без названия)' OR name = '')
        `
      }
      return { ok: true, lead_id: existing.id, account_id: existing.account_id, deduped: true }
    }
  }

  // 2. Склейка по телефону: тот же ресторан из другого канала — не новый аккаунт
  let accountId: string | null = null
  let merged = false
  if (phoneNorm) {
    const [contact] = await sql`
      SELECT account_id FROM sales_contacts
      WHERE org_id = ${orgId} AND phone_norm = ${phoneNorm} LIMIT 1
    `
    if (contact?.account_id) {
      accountId = contact.account_id
      merged = true
    }
  }

  const marketId = body.market ? String(body.market) : null
  const city = body.city ? String(body.city).slice(0, 100) : null

  if (!accountId) {
    accountId = salesId('acc')
    await sql`
      INSERT INTO sales_accounts (id, org_id, name, market_id, city, lifecycle)
      VALUES (${accountId}, ${orgId}, ${name}, ${marketId}, ${city}, 'lead')
    `
    if (phone || body.contact_name) {
      await sql`
        INSERT INTO sales_contacts (id, org_id, account_id, name, phone, phone_norm, is_primary)
        VALUES (${salesId('sct')}, ${orgId}, ${accountId}, ${body.contact_name || null},
                ${phone}, ${phoneNorm}, true)
      `
    }
  }

  // 3. Оценка ICP — из того, что прислал канал
  const icp = scoreIcp({
    ordersPerDay: body.orders_per_day,
    points: body.points,
    pos: body.pos,
    aggregators: body.aggregators,
    deliveryType: body.delivery_type,
    city,
    text: body.text,
  })
  let status = routeByBand(icp.band)

  // Живое обращение человека никогда не уходит в nurture автоматически:
  // написали в чат, позвонили, оставили заявку — разбирает сотрудник
  if (status === 'nurture' && ['inbound', 'referral'].includes(String(source.kind))) {
    status = 'new'
  }

  // 4. Маршрутизация: зелёный уходит сейлзу с наименьшей загрузкой
  // Если в системе-источнике у обращения уже есть ответственный — уважаем его,
  // иначе распределение перекинет лид на другого и сломает работу сейлза
  let assignedAgentId: string | null = body.owner_hint || null
  if (!assignedAgentId && status === 'assigned') {
    const [agent] = await sql`
      SELECT a.id
      FROM support_agents a
      LEFT JOIN sales_leads l
        ON l.assigned_agent_id = a.id AND l.first_touch_at IS NULL AND l.status = 'assigned'
      WHERE a.telegram_id IS NOT NULL AND a.merged_into IS NULL
        AND (a.org_id = ${orgId} OR a.org_id IS NULL)
        AND (LOWER(COALESCE(a.role, '')) IN ('sales', 'sales_rep', 'ae', 'sdr', 'sales_lead')
             OR LOWER(COALESCE(a.department, '')) LIKE '%прода%')
      GROUP BY a.id
      ORDER BY COUNT(l.id) ASC, a.id ASC
      LIMIT 1
    `
    assignedAgentId = agent?.id || null
  }

  const leadId = salesId('sl')
  const slaMinutes = status === 'nurture' ? null : FIRST_TOUCH_SLA_MIN
  const finalStatus = assignedAgentId ? 'assigned' : status === 'assigned' ? 'new' : status

  const [lead] = await sql`
    INSERT INTO sales_leads (
      id, org_id, source_id, external_id, account_id, name, phone, phone_norm,
      contact_name, city, market_id, campaign, form_id, ad_id, text, raw,
      icp_score, icp_reasons, status, assigned_agent_id, assigned_at, sla_due_at
    ) VALUES (
      ${leadId}, ${orgId}, ${source.id}, ${externalId}, ${accountId}, ${name}, ${phone}, ${phoneNorm},
      ${body.contact_name || null}, ${city}, ${marketId}, ${body.campaign || null}, ${body.form_id || null},
      ${body.ad_id || null}, ${body.text || null}, ${JSON.stringify(body.raw ?? body)}::jsonb,
      ${icp.score}, ${JSON.stringify(icp.reasons)}::jsonb, ${finalStatus},
      ${assignedAgentId}, ${assignedAgentId ? new Date().toISOString() : null},
      ${slaMinutes ? new Date(Date.now() + slaMinutes * 60_000).toISOString() : null}
    )
    RETURNING *
  `

  // 5. Уведомление сейлзу — падение Telegram не должно ронять приём лида
  if (assignedAgentId) {
    try {
      await notifyLeadAssigned(sql, lead, source.label)
    } catch (e) {
      console.error('[sales/intake] notify failed:', e)
    }
  }

  return {
    ok: true,
    lead_id: leadId,
    account_id: accountId,
    deduped: false,
    merged_account: merged,
    icp: icp.score,
    band: icp.band,
    status: finalStatus,
    assigned_agent_id: assignedAgentId,
  }
}

/** Запись сообщения диалога в историю лида и аккаунта. */
export async function logChatMessage(
  sql: SQL, orgId: string, accountId: string,
  direction: 'in' | 'out', text: string, author: string
): Promise<void> {
  await sql`
    INSERT INTO sales_activities (id, org_id, account_id, type, direction, result, text)
    VALUES (${salesId('sac')}, ${orgId}, ${accountId}, 'message', ${direction}, ${author}, ${text})
  `
}
