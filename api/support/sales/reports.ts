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

  const days = Math.max(1, Math.round(
    (new Date(toTs).getTime() - new Date(fromTs).getTime()) / 86400000))

  // ─── Поток: от канала до выигрыша ───────────────────────────────────────
  if (url.searchParams.get('action') === 'flow') {
    const { salesFlow } = await import('../_lib/sales-flow.js')
    const exclude = (url.searchParams.get('exclude') || '').split(',').map(s => s.trim()).filter(Boolean)
    const owner = url.searchParams.get('owner') || ''
    const data = await salesFlow(sql, orgId, { fromTs, toTs, market, owner, exclude })
    return json({ period: { from, to }, market, ...data })
  }

  // ─── Команда: ценность сотрудников — результат и как он получен ──────────
  if (url.searchParams.get('action') === 'team_value') {
    const { teamValue } = await import('../_lib/team-value.js')
    return json({ market, ...(await teamValue(sql, orgId, { from, to, market })) })
  }

  // ─── Реклама по сотрудникам: чьи лиды с Meta и что стало с деньгами ───────
  if (url.searchParams.get('action') === 'ads') {
    const { adsByAgent } = await import('../_lib/ads-by-agent.js')
    const data = await adsByAgent(sql, orgId, { fromTs, toTs, market })
    return json({ period: { from, to }, ...data })
  }

  // ─── Пульс продаж: итоги периода и деньги ─────────────────────────────────
  // KPI периода, потенциал, подписка и оплаты по месяцам. Закрытия — по
  // выбранному диапазону, потенциал и портфель — состояние на сейчас
  if (url.searchParams.get('action') === 'pulse') {
    // Только то, что читает SalesPulse: воронка, источники, потери и портфель
    // по сейлзам переехали в поток и «Команду», их запросы отсюда сняты
    const [kpi, openNow, potential, monthly, cash, cashMonthly] = await Promise.all([
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
      // Этапы enterprise-воронки сводятся к ступеням обычной: иначе 11 сделок,
      // переведённых в Enterprise, есть в «открытом портфеле», но нет в
      // потенциале, и сумма по этапам не сходится с портфелем
      sql`
        SELECT b.bucket AS key,
               COALESCE(MIN(s.label) FILTER (WHERE s.pipeline LIKE 'sales%'), MIN(s.label)) AS label,
               COALESCE(MIN(s.sort_order) FILTER (WHERE s.pipeline LIKE 'sales%'), MIN(s.sort_order)) AS sort,
               COALESCE(MAX(s.probability) FILTER (WHERE s.pipeline LIKE 'sales%'), MAX(s.probability)) AS prob,
               COUNT(d.id)::int AS cnt,
               COALESCE(SUM(d.monthly_amount) FILTER (WHERE d.currency = 'UZS'), 0)::bigint AS amt
        FROM sales_stages s
        CROSS JOIN LATERAL (SELECT CASE s.key
          WHEN 'research' THEN 'qualified' WHEN 'discovery' THEN 'demo'
          WHEN 'proposal' THEN 'kp' WHEN 'pilot' THEN 'contract' ELSE s.key END AS bucket) b
        LEFT JOIN sales_deals d ON d.stage_id = s.id
          AND d.archived_at IS NULL AND d.won_at IS NULL AND d.lost_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        WHERE s.org_id = ${orgId} AND s.kind = 'open' AND s.is_active = true
          AND s.pipeline <> 'partner'
        GROUP BY b.bucket ORDER BY 3
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
      // Получено денег — факт из sales_payments (ручные и ПланФакт), в отличие
      // от подписки выигранных, которая пока обещание. Делится надвое: по
      // сделкам, выигранным в периоде, и по прежним — продления Zahratun
      // за 23 млн (сделка октября 2025) не заслуга продаж этого месяца,
      // и вместе они давали «120 млн» там, где новых оплат было 72
      sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::bigint AS amt,
               COUNT(*) FILTER (WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS n_new,
               COALESCE(SUM(p.amount) FILTER (WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz), 0)::bigint AS amt_new
        FROM sales_payments p
        LEFT JOIN sales_deals d ON d.id = p.deal_id
        WHERE p.org_id = ${orgId}
          AND p.paid_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
      `,
      sql`
        SELECT to_char(p.paid_at, 'YYYY-MM') AS mon, COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::bigint AS amt,
               COALESCE(SUM(p.amount) FILTER (WHERE to_char(d.won_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') = to_char(p.paid_at, 'YYYY-MM')), 0)::bigint AS amt_new
        FROM sales_payments p
        LEFT JOIN sales_deals d ON d.id = p.deal_id
        WHERE p.org_id = ${orgId} AND p.paid_at > NOW() - INTERVAL '12 months'
          AND (${market} = '' OR d.market_id = ${market} OR d.market_id IS NULL)
        GROUP BY 1 ORDER BY 1
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
        cash_n: (cash as any[])[0]?.n || 0,
        cash_amt: (cash as any[])[0]?.amt || 0,
        cash_n_new: (cash as any[])[0]?.n_new || 0,
        cash_amt_new: (cash as any[])[0]?.amt_new || 0,
      },
      potential: pot,
      monthly,
      cashMonthly,
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
    // Регион. Действие относится к региону по своему объекту — сделке,
    // обращению, клиенту; у действия без объекта (звонок на незнакомый номер,
    // присутствие в системе) регион берётся по сотруднику. Раньше срез не
    // применялся вовсе: «Азербайджан» показывал всю компанию
    const [agents, agentMarkets, callRows, stages, notes, presence, leadsTaken, tasksDone, dealsNew, feed] = await Promise.all([
      sql`
        SELECT id, name, role, department, pbx_ext FROM support_agents
        WHERE org_id = ${orgId} AND is_active = true AND merged_into IS NULL
      `,
      sql`
        SELECT am.agent_id, MIN(m.code) AS code
        FROM support_agent_markets am JOIN support_markets m ON m.id = am.market_id
        GROUP BY am.agent_id
      `,
      sql`
        SELECT t.title, t.detail, t.happened_at,
               COALESCE(l.market_id, a.market_id) AS mkt
        FROM sales_touchpoints t
        LEFT JOIN sales_leads l ON l.id = t.lead_id
        LEFT JOIN sales_accounts a ON a.id = t.account_id
        WHERE t.org_id = ${orgId} AND t.kind = 'call'
          -- разговоры с коллегами — не работа с клиентами
          AND COALESCE(t.channel, 'phone') <> 'internal'
          AND t.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      `,
      sql`
        SELECT e.changed_by AS who, d.market_id AS mkt, COUNT(*)::int AS moves,
               COUNT(*) FILTER (WHERE sn.kind = 'won')::int AS won,
               COUNT(*) FILTER (WHERE sn.kind = 'lost')::int AS lost
        FROM sales_deal_events e
        JOIN sales_deals d ON d.id = e.deal_id
        LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
        WHERE e.org_id = ${orgId}
          AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1, 2
      `,
      sql`
        SELECT ag.name AS who, COALESCE(d.market_id, ac.market_id) AS mkt,
               COUNT(*) FILTER (WHERE sa.type <> 'message')::int AS n,
               -- Исходящие сообщения клиентам — отдельной колонкой: у команды
               -- в Amo это половина дня, а в «заметки» им не место
               COUNT(*) FILTER (WHERE sa.type = 'message' AND COALESCE(sa.direction, 'out') = 'out')::int AS msgs
        FROM sales_activities sa JOIN support_agents ag ON ag.id = sa.agent_id
        LEFT JOIN sales_deals d ON d.id = sa.deal_id
        LEFT JOIN sales_accounts ac ON ac.id = sa.account_id
        WHERE sa.org_id = ${orgId}
          AND sa.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1, 2
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
          -- только отдел продаж: это отчёт продаж, и поддержка с нулями по
          -- сделкам была бы шумом. Тот, кто сделал продажное действие,
          -- попадёт в таблицу и без этого условия
          AND ((ag.department ILIKE '%sale%' OR ag.department ILIKE '%прода%')
               OR ag.role IN ('cco', 'sales', 'sale', 'kam', 'sdr', 'sales_lead'))
        GROUP BY ag.name
      `,
      sql`
        SELECT ag.name AS who, l.market_id AS mkt, COUNT(*)::int AS n
        FROM sales_leads l JOIN support_agents ag ON ag.id = l.assigned_agent_id
        WHERE l.org_id = ${orgId}
          AND l.assigned_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1, 2
      `,
      sql`
        SELECT ag.name AS who, COALESCE(d.market_id, l.market_id, ac.market_id) AS mkt, COUNT(*)::int AS n
        FROM sales_tasks t JOIN support_agents ag ON ag.id = t.assignee_agent_id
        LEFT JOIN sales_deals d ON d.id = t.deal_id
        LEFT JOIN sales_leads l ON l.id = t.lead_id
        LEFT JOIN sales_accounts ac ON ac.id = t.account_id
        WHERE t.org_id = ${orgId}
          AND t.done_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1, 2
      `,
      sql`
        SELECT ag.name AS who, d.market_id AS mkt, COUNT(*)::int AS n
        FROM sales_deals d JOIN support_agents ag ON ag.id = d.owner_agent_id
        WHERE d.org_id = ${orgId}
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        GROUP BY 1, 2
      `,
      // Лента: одно действие — одна строка, с «до → после» там, где оно есть.
      // Без LIMIT: таблица «кто что делал» считает всё, и лента обязана
      // сходиться с ней — за 30 дней 200 строк обрезали половину
      sql`
        SELECT * FROM (
          SELECT e.changed_at AS at, e.changed_by AS who, 'deal' AS obj,
                 COALESCE(a.name, d.title) AS about, 'Смена этапа' AS event,
                 so.label AS before_val, sn.label AS after_val, d.id AS link,
                 d.market_id AS mkt
          FROM sales_deal_events e
          JOIN sales_deals d ON d.id = e.deal_id
          LEFT JOIN sales_accounts a ON a.id = d.account_id
          LEFT JOIN sales_stages so ON so.id = e.old_stage_id
          LEFT JOIN sales_stages sn ON sn.id = e.new_stage_id
          WHERE e.org_id = ${orgId}
            AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          -- Заметка — свой тип в ленте: по ней фильтруют отдельно от этапов
          SELECT sa.happened_at, ag.name, CASE WHEN sa.type = 'note' THEN 'note' ELSE 'deal' END,
                 COALESCE(ac.name, d2.title, 'без карточки'),
                 CASE sa.type WHEN 'note' THEN 'Примечание'
                              WHEN 'approval' THEN 'Решение по скидке'
                              WHEN 'message' THEN 'Сообщение клиенту'
                              WHEN 'call' THEN 'Звонок'
                              ELSE sa.type END,
                 NULL, LEFT(sa.text, 90), sa.deal_id,
                 COALESCE(d2.market_id, ac.market_id)
          FROM sales_activities sa
          LEFT JOIN support_agents ag ON ag.id = sa.agent_id
          LEFT JOIN sales_accounts ac ON ac.id = sa.account_id
          LEFT JOIN sales_deals d2 ON d2.id = sa.deal_id
          WHERE sa.org_id = ${orgId}
            AND sa.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          SELECT t.happened_at, NULL, 'call',
                 COALESCE(l.name, split_part(t.detail, '·', 1)),
                 t.title, NULL, t.detail, t.lead_id,
                 COALESCE(l.market_id, ta.market_id)
          FROM sales_touchpoints t
          LEFT JOIN sales_leads l ON l.id = t.lead_id
          LEFT JOIN sales_accounts ta ON ta.id = t.account_id
          WHERE t.org_id = ${orgId} AND t.kind = 'call'
            AND COALESCE(t.channel, 'phone') <> 'internal'
            AND t.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          SELECT tk.done_at, ag2.name, 'task', COALESCE(d3.title, l2.name, 'без карточки'),
                 'Задача выполнена', tk.title, COALESCE(tk.done_result, 'готово'), tk.deal_id,
                 COALESCE(d3.market_id, l2.market_id)
          FROM sales_tasks tk
          LEFT JOIN support_agents ag2 ON ag2.id = tk.assignee_agent_id
          LEFT JOIN sales_deals d3 ON d3.id = tk.deal_id
          LEFT JOIN sales_leads l2 ON l2.id = tk.lead_id
          WHERE tk.org_id = ${orgId} AND tk.done_at IS NOT NULL
            AND tk.done_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          UNION ALL
          -- Взятые в работу обращения: в сводке они считались, а в ленте
          -- их не было — и «Лиды: 4» нельзя было развернуть в «какие»
          SELECT l3.assigned_at, ag3.name, 'lead', COALESCE(l3.contact_name, l3.name),
                 'Взял в работу', NULL, NULL, l3.id, l3.market_id
          FROM sales_leads l3
          JOIN support_agents ag3 ON ag3.id = l3.assigned_agent_id
          WHERE l3.org_id = ${orgId} AND l3.assigned_at IS NOT NULL
            AND l3.assigned_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        ) x ORDER BY at DESC LIMIT 2000
      `,
    ]) as any[]

    // Регион сотрудника — по привязке в «Команде»; у админов и непривязанных
    // региона нет, их действия попадают в срез только через объект
    const agentMkt = new Map<string, string>()
    for (const m of agentMarkets as any[]) agentMkt.set(String(m.agent_id), String(m.code || '').toLowerCase())
    const nameMkt = new Map<string, string>()
    for (const a of agents as any[]) {
      const code = agentMkt.get(String(a.id))
      if (code) nameMkt.set(String(a.name), code)
    }
    const inRegion = (mkt: unknown, who: unknown): boolean => {
      if (!market) return true
      const m = String(mkt || '').toLowerCase() || nameMkt.get(String(who || '').trim()) || ''
      return m === market
    }

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
      notes: number; messages: number; leads: number; tasks: number; deals: number
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
          moves: 0, won: 0, lost: 0, notes: 0, messages: 0, leads: 0, tasks: 0, deals: 0,
          presenceSec: 0, firstAt: null, lastAt: null,
        })
      }
      return byName.get(key)!
    }

    for (const c of callRows as any[]) {
      const who = callerOf(c.detail)
      if (!inRegion(c.mkt, who)) continue
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
      if (!isHuman(s.who) || !inRegion(s.mkt, s.who)) continue
      const r = rowFor(s.who); if (!r) continue
      r.moves += s.moves; r.won += s.won; r.lost += s.lost
    }
    for (const n of notes as any[]) {
      if (!inRegion(n.mkt, n.who)) continue
      const r = rowFor(n.who); if (!r) continue
      r.notes += n.n; r.messages += Number(n.msgs) || 0
    }
    for (const l of leadsTaken as any[]) { if (!inRegion(l.mkt, l.who)) continue; const r = rowFor(l.who); if (r) r.leads += l.n }
    for (const t of tasksDone as any[]) { if (!inRegion(t.mkt, t.who)) continue; const r = rowFor(t.who); if (r) r.tasks += t.n }
    for (const d of dealsNew as any[]) { if (!inRegion(d.mkt, d.who)) continue; const r = rowFor(d.who); if (r) r.deals += d.n }
    // Присутствие — у всех, кто заходил: человек мог быть в системе и не
    // сделать ни одного действия, и это тоже факт для руководителя.
    // Объекта у присутствия нет — только регион самого сотрудника
    for (const p of presence as any[]) {
      if (!inRegion(null, p.who)) continue
      const r = rowFor(p.who); if (!r) continue
      r.presenceSec = Number(p.sec) || 0
      r.firstAt = p.first_at; r.lastAt = p.last_at
    }

    const people = [...byName.values()]
      .map(r => ({ ...r, total: r.callsIn + r.callsOut + r.moves + r.notes + r.messages + r.leads + r.tasks + r.deals }))
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
      mkt: e.mkt,
    }))
      .filter(e => e.who || e.obj !== 'call')
      .filter(e => inRegion(e.mkt, e.who))
      .map(({ mkt: _m, ...e }) => e)

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

  const [icp, daily, byRegion] = await Promise.all([
    // Портрет покупателя: заказов в день и доставка — то, что предсказывает
    // покупку. По POS было 2 934 «не указан» из 3 400 — портрет не читался.
    // Значения «заказов в день» приводятся к корзинам на лету: в поле 70
    // разных написаний («10-15», «15+», «100», «йук»)
    sql`
      SELECT 'orders' AS dim,
             CASE WHEN d.orders_per_day IS NULL OR d.orders_per_day !~ '[0-9]' THEN 'не указано'
                  WHEN (regexp_match(d.orders_per_day, '([0-9]+)'))[1]::int = 0 THEN 'доставки нет'
                  WHEN (regexp_match(d.orders_per_day, '([0-9]+)'))[1]::int < 10 THEN 'до 10'
                  WHEN (regexp_match(d.orders_per_day, '([0-9]+)'))[1]::int < 30 THEN '10–30'
                  WHEN (regexp_match(d.orders_per_day, '([0-9]+)'))[1]::int < 100 THEN '30–100'
                  ELSE '100+' END AS value,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::int AS won
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)
        AND COALESCE(d.won_at, d.lost_at) BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND (${market} = '' OR d.market_id = ${market})
      GROUP BY 2
      UNION ALL
      -- Несколько способов через запятую — одна корзина, а не строка на сочетание
      SELECT 'delivery', CASE WHEN d.delivery_type LIKE '%,%' THEN 'несколько способов'
                              ELSE COALESCE(NULLIF(d.delivery_type, ''), 'не указано') END,
             COUNT(*)::int, COUNT(*) FILTER (WHERE d.won_at IS NOT NULL)::int
      FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL
        AND (d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)
        AND COALESCE(d.won_at, d.lost_at) BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND (${market} = '' OR d.market_id = ${market})
      GROUP BY 2
      ORDER BY 1, 3 DESC
    `,
    // Движение по дням: сколько заводили, выигрывали и теряли
    sql`
      SELECT day::date AS day,
             COUNT(*) FILTER (WHERE kind = 'created')::int AS created,
             COUNT(*) FILTER (WHERE kind = 'won')::int AS won,
             COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost,
             COALESCE(SUM(amount) FILTER (WHERE kind = 'won'), 0) AS won_amount
      -- sales_deals.* — timestamptz: конверсия ОДИНАРНАЯ. Двойная сдвигала
      -- день на −10 часов, и 25 выигрышей стояли на чужом дне. Фильтры те же,
      -- что у KPI: без архива и партнёрской воронки
      FROM (
        SELECT (d.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
               'created' AS kind, 0::numeric AS amount
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.won_at AT TIME ZONE 'Asia/Tashkent'), 'won',
               COALESCE(d.monthly_amount, 0)
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        UNION ALL
        SELECT (d.lost_at AT TIME ZONE 'Asia/Tashkent'), 'lost', 0
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND (${market} = '' OR d.market_id = ${market})
          AND d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      ) t
      GROUP BY 1 ORDER BY 1
    `,
    // Разрез по регионам: одна таблица вместо семи переключений фильтра.
    // Суммы — по валютам: у Казахстана тенге, у Баку манаты, складывать их
    // с сумами под одной подписью нельзя. Сначала группировка, потом суммы
    // по валютам к готовой строке — ссылка на d.market_id из подзапроса
    // сгруппированного SELECT падает «ungrouped column»
    sql`
      WITH m AS (
        SELECT COALESCE(d.market_id, '—') AS market,
               COUNT(*) FILTER (WHERE d.won_at IS NULL AND d.lost_at IS NULL)::int AS open,
               COUNT(*) FILTER (WHERE d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
               COUNT(*) FILTER (WHERE d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost
        FROM sales_deals d
        WHERE d.org_id = ${orgId} AND d.pipeline <> 'partner' AND d.archived_at IS NULL
        GROUP BY 1
      )
      SELECT m.market, m.open, m.won, m.lost,
             COALESCE((SELECT jsonb_object_agg(cur, amt) FROM (
               SELECT COALESCE(w.currency, 'UZS') AS cur, SUM(w.monthly_amount) AS amt
               FROM sales_deals w
               WHERE w.org_id = ${orgId} AND COALESCE(w.market_id, '—') = m.market
                 AND w.pipeline <> 'partner' AND w.archived_at IS NULL AND w.monthly_amount > 0
                 AND w.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
               GROUP BY 1) x), '{}'::jsonb) AS won_amounts,
             COALESCE((SELECT jsonb_object_agg(cur, amt) FROM (
               SELECT COALESCE(o.currency, 'UZS') AS cur, SUM(o.monthly_amount) AS amt
               FROM sales_deals o
               WHERE o.org_id = ${orgId} AND COALESCE(o.market_id, '—') = m.market
                 AND o.pipeline <> 'partner' AND o.archived_at IS NULL AND o.monthly_amount > 0
                 AND o.won_at IS NULL AND o.lost_at IS NULL
               GROUP BY 1) x), '{}'::jsonb) AS pipeline_amounts
      FROM m ORDER BY m.won DESC
    `,
  ])

  return json({ period: { from, to, days }, market, daily, byRegion, icp })
}
