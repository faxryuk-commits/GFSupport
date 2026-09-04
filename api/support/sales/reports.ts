import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { resolveRegionScoped } from '../_lib/sales-amo.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Отчёты продаж. Пять штук, больше на старте не нужно:
 * воронка по когорте, деньги в воронке, источники, портрет покупателя, команда.
 *
 * GET ?from=2026-05-01&to=2026-08-31&market=
 *
 * Финансовых метрик здесь нет: «деньги в воронке» — это суммы предложений и
 * взвешенный прогноз, то есть обещания. Факт выручки живёт в админке и план-факте.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  // По умолчанию — 90 дней: короче окно не даёт статистики по закрытым сделкам
  const from = url.searchParams.get('from') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  // Регион из переключателя в шапке: пусто — сводка по всем рынкам
  const market = await resolveRegionScoped(sql, orgId, url, ctx)
  const pipeline = market ? `sales_${market}` : 'sales'
  const fromTs = `${from}T00:00:00+05:00`
  const toTs = `${to}T23:59:59+05:00`

  // Прошлый период той же длины — чтобы цифра отвечала на «лучше или хуже»,
  // а не висела в воздухе
  const days = Math.max(1, Math.round(
    (new Date(toTs).getTime() - new Date(fromTs).getTime()) / 86400000))
  const prevFrom = new Date(new Date(fromTs).getTime() - days * 86400000).toISOString()
  const prevTo = fromTs

  // ─── Пульс продаж: главный экран отчётов одним заходом ────────────────────
  // KPI периода, воронка с долями источников, потенциал, тренд, источники,
  // причины потерь, портфель по сейлзам. Периоды: закрытия и воронка — по
  // выбранному диапазону, потенциал и портфель — состояние на сейчас
  if (url.searchParams.get('action') === 'pulse') {
    const [kpi, openNow, reach, wonSrc, potential, monthly, srcRows, losses, portfolio] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
          COUNT(*) FILTER (WHERE lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost,
          COALESCE(SUM(monthly_amount) FILTER (WHERE currency = 'UZS'
            AND won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0)::bigint AS won_amt,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (won_at - created_at)) / 86400)
            FILTER (WHERE won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0)::int AS cycle_med
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND pipeline <> 'partner'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
      `,
      sql`
        SELECT COUNT(*)::int AS open,
          COUNT(*) FILTER (WHERE COALESCE(monthly_amount, 0) > 0)::int AS with_amt
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND won_at IS NULL AND lost_at IS NULL
          AND pipeline <> 'partner'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
      `,
      // Воронка достижения этапов за период + доля источников (стек)
      sql`
        SELECT sn.key AS stage, COALESCE(ss.label, 'История Amo') AS src,
               COUNT(DISTINCT e.deal_id)::int AS n
        FROM sales_deal_events e
        JOIN sales_stages sn ON sn.id = e.new_stage_id
        JOIN sales_deals d ON d.id = e.deal_id
        LEFT JOIN sales_leads l ON l.id = d.source_lead_id
        LEFT JOIN sales_sources ss ON ss.id = l.source_id
        WHERE e.org_id = ${orgId} AND sn.pipeline LIKE 'sales%' AND sn.kind = 'open'
          AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND d.archived_at IS NULL
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1, 2
      `,
      // Выигрыш — по факту won_at, не по событиям: событие могло откатиться,
      // сделка — уехать в архив, и воронка расходилась с KPI
      sql`
        SELECT 'won' AS stage, COALESCE(ss.label, 'История Amo') AS src, COUNT(*)::int AS n
        FROM sales_deals d
        LEFT JOIN sales_leads l ON l.id = d.source_lead_id
        LEFT JOIN sales_sources ss ON ss.id = l.source_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1, 2
      `,
      sql`
        SELECT s.key, MIN(s.label) AS label, MIN(s.sort_order) AS sort, MIN(s.probability) AS prob,
               COUNT(d.id)::int AS cnt,
               COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.currency = 'UZS'), 0)::bigint AS amt
        FROM sales_stages s
        LEFT JOIN sales_deals d ON d.stage_id = s.id
          AND d.archived_at IS NULL AND d.won_at IS NULL AND d.lost_at IS NULL
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        WHERE s.org_id = ${orgId} AND s.kind = 'open' AND s.is_active = true
          AND s.pipeline LIKE 'sales%'
        GROUP BY s.key ORDER BY MIN(s.sort_order)
      `,
      sql`
        SELECT to_char(won_at, 'YYYY-MM') AS mon, COUNT(*)::int AS n,
               COALESCE(SUM(monthly_amount) FILTER (WHERE currency = 'UZS'), 0)::bigint AS amt
        FROM sales_deals
        WHERE org_id = ${orgId} AND archived_at IS NULL AND pipeline <> 'partner'
          AND won_at > NOW() - INTERVAL '12 months'
          AND (${market} = '' OR market_id = ${market} OR market_id IS NULL)
        GROUP BY 1 ORDER BY 1
      `,
      sql`
        SELECT COALESCE(s.label, 'прочее') AS src, COUNT(*)::int AS leads,
               COUNT(*) FILTER (WHERE l.status = 'converted')::int AS converted
        FROM sales_leads l
        LEFT JOIN sales_sources s ON s.id = l.source_id
        WHERE l.org_id = ${orgId}
          AND l.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR l.market_id = ${market} OR l.market_id IS NULL)
        GROUP BY 1 ORDER BY leads DESC LIMIT 8
      `,
      sql`
        SELECT COALESCE(lr.label, 'без причины') AS reason, COUNT(*)::int AS n
        FROM sales_deals d
        LEFT JOIN sales_lost_reasons lr ON lr.id = d.lost_reason_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1 ORDER BY n DESC LIMIT 8
      `,
      sql`
        SELECT ag.name, COUNT(*)::int AS cnt,
               COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.currency = 'UZS'), 0)::bigint AS amt,
               COUNT(*) FILTER (WHERE d.next_step_at IS NULL)::int AS no_step
        FROM sales_deals d
        JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND d.won_at IS NULL AND d.lost_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY ag.name ORDER BY cnt DESC LIMIT 10
      `,
    ]) as any[]

    const pot = (potential as any[]).map(p => ({
      ...p, weighted: Math.round(Number(p.amt) * Number(p.prob || 0) / 100),
    }))
    return json({
      period: { from, to, days },
      kpi: {
        ...(kpi as any[])[0],
        open: (openNow as any[])[0]?.open || 0,
        withAmount: (openNow as any[])[0]?.with_amt || 0,
        weighted: pot.reduce((s2, p) => s2 + p.weighted, 0),
      },
      reach: [...(reach as any[]), ...(wonSrc as any[])],
      potential: pot,
      monthly,
      sources: srcRows,
      losses,
      portfolio,
    })
  }

  // ─── Активность сотрудников: что человек делал за день ────────────────────
  //
  // Руководителю нужен не итог месяца, а рабочий день: сколько набрал, с кем
  // поговорил, что сдвинул по этапам, каких лидов забрал, что записал. Всё это
  // уже журналируется в четырёх местах — здесь оно сводится к одному человеку.
  //
  // Атрибуция разная по природе: у звонков сотрудник записан именем в detail
  // касания (АТС не знает наших id), у смен этапов — именем в changed_by, у
  // остального — честным agent_id. Поэтому сводим по имени.
  if (url.searchParams.get('action') === 'activity') {
    const [agents, callRows, stages, notes, presence, leadsTaken, tasksDone, dealsNew, feed] = await Promise.all([
      sql`
        SELECT id, name, role, department, pbx_ext FROM support_agents
        WHERE org_id = ${orgId} AND is_active = true AND merged_into IS NULL
      `,
      sql`
        SELECT title, detail, happened_at FROM sales_touchpoints
        WHERE org_id = ${orgId} AND kind = 'call'
          AND happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      `,
      sql`
        SELECT e.changed_by AS who, COUNT(*)::int AS moves,
               COUNT(*) FILTER (WHERE sn.kind = 'won')::int AS won,
               COUNT(*) FILTER (WHERE sn.kind = 'lost')::int AS lost
        FROM sales_deal_events e
        LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
        WHERE e.org_id = ${orgId}
          AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1
      `,
      sql`
        SELECT ag.name AS who, COUNT(*)::int AS n
        FROM sales_activities sa JOIN support_agents ag ON ag.id = sa.agent_id
        WHERE sa.org_id = ${orgId} AND sa.type <> 'message'
          AND sa.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1
      `,
      // Время в системе: сердцебиение вкладки раз в 45 секунд. Складываем
      // промежутки между соседними ударами и рвём сессию, если пауза больше
      // пяти минут — иначе «был в системе» включало бы ночь между закрытой
      // вечером вкладкой и открытой утром
      sql`
        WITH beats AS (
          SELECT agent_id, activity_at,
                 LAG(activity_at) OVER (PARTITION BY agent_id ORDER BY activity_at) AS prev
          FROM support_agent_activity
          WHERE activity_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        ), gaps AS (
          SELECT agent_id, activity_at,
            CASE WHEN prev IS NOT NULL AND activity_at - prev <= INTERVAL '5 minutes'
                 THEN EXTRACT(EPOCH FROM (activity_at - prev)) ELSE 0 END AS d
          FROM beats
        )
        SELECT ag.name AS who, SUM(g.d)::int AS sec,
               MIN(g.activity_at) AS first_at, MAX(g.activity_at) AS last_at
        FROM gaps g JOIN support_agents ag ON ag.id = g.agent_id
        WHERE ag.org_id = ${orgId} AND ag.merged_into IS NULL
        GROUP BY ag.name
      `,
      sql`
        SELECT ag.name AS who, COUNT(*)::int AS n
        FROM sales_leads l JOIN support_agents ag ON ag.id = l.assigned_agent_id
        WHERE l.org_id = ${orgId}
          AND l.assigned_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1
      `,
      sql`
        SELECT ag.name AS who, COUNT(*)::int AS n
        FROM sales_tasks t JOIN support_agents ag ON ag.id = t.assignee_agent_id
        WHERE t.org_id = ${orgId}
          AND t.done_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1
      `,
      sql`
        SELECT ag.name AS who, COUNT(*)::int AS n
        FROM sales_deals d JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.org_id = ${orgId}
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1
      `,
      // Лента: одно действие — одна строка, с «до → после» там, где оно есть
      sql`
        SELECT * FROM (
          SELECT e.changed_at AS at, e.changed_by AS who, 'deal' AS obj,
                 COALESCE(a.name, d.title) AS about, 'Смена этапа' AS event,
                 so.label AS before_val, sn.label AS after_val, d.id AS link
          FROM sales_deal_events e
          JOIN sales_deals d ON d.id = e.deal_id
          LEFT JOIN sales_accounts a ON a.id = d.account_id
          LEFT JOIN sales_stages so ON so.id = e.old_stage_id
          LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
          WHERE e.org_id = ${orgId}
            AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          SELECT sa.happened_at, ag.name, 'deal',
                 COALESCE(ac.name, d2.title, 'без карточки'),
                 CASE sa.type WHEN 'note' THEN 'Примечание'
                              WHEN 'approval' THEN 'Решение по скидке'
                              ELSE sa.type END,
                 NULL, LEFT(sa.text, 90), sa.deal_id
          FROM sales_activities sa
          LEFT JOIN support_agents ag ON ag.id = sa.agent_id
          LEFT JOIN sales_accounts ac ON ac.id = sa.account_id
          LEFT JOIN sales_deals d2 ON d2.id = sa.deal_id
          WHERE sa.org_id = ${orgId}
            AND sa.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          SELECT t.happened_at, NULL, 'call',
                 COALESCE(l.name, split_part(t.detail, '·', 1)),
                 t.title, NULL, t.detail, t.lead_id
          FROM sales_touchpoints t
          LEFT JOIN sales_leads l ON l.id = t.lead_id
          WHERE t.org_id = ${orgId} AND t.kind = 'call'
            AND t.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          SELECT tk.done_at, ag2.name, 'task', COALESCE(d3.title, l2.name, 'без карточки'),
                 'Задача выполнена', tk.title, COALESCE(tk.done_result, 'готово'), tk.deal_id
          FROM sales_tasks tk
          LEFT JOIN support_agents ag2 ON ag2.id = tk.assignee_agent_id
          LEFT JOIN sales_deals d3 ON d3.id = tk.deal_id
          LEFT JOIN sales_leads l2 ON l2.id = tk.lead_id
          WHERE tk.org_id = ${orgId} AND tk.done_at IS NOT NULL
            AND tk.done_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        ) x ORDER BY at DESC LIMIT 200
      `,
    ]) as any[]

    // Имя сотрудника у звонка: третий сегмент detail пишет синк; у старых
    // касаний его нет — тогда добавочный из профиля, а мобильная нога уже
    // содержит имя после «моб.»
    const extName = new Map<string, string>()
    for (const a of agents as any[]) {
      const ext = String(a.pbx_ext || '').replace(/\D/g, '')
      if (ext) extName.set(ext, a.name)
    }
    const callerOf = (detail: string): string => {
      const parts = String(detail || '').split('·').map(s => s.trim())
      if (parts[2]) return parts[2]
      const side = parts[1] || ''
      if (/^внутр\./.test(side)) return extName.get(side.replace(/\D/g, '')) || ''
      if (/^моб\./.test(side)) return side.replace(/^моб\.\s*/, '')
      return ''
    }

    interface Row {
      name: string; role: string | null
      callsIn: number; callsOut: number; answered: number; talkSec: number
      moves: number; won: number; lost: number
      notes: number; leads: number; tasks: number; deals: number
      presenceSec: number; firstAt: string | null; lastAt: string | null
    }
    const byName = new Map<string, Row>()
    const rowFor = (name: string): Row | null => {
      const key = String(name || '').trim()
      if (!key) return null
      if (!byName.has(key)) {
        const a = (agents as any[]).find(x => x.name === key)
        byName.set(key, {
          name: key, role: a?.role || null,
          callsIn: 0, callsOut: 0, answered: 0, talkSec: 0,
          moves: 0, won: 0, lost: 0, notes: 0, leads: 0, tasks: 0, deals: 0,
          presenceSec: 0, firstAt: null, lastAt: null,
        })
      }
      return byName.get(key)!
    }

    for (const c of callRows as any[]) {
      const who = callerOf(c.detail)
      const r = rowFor(who)
      if (!r) continue
      const title = String(c.title || '')
      const m = title.match(/(\d+) сек/)
      const talk = m ? Number(m[1]) : 0
      if (title.startsWith('Входящий')) r.callsIn++; else r.callsOut++
      if (talk > 0) { r.answered++; r.talkSec += talk }
    }
    // Автоматические авторы («синхронизация с Amo», «из обращения на доске»)
    // в таблицу людей не попадают: это не работа сотрудника
    const isHuman = (n: string) => (agents as any[]).some(a => a.name === n)
    for (const s of stages as any[]) {
      if (!isHuman(s.who)) continue
      const r = rowFor(s.who); if (!r) continue
      r.moves += s.moves; r.won += s.won; r.lost += s.lost
    }
    for (const n of notes as any[]) { const r = rowFor(n.who); if (r) r.notes += n.n }
    for (const l of leadsTaken as any[]) { const r = rowFor(l.who); if (r) r.leads += l.n }
    for (const t of tasksDone as any[]) { const r = rowFor(t.who); if (r) r.tasks += t.n }
    for (const d of dealsNew as any[]) { const r = rowFor(d.who); if (r) r.deals += d.n }
    // Присутствие — у всех, кто заходил: человек мог быть в системе и не
    // сделать ни одного действия, и это тоже факт для руководителя
    for (const p of presence as any[]) {
      const r = rowFor(p.who); if (!r) continue
      r.presenceSec = Number(p.sec) || 0
      r.firstAt = p.first_at; r.lastAt = p.last_at
    }

    const people = [...byName.values()]
      .map(r => ({ ...r, total: r.callsIn + r.callsOut + r.moves + r.notes + r.leads + r.tasks + r.deals }))
      .filter(r => r.total > 0 || r.presenceSec > 0)
      .sort((a, b) => b.total - a.total)

    // Лента: у звонка автор вычисляется из detail, у прочего он уже есть
    const events = (feed as any[]).map(e => ({
      at: e.at,
      who: e.obj === 'call' ? callerOf(e.after_val) : e.who,
      obj: e.obj,
      about: e.about,
      event: e.event,
      before: e.before_val,
      after: e.obj === 'call' ? null : e.after_val,
      link: e.link,
    })).filter(e => e.who || e.obj !== 'call')

    return json({
      period: { from, to, days },
      people,
      totals: {
        people: people.length,
        calls: people.reduce((s2, p) => s2 + p.callsIn + p.callsOut, 0),
        answered: people.reduce((s2, p) => s2 + p.answered, 0),
        talkSec: people.reduce((s2, p) => s2 + p.talkSec, 0),
        moves: people.reduce((s2, p) => s2 + p.moves, 0),
        presenceSec: people.reduce((s2, p) => s2 + p.presenceSec, 0),
        won: people.reduce((s2, p) => s2 + p.won, 0),
        actions: people.reduce((s2, p) => s2 + p.total, 0),
      },
      events,
    })
  }

  const [funnel, money, sources, icp, team, cohort, daily, prev, byRegion] = await Promise.all([
    // Воронка по когорте: сделки, СОЗДАННЫЕ в периоде, доведённые до конца.
    // Считать «прошёл этап» надо по журналу, иначе сделка, проскочившая этап,
    // выпадет из статистики
    sql`
      WITH scope AS (
        SELECT d.id FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      )
      SELECT s.key, s.label, s.sort_order,
             COUNT(DISTINCT e.deal_id)::int AS reached
      FROM sales_stages s
      LEFT JOIN sales_deal_events e ON e.new_stage_id = s.id AND e.deal_id IN (SELECT id FROM scope)
      WHERE s.org_id = ${orgId} AND s.pipeline = ${pipeline} AND s.is_active = true
      GROUP BY s.key, s.label, s.sort_order ORDER BY s.sort_order
    `,
    // Деньги в воронке: суммы предложений по этапам и взвешенный прогноз
    sql`
      SELECT s.key, s.label, s.probability, COUNT(d.id)::int AS deals,
             COALESCE(SUM(d.monthly_amount), 0) AS amount,
             COALESCE(SUM(d.monthly_amount * s.probability / 100.0), 0) AS weighted
      FROM sales_stages s
      LEFT JOIN sales_deals d ON d.stage_id = s.id AND d.won_at IS NULL AND d.lost_at IS NULL
        AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
      WHERE s.org_id = ${orgId} AND s.pipeline = ${pipeline} AND s.kind = 'open' AND s.is_active = true
      GROUP BY s.key, s.label, s.probability, s.sort_order ORDER BY s.sort_order
    `,
    // Источники: сколько лидов, сколько дошло до сделки и до победы
    sql`
      SELECT s.label, s.kind,
             COUNT(l.id)::int AS leads,
             COUNT(l.id) FILTER (WHERE l.status = 'converted')::int AS converted,
             COUNT(d.id) FILTER (WHERE d.won_at IS NOT NULL)::int AS won
      FROM sales_sources s
      LEFT JOIN sales_leads l ON l.source_id = s.id
        AND (${market} = '' OR l.market_id = ${market})
        AND l.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      LEFT JOIN sales_deals d ON d.source_lead_id = l.id
      WHERE s.org_id = ${orgId}
      GROUP BY s.label, s.kind HAVING COUNT(l.id) > 0
      ORDER BY leads DESC
    `,
    // Портрет покупателя: по POS — самый сильный признак покупки
    sql`
      SELECT COALESCE(NULLIF(d.pos, ''), 'не указан') AS value,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::int AS won
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND (d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)
        AND (${market} = '' OR d.market_id = ${market})
      GROUP BY 1 HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::float / COUNT(*) DESC
      LIMIT 12
    `,
    // Качество ведения: не количество звонков, а как ведут сделки
    sql`
      SELECT ag.name,
             COUNT(d.id)::int AS deals,
             COUNT(d.id) FILTER (WHERE d.won_at IS NOT NULL)::int AS won,
             COUNT(d.id) FILTER (WHERE d.lost_at IS NOT NULL)::int AS lost,
             COUNT(d.id) FILTER (WHERE d.next_step_at IS NULL
               AND d.won_at IS NULL AND d.lost_at IS NULL)::int AS no_next_step,
             COUNT(d.id) FILTER (WHERE d.pos IS NOT NULL AND d.pain IS NOT NULL)::int AS qualified,
             COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.won_at IS NOT NULL), 0) AS won_amount
      FROM sales_deals d
      JOIN support_agents ag ON ag.id = d.owner_agent_id
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
        AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      GROUP BY ag.name ORDER BY won DESC
    `,
    // Сколько выигранных дошло до первого заказа — метрика качества продаж,
    // а не финансов: подпись без запуска победой не считается
    sql`
      SELECT COUNT(*)::int AS won,
             COUNT(*) FILTER (WHERE a.first_order_at IS NOT NULL)::int AS launched,
             AVG(EXTRACT(EPOCH FROM (a.first_order_at - d.won_at)) / 86400)
               FILTER (WHERE a.first_order_at IS NOT NULL) AS avg_days
      FROM sales_deals d
      JOIN sales_accounts a ON a.id = d.account_id
      WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
        AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
    `,
    // Движение по дням: сколько заводили, выигрывали и теряли
    sql`
      SELECT day::date AS day,
             COUNT(*) FILTER (WHERE kind = 'created')::int AS created,
             COUNT(*) FILTER (WHERE kind = 'won')::int AS won,
             COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost,
             COALESCE(SUM(amount) FILTER (WHERE kind = 'won'), 0) AS won_amount
      FROM (
        SELECT (d.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent') AS day,
               'created' AS kind, 0::numeric AS amount
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
          AND (${market} = '' OR d.market_id = ${market})
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.won_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'), 'won',
               COALESCE(d.monthly_amount, 0)
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
          AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.lost_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'), 'lost', 0
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND (${market} = '' OR d.market_id = ${market})
          AND d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      ) t
      GROUP BY 1 ORDER BY 1
    `,
    // Тот же набор цифр за прошлый период
    sql`
      SELECT COUNT(*) FILTER (WHERE d.created_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS created,
             COUNT(*) FILTER (WHERE d.won_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS won,
             COUNT(*) FILTER (WHERE d.lost_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz)::int AS lost,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz), 0) AS won_amount,
             (SELECT COUNT(*)::int FROM sales_leads l WHERE l.org_id = ${orgId}
                AND (${market} = '' OR l.market_id = ${market})
                AND l.created_at BETWEEN ${prevFrom}::timestamptz AND ${prevTo}::timestamptz) AS leads
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (${market} = '' OR d.market_id = ${market})
    `,
    // Разрез по регионам: одна таблица вместо семи переключений фильтра
    sql`
      SELECT COALESCE(d.market_id, '—') AS market,
             COUNT(*) FILTER (WHERE d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL)::int AS open,
             COUNT(*) FILTER (WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
             COUNT(*) FILTER (WHERE d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0) AS won_amount,
             COALESCE(SUM(d.monthly_amount) FILTER (
               WHERE d.won_at IS NULL AND d.lost_at IS NULL AND d.archived_at IS NULL), 0) AS pipeline
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner' AND d.archived_at IS NULL
      GROUP BY 1 ORDER BY won DESC
    `,
  ])

  return json({
    period: { from, to, days }, market,
    daily, byRegion,
    prev: (prev as any[])[0] || {},
    funnel, money, sources, icp, team,
    launch: cohort[0] || {},
  })
}
