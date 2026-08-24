import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { getSQL, json } from '../lib/db.js'
import { ensureOnboardingSchema, obId, resolveAgentName, addParticipant } from '../lib/onboarding-schema.js'
import { inferBrandMarket } from '../lib/region-detect.js'
import { autoLinkBrandChannel } from '../lib/onboarding-alerts.js'

export const config = {
  runtime: 'edge',
}

/**
 * Заявка на подключение от продаж → готовый проект с ТЗ.
 *
 * POST {
 *   name, posId?, tariff?, launchDue?, assigneeId?, notes?,
 *   selections: { [taskTypeId]: optionId[] }   // выбранные поставщики по задачам
 * }
 *
 * Создаёт проект с чек-листом из шаблона POS; выбранные поставщики становятся
 * под-задачами, задачи с категориями без выбора — «Не требуется»; ТЗ пишется
 * первым комментарием; владельцы затронутых блоков получают мини-задачи.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureOnboardingSchema(sql, orgId)

  try {
    const body = await req.json()
    const { name, posId, tariff, launchDue, assigneeId, notes } = body
    const selections: Record<string, string[]> = body.selections || {}
    if (!name || !String(name).trim()) return json({ error: 'name is required' }, 400)

    const ctx = await extractAgentContext(req)
    const authorName = await resolveAgentName(sql, ctx.agentId)
    const assigneeName = assigneeId ? await resolveAgentName(sql, assigneeId) : null

    const brandId = obId('obbr')
    // Регион заявки: явный из тела → выбранный в шапке (market= в URL) →
    // вывод по инструментам ТЗ (все размеченные поставщики из одного региона)
    let intakeMarket = (body.marketId || new URL(req.url).searchParams.get('market') || '').trim() || null
    if (!intakeMarket) {
      intakeMarket = await inferBrandMarket(sql, orgId, Object.values(selections).flat() as string[])
    }

    // Тип подключения и связь апсейла: у клиента может быть несколько
    // подключений — апсейл ссылается на исходный бренд и наследует его регион
    const connectionType = ['delivery', 'aggregators', 'kiosk', 'upsell'].includes(body.connectionType)
      ? body.connectionType : null
    let parentBrandId: string | null = null
    let parentName: string | null = null
    let parentChannelId: string | null = null
    if (body.parentBrandId) {
      const [parent] = await sql`
        SELECT id, name, market_id FROM onboarding_brands
        WHERE id = ${body.parentBrandId} AND org_id = ${orgId} LIMIT 1
      ` as any[]
      if (parent) {
        parentBrandId = parent.id
        parentName = parent.name
        if (!intakeMarket && parent.market_id) intakeMarket = parent.market_id
      }
    } else if (body.channelId) {
      // апсейл давнему клиенту, у которого нет бренда в подключениях —
      // родителем выступает его канал из саппорта
      const [chan] = await sql`
        SELECT id, name, market_id FROM support_channels
        WHERE id = ${body.channelId} AND org_id = ${orgId} LIMIT 1
      ` as any[]
      if (chan) {
        parentChannelId = chan.id
        parentName = chan.name
        if (!intakeMarket && chan.market_id) intakeMarket = chan.market_id
      }
    }

    await sql`
      INSERT INTO onboarding_brands (id, org_id, name, pos_id, tariff, launch_due,
        assignee_id, assignee_name, notes, market_id, connection_type, parent_brand_id, channel_id)
      VALUES (${brandId}, ${orgId}, ${String(name).trim()}, ${posId || null},
        ${tariff || null}, ${launchDue || null}, ${assigneeId || null}, ${assigneeName},
        ${notes || null}, ${intakeMarket}, ${connectionType}, ${parentBrandId}, ${parentChannelId})
    `

    // Чек-лист из шаблона POS (или полный)
    const [todoStatus] = await sql`
      SELECT id FROM onboarding_statuses
      WHERE org_id = ${orgId} AND kind = 'todo' AND is_active = true
      ORDER BY sort_order LIMIT 1
    `
    const [naStatus] = await sql`
      SELECT id FROM onboarding_statuses
      WHERE org_id = ${orgId} AND kind = 'na' AND is_active = true
      ORDER BY sort_order LIMIT 1
    `
    let taskTypes = posId
      ? await sql`
          SELECT t.* FROM onboarding_task_types t
          JOIN onboarding_pos_task_map m ON m.task_type_id = t.id AND m.pos_id = ${posId}
          WHERE t.org_id = ${orgId} AND t.is_active = true
          ORDER BY t.sort_order
        `
      : await sql`
          SELECT * FROM onboarding_task_types
          WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order
        `
    // Свежедобавленная POS без строк в шаблоне — не «ноль задач», а полный
    // чек-лист: пустой проект хуже избыточного
    if (posId && (taskTypes as any[]).length === 0) {
      taskTypes = await sql`
        SELECT * FROM onboarding_task_types
        WHERE org_id = ${orgId} AND is_active = true ORDER BY sort_order
      `
    }

    const optionLabels: Record<string, string> = {}
    const allOptions = await sql`SELECT id, label FROM onboarding_options WHERE org_id = ${orgId}`
    for (const o of allOptions) optionLabels[o.id] = o.label

    const tzSelected: string[] = []
    const tzSkipped: string[] = []
    const touchedOwners = new Map<string, { name: string; labels: string[] }>()

    // Автозаявка из выигранной сделки приходит вовсе без selections: это не
    // «клиенту ничего не нужно», а «ТЗ ещё не снято» — блоки остаются
    // «Не начато», онбординг уточнит. «Не требуется» ставится только когда
    // человек осознанно пропустил блок в конструкторе
    const anySelections = Object.values(selections).some(v => (v || []).length > 0)

    for (const tt of taskTypes) {
      const selected = (selections[tt.id] || []).filter(oid => optionLabels[oid])
      if (tt.option_category_id && selected.length === 0 && anySelections) {
        // категория есть, но ничего не выбрано → «Не требуется»
        await sql`
          INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id)
          VALUES (${obId('obtk')}, ${orgId}, ${brandId}, ${tt.id}, ${naStatus?.id || todoStatus?.id || null})
          ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
        `
        tzSkipped.push(tt.label)
        continue
      }
      if (selected.length === 0) {
        await sql`
          INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id)
          VALUES (${obId('obtk')}, ${orgId}, ${brandId}, ${tt.id}, ${todoStatus?.id || null})
          ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
        `
      } else {
        for (const oid of selected) {
          await sql`
            INSERT INTO onboarding_tasks (id, org_id, brand_id, task_type_id, status_id, option_id)
            VALUES (${obId('obtk')}, ${orgId}, ${brandId}, ${tt.id}, ${todoStatus?.id || null}, ${oid})
            ON CONFLICT (brand_id, task_type_id, (COALESCE(option_id, ''))) DO NOTHING
          `
        }
        tzSelected.push(`${tt.label}: ${selected.map(oid => optionLabels[oid]).join(', ')}`)
        if (tt.owner_agent_id && tt.owner_name) {
          const own = touchedOwners.get(tt.owner_agent_id) || { name: tt.owner_name, labels: [] }
          own.labels.push(tt.label)
          touchedOwners.set(tt.owner_agent_id, own)
        }
      }
    }

    // Группа клиента: если родитель-канал не задан — ищем канал по имени бренда
    if (!parentChannelId) {
      await autoLinkBrandChannel(sql, orgId, brandId, String(name).trim())
    }

    // Выбранная POS — сразу в ячейку «POS-интеграция»: бренд знает свою POS,
    // ячейка матрицы не должна оставаться пустой
    if (posId) {
      await sql`
        UPDATE onboarding_tasks t SET option_id = o.id
        FROM onboarding_task_types tt
        JOIN onboarding_option_categories c ON c.id = tt.option_category_id AND c.label = 'POS'
        JOIN onboarding_options o ON o.category_id = c.id
          AND LOWER(o.label) = LOWER((SELECT name FROM onboarding_pos_systems WHERE id = ${posId}))
        WHERE t.brand_id = ${brandId} AND t.task_type_id = tt.id AND t.option_id IS NULL
      `.catch(() => {})
    }

    // ТЗ первым комментарием
    const [pos] = posId
      ? await sql`SELECT name FROM onboarding_pos_systems WHERE id = ${posId}`
      : [null as any]
    const TYPE_LABELS: Record<string, string> = {
      delivery: 'Своя доставка', aggregators: 'Только агрегаторы',
      kiosk: 'Киоски самообслуживания', upsell: 'Апсейл модулей',
    }
    const tz = [
      `📋 ТЗ на подключение (заявка от ${authorName || 'продаж'})`,
      connectionType ? `Тип: ${TYPE_LABELS[connectionType]}${parentName ? ` · апсейл к «${parentName}»` : ''}` : (parentName ? `Апсейл к «${parentName}»` : ''),
      `${pos?.name ? `POS: ${pos.name}` : 'POS: не выбрана'}${tariff ? ` · тариф: ${tariff}` : ''}${launchDue ? ` · запуск до ${launchDue}` : ''}`,
      ...tzSelected.map(l => `✅ ${l}`),
      tzSkipped.length ? `— не требуются: ${tzSkipped.join(', ')}` : '',
      notes ? `Комментарий: ${notes}` : '',
    ].filter(Boolean).join('\n')
    await sql`
      INSERT INTO onboarding_comments (id, org_id, brand_id, author_id, author_name, text)
      VALUES (${obId('obcm')}, ${orgId}, ${brandId}, ${ctx.agentId}, ${authorName}, ${tz})
    `

    // Участники: автор заявки + ведущий; мини-задачи владельцам затронутых блоков
    await addParticipant(sql, orgId, brandId, ctx.agentId, authorName)
    if (assigneeId) await addParticipant(sql, orgId, brandId, assigneeId, assigneeName)
    for (const [ownerId, own] of touchedOwners) {
      await sql`
        INSERT INTO onboarding_todos (id, org_id, brand_id, text, assignee_id, assignee_name, created_by)
        VALUES (${obId('obtd')}, ${orgId}, ${brandId},
          ${`Новая заявка «${String(name).trim()}»: ${own.labels.join(', ')}`},
          ${ownerId}, ${own.name}, ${authorName})
      `
      await addParticipant(sql, orgId, brandId, ownerId, own.name)
    }

    return json({ success: true, id: brandId })
  } catch (e: any) {
    return json({ error: 'Failed to create intake', details: e?.message }, 500)
  }
}
