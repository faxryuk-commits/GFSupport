import { sendNotification } from './notifications.js'
import { logEvent } from './system-journal.js'

/**
 * Надзор за «зависло на клиенте».
 *
 * Задача в статусе «Ждём данные · клиент» умеет висеть неделями: клиент
 * молчит, сотрудник забыл напомнить. Крон ловит пороги (2, 4, 7 дней) и
 * шлёт ответственному адресное уведомление по лестнице (система → бот)
 * с готовым текстом напоминания. Наружу, в группу клиента, — по-прежнему
 * рукой сотрудника: кнопка «Требования» в карточке бренда.
 */
export async function notifyClientStuck(sql: any, orgId: string): Promise<number> {
  const stuck = await sql`
    SELECT t.id, t.status_since, tt.label AS step, o.label AS opt,
           b.id AS brand_id, b.name AS brand, b.channel_id,
           COALESCE(t.assignee_id, b.assignee_id, tt.owner_agent_id) AS notify_agent,
           FLOOR(EXTRACT(EPOCH FROM (NOW() - t.status_since)) / 86400)::int AS days
    FROM onboarding_tasks t
    JOIN onboarding_task_types tt ON tt.id = t.task_type_id
    JOIN onboarding_brands b ON b.id = t.brand_id AND b.archived_at IS NULL
    JOIN onboarding_statuses s ON s.id = t.status_id AND s.kind = 'waiting'
    WHERE t.org_id = ${orgId} AND t.waiting_on = 'client'
      AND t.status_since < NOW() - INTERVAL '2 days'
    LIMIT 20
  ` as any[]

  let sent = 0
  for (const t of stuck) {
    if (!t.notify_agent) continue
    // не чаще раза в двое суток на задачу: жёсткие пороги «ровно 2/4/7 дней»
    // пропускали уже зависшее (13 дней — между порогами, тишина до 14-го)
    const [dup] = await sql`
      SELECT id FROM support_notifications
      WHERE org_id = ${orgId} AND decision_id = ${t.id}
        AND created_at > NOW() - INTERVAL '44 hours' LIMIT 1
    ` as any[]
    if (dup) continue

    const stepLabel = t.opt ? `${t.step} · ${t.opt}` : t.step
    await sendNotification({
      orgId, type: 'sla_breach', priority: t.days >= 7 ? 'high' : 'medium',
      title: `Клиент молчит ${t.days} дн: ${stepLabel} · ${t.brand}`,
      body: `Шаг «${stepLabel}» бренда «${t.brand}» ждёт данных от клиента уже ${t.days} дн. `
        + (t.channel_id
          ? 'Откройте карточку бренда — кнопка «Требования» соберёт напоминание для группы клиента.'
          : 'У бренда не привязана группа клиента — привяжите канал в карточке.'),
      decisionId: t.id,
      targetAgentIds: [t.notify_agent],
    })
    await logEvent(sql, 'Надзор клиента', 'зависло на клиенте',
      `${t.brand}: «${stepLabel}» без данных ${t.days} дн — напомнили ответственному`, t.brand_id)
    sent++
  }
  return sent
}

/**
 * Автопривязка группы клиента: у нового бренда ищем канал саппорта с тем же
 * названием (бренд «Chopar» ↔ группа «Chopar x Delever»). Только пустой
 * channel_id, только уверенное совпадение по нормализованному имени.
 */
export async function autoLinkBrandChannel(sql: any, orgId: string, brandId: string, brandName: string): Promise<string | null> {
  try {
    const norm = brandName.toLowerCase().replace(/[^a-zа-яё0-9ʼ']/gi, '')
    if (norm.length < 4) return null
    const chans = await sql`
      SELECT id, name FROM support_channels
      WHERE org_id = ${orgId} AND is_active = true AND COALESCE(type, '') <> 'feed'
    ` as any[]
    const hit = (chans as any[]).find((c: any) =>
      String(c.name || '').toLowerCase().replace(/[^a-zа-яё0-9ʼ']/gi, '').includes(norm))
    if (!hit) return null
    await sql`UPDATE onboarding_brands SET channel_id = ${hit.id}
      WHERE id = ${brandId} AND org_id = ${orgId} AND channel_id IS NULL`
    await logEvent(sql, 'Регионовед', 'группа привязана',
      `${brandName} ↔ «${String(hit.name).slice(0, 60)}»: совпадение названий`, brandId)
    return hit.id
  } catch {
    return null
  }
}
