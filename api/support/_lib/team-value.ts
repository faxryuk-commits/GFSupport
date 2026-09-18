/**
 * Ценность сотрудников: результат и как он получен.
 *
 * Пять осей, но две группы. Результат (выиграно, деньги) — за что платим.
 * Действия, чистота карточек и ритм — почему результат такой и каким будет
 * в следующем месяце. Сводного балла нет намеренно: как только пять цифр
 * складываются в одну, команда начинает растить ту, что легче всего
 * накрутить, — заметки. Поэтому в «действия с клиентом» входят только
 * факты, которых не сделать в один клик: разговоры от 30 секунд по АТС,
 * исходящие сообщения из CRM, проведённые встречи. Заметки считаются
 * отдельно и в бары не попадают.
 *
 * Чистота — пять проверок по открытым сделкам, каждая да/нет:
 * есть следующий шаг · заполнена квалификация · на КП и дальше указана
 * сумма · проигрыш с причиной, не «Другое» · не стоит 14+ дней.
 *
 * Чего не видим: АТС и мессенджеры CRM подключены только в Ташкенте —
 * у Алматы и Баку «с клиентом» всегда 0, и это надо писать рядом с нулём,
 * а не делать вид, что они не работают.
 */

const TZ = 'Asia/Tashkent'
const CRM_CUTOVER = '2026-09-02'

/** Курс к суму — только для сортировки, в подписях валюты не смешиваются. */
const TO_UZS: Record<string, number> = { UZS: 1, USD: 12700, KZT: 24, AZN: 7470, RUB: 150, EUR: 14800 }

export interface Signal { tone: 'good' | 'warn' | 'bad' | 'info'; text: string }

export interface Person {
  agentId: string
  name: string
  role: string | null
  market: string | null
  /** Дата появления в системе, если внутри периода — «с 14 сентября». */
  since: string | null
  result: {
    won: number; lost: number; closed: number; conv: number | null
    created: number; advanced: number; open: number
    wonAmounts: Record<string, number>; wonUzs: number
    /** Получено денег по сделкам, выигранным в периоде (как в KPI «Продаж»). */
    cash: number; cashN: number
  }
  touch: { calls: number; answered: number; talkSec: number; msgs: number; meetings: number; total: number; visible: boolean }
  crm: { moves: number; tasks: number; notes: number; total: number }
  clean: {
    open: number; withStep: number; qualified: number; late: number; lateAmt: number
    lost: number; lostReasoned: number; stale14: number
    checks: Array<{ key: string; label: string; pass: number; of: number; ratio: number | null }>
    score: number | null
  }
  rhythm: { activeDays: number; workDays: number; weekendDays: number; longestGap: number; lastActive: string | null; days: Record<string, number> }
  /**
   * Конверсия по этапам: сделки, заведённые в периоде, и сколько дошло до
   * каждой ступени — Квалифицирован, Демо, КП, Договор, Выиграно (индексы
   * 1..5; [0] — всего). Ступень — самая дальняя по журналу этапов или текущая;
   * выигранная прошла все, как в потоке.
   */
  stages: { reached: number[]; weakest: { step: number; rate: number; team: number } | null }
  signals: Signal[]
}

function tzDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}

function workDaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00+05:00`)
  const end = new Date(`${to}T00:00:00+05:00`)
  while (d <= end) {
    const wd = new Date(d.toLocaleString('en-US', { timeZone: TZ })).getDay()
    if (wd !== 0 && wd !== 6) out.push(tzDate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function isWeekend(day: string): boolean {
  const wd = new Date(`${day}T12:00:00+05:00`).getDay()
  return wd === 0 || wd === 6
}

const fmtDay = (iso: string) => {
  const [, m, d] = iso.split('-')
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`
}

export async function teamValue(sql: any, orgId: string, o: { from: string; to: string; market: string }) {
  const fromTs = `${o.from}T00:00:00+05:00`
  const toTs = `${o.to}T23:59:59+05:00`
  const market = o.market || ''

  const [agents, calls, acts, moves, tasks, deals, orphan, reached, cash] = await Promise.all([
    // Продавцы: отдел продаж плюс все, у кого есть сделки в периоде или в работе
    sql`
      SELECT ag.id, ag.name, ag.role, ag.pbx_ext, ag.created_at,
             -- Рынок — где у человека сделки; у CCO с двумя рынками профиль
             -- давал первый по алфавиту, и Ташкент уезжал в Казахстан
             COALESCE(
               (SELECT d.market_id FROM sales_deals d
                 WHERE d.owner_agent_id = ag.id AND d.org_id = ${orgId} AND d.archived_at IS NULL
                   AND d.market_id IS NOT NULL
                   AND (d.won_at IS NULL AND d.lost_at IS NULL
                        OR d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
                        OR d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
                        OR d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)
                 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1),
               (SELECT MIN(m.code) FROM support_agent_markets am JOIN support_markets m ON m.id = am.market_id
                 WHERE am.agent_id = ag.id)) AS market,
             (SELECT string_agg(m.code, ',') FROM support_agent_markets am JOIN support_markets m ON m.id = am.market_id
               WHERE am.agent_id = ag.id) AS markets
      FROM support_agents ag
      WHERE ag.org_id = ${orgId} AND COALESCE(ag.is_active, true) AND ag.merged_into IS NULL
        AND ((ag.department ILIKE '%sale%' OR ag.department ILIKE '%прода%')
             OR ag.role IN ('cco', 'sales', 'sale', 'kam', 'sdr', 'sales_lead')
             OR EXISTS (SELECT 1 FROM sales_deals d WHERE d.owner_agent_id = ag.id AND d.org_id = ${orgId}
                          AND d.archived_at IS NULL AND d.pipeline <> 'partner'
                          AND (d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
                               OR d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
                               OR d.lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
                               OR (d.won_at IS NULL AND d.lost_at IS NULL))))
    `,
    // Звонки: happened_at наивный UTC — для ташкентской даты двойная конверсия
    sql`
      SELECT t.title, t.detail,
             (t.happened_at AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date::text AS day,
             COALESCE(l.market_id, a.market_id) AS mkt
      FROM sales_touchpoints t
      LEFT JOIN sales_leads l ON l.id = t.lead_id
      LEFT JOIN sales_accounts a ON a.id = t.account_id
      WHERE t.org_id = ${orgId} AND t.kind = 'call' AND COALESCE(t.channel, 'phone') <> 'internal'
        AND t.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
    `,
    sql`
      SELECT sa.agent_id, (sa.happened_at AT TIME ZONE ${TZ})::date::text AS day,
             COALESCE(d.market_id, ac.market_id) AS mkt,
             COUNT(*) FILTER (WHERE sa.type = 'message' AND COALESCE(sa.direction, 'out') = 'out')::int AS msgs,
             COUNT(*) FILTER (WHERE sa.type <> 'message')::int AS notes
      FROM sales_activities sa
      LEFT JOIN sales_deals d ON d.id = sa.deal_id
      LEFT JOIN sales_accounts ac ON ac.id = sa.account_id
      WHERE sa.org_id = ${orgId} AND sa.agent_id IS NOT NULL
        AND sa.happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      GROUP BY 1, 2, 3
    `,
    sql`
      SELECT e.changed_by AS who, (e.changed_at AT TIME ZONE ${TZ})::date::text AS day,
             d.market_id AS mkt, COUNT(*)::int AS n
      FROM sales_deal_events e JOIN sales_deals d ON d.id = e.deal_id
      WHERE e.org_id = ${orgId}
        AND e.changed_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      GROUP BY 1, 2, 3
    `,
    sql`
      SELECT t.assignee_agent_id AS agent_id, (t.done_at AT TIME ZONE ${TZ})::date::text AS day,
             COALESCE(d.market_id, l.market_id) AS mkt,
             COUNT(*)::int AS n, COUNT(*) FILTER (WHERE t.kind = 'meeting')::int AS meetings
      FROM sales_tasks t
      LEFT JOIN sales_deals d ON d.id = t.deal_id
      LEFT JOIN sales_leads l ON l.id = t.lead_id
      WHERE t.org_id = ${orgId} AND t.done_at IS NOT NULL AND t.assignee_agent_id IS NOT NULL
        AND t.done_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
      GROUP BY 1, 2, 3
    `,
    // Сделки по владельцу: результат за период и чистота открытых на сейчас.
    // «Продвинул» — созданная в периоде дошла до демо и дальше (по событиям
    // этапов, по текущему этапу или выиграна): для SDR это и есть результат
    sql`
      WITH mine AS (
        SELECT d.*, s.key AS skey
        FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND d.owner_agent_id IS NOT NULL
          AND (${market} = '' OR d.market_id = ${market})
      )
      SELECT owner_agent_id AS agent_id,
        COUNT(*) FILTER (WHERE created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS created,
        COUNT(*) FILTER (WHERE won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS won,
        COUNT(*) FILTER (WHERE lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz)::int AS lost,
        COUNT(*) FILTER (WHERE created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (won_at IS NOT NULL
               OR skey IN ('meeting', 'demo', 'discovery', 'kp', 'proposal', 'contract', 'pilot')
               OR EXISTS (SELECT 1 FROM sales_deal_events e JOIN sales_stages st ON st.id = e.new_stage_id
                          WHERE e.deal_id = mine.id
                            AND st.key IN ('meeting', 'demo', 'discovery', 'kp', 'proposal', 'contract', 'pilot'))))::int AS advanced,
        COALESCE((SELECT jsonb_object_agg(cur, amt) FROM (
          SELECT COALESCE(w.currency, 'UZS') AS cur, SUM(w.monthly_amount) AS amt FROM mine w
          WHERE w.owner_agent_id = mine.owner_agent_id AND w.monthly_amount > 0
            AND w.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          GROUP BY 1) x), '{}'::jsonb) AS won_amounts,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL)::int AS open,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL AND next_step_at IS NOT NULL)::int AS with_step,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL
          AND NULLIF(pos, '') IS NOT NULL AND NULLIF(pain, '') IS NOT NULL
          AND NULLIF(orders_per_day, '') IS NOT NULL AND NULLIF(delivery_type, '') IS NOT NULL)::int AS qualified,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL
          AND skey IN ('kp', 'proposal', 'contract', 'pilot'))::int AS late,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL
          AND skey IN ('kp', 'proposal', 'contract', 'pilot') AND monthly_amount > 0)::int AS late_amt,
        COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL
          AND updated_at < NOW() - INTERVAL '14 days')::int AS stale14,
        COUNT(*) FILTER (WHERE lost_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND lost_reason_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM sales_lost_reasons r WHERE r.id = mine.lost_reason_id AND r.label <> 'Другое'))::int AS lost_reasoned
      FROM mine
      GROUP BY 1
    `,
    // Выигранные без владельца: в KPI «Продаж» они есть, у людей — нет,
    // и разница должна быть подписана, а не выглядеть ошибкой
    sql`
      SELECT COUNT(*)::int AS n FROM sales_deals d
      WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
        AND d.owner_agent_id IS NULL
        AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND (${market} = '' OR d.market_id = ${market})
    `,
    // Ступени по сделкам периода: те же корзины, что в потоке
    sql`
      WITH mine AS (
        SELECT d.id, d.owner_agent_id, d.won_at,
               CASE s.key WHEN 'qualified' THEN 1 WHEN 'research' THEN 1
                 WHEN 'meeting' THEN 2 WHEN 'demo' THEN 2 WHEN 'discovery' THEN 2
                 WHEN 'kp' THEN 3 WHEN 'proposal' THEN 3
                 WHEN 'contract' THEN 4 WHEN 'pilot' THEN 4 ELSE 0 END AS cur
        FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id
        WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
          AND d.owner_agent_id IS NOT NULL
          AND d.created_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
          AND (${market} = '' OR d.market_id = ${market})
      ),
      mx AS (
        SELECT e.deal_id, MAX(CASE st.key WHEN 'qualified' THEN 1 WHEN 'research' THEN 1
                 WHEN 'meeting' THEN 2 WHEN 'demo' THEN 2 WHEN 'discovery' THEN 2
                 WHEN 'kp' THEN 3 WHEN 'proposal' THEN 3
                 WHEN 'contract' THEN 4 WHEN 'pilot' THEN 4 ELSE 0 END) AS m
        FROM sales_deal_events e JOIN sales_stages st ON st.id = e.new_stage_id
        WHERE e.deal_id IN (SELECT id FROM mine) GROUP BY 1
      )
      SELECT m.owner_agent_id AS agent_id,
             CASE WHEN m.won_at IS NOT NULL THEN 5 ELSE GREATEST(COALESCE(mx.m, 0), m.cur, 1) END AS k,
             COUNT(*)::int AS n
      FROM mine m LEFT JOIN mx ON mx.deal_id = m.id
      GROUP BY 1, 2
    `,
    // Деньги — по владельцу сделки, только по сделкам, выигранным в периоде:
    // продление Zahratun за сделку 2025 года не результат этого месяца
    sql`
      SELECT d.owner_agent_id AS agent_id, COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::bigint AS amt
      FROM sales_payments p JOIN sales_deals d ON d.id = p.deal_id
      WHERE p.org_id = ${orgId} AND d.archived_at IS NULL AND d.pipeline <> 'partner'
        AND d.owner_agent_id IS NOT NULL
        AND p.paid_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND d.won_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND (${market} = '' OR d.market_id = ${market})
      GROUP BY 1
    `,
  ])

  const byId = new Map<string, any>((agents as any[]).map(a => [a.id, a]))
  const byName = new Map<string, any>((agents as any[]).map(a => [a.name, a]))
  const extName = new Map<string, string>()
  for (const a of agents as any[]) {
    const ext = String(a.pbx_ext || '').replace(/\D/g, '')
    if (ext) extName.set(ext, a.name)
  }
  // Имя у звонка — как в отчёте активности: третий сегмент detail, иначе
  // добавочный, иначе имя после «моб.»
  const callerOf = (detail: string): string => {
    const parts = String(detail || '').split('·').map(s => s.trim())
    if (parts[2]) return parts[2]
    const side = parts[1] || ''
    if (/^внутр\./.test(side)) return extName.get(side.replace(/\D/g, '')) || ''
    if (/^моб\./.test(side)) return side.replace(/^моб\.\s*/, '')
    return ''
  }
  const inRegion = (mkt: unknown, agent: any): boolean => {
    if (!market) return true
    const m = String(mkt || '').toLowerCase() || String(agent?.market || '').toLowerCase()
    return m === market
  }

  const today = tzDate(new Date())
  const toDay = o.to < today ? o.to : today
  const workDays = workDaysBetween(o.from, toDay)
  const workSet = new Set(workDays)

  const people = new Map<string, Person>()
  const personFor = (a: any): Person => {
    let p = people.get(a.id)
    if (p) return p
    const created = a.created_at ? tzDate(new Date(a.created_at)) : null
    p = {
      agentId: a.id, name: a.name, role: a.role || null, market: a.market || null,
      since: created && created > o.from ? created : null,
      result: { won: 0, lost: 0, closed: 0, conv: null, created: 0, advanced: 0, open: 0, wonAmounts: {}, wonUzs: 0, cash: 0, cashN: 0 },
      touch: { calls: 0, answered: 0, talkSec: 0, msgs: 0, meetings: 0, total: 0,
               visible: (a.market || 'uz') === 'uz' || String(a.markets || '').split(',').includes('uz') },
      crm: { moves: 0, tasks: 0, notes: 0, total: 0 },
      clean: { open: 0, withStep: 0, qualified: 0, late: 0, lateAmt: 0, lost: 0, lostReasoned: 0, stale14: 0, checks: [], score: null },
      rhythm: { activeDays: 0, workDays: workDays.length, weekendDays: 0, longestGap: 0, lastActive: null, days: {} },
      stages: { reached: [0, 0, 0, 0, 0, 0], weakest: null },
      signals: [],
    }
    people.set(a.id, p)
    return p
  }
  for (const a of agents as any[]) {
    const mine = new Set([a.market, ...String(a.markets || '').split(',')].filter(Boolean))
    if (market && mine.size && !mine.has(market)) continue
    personFor(a)
  }
  const bump = (p: Person, day: string, n: number) => {
    if (!day || n <= 0) return
    p.rhythm.days[day] = (p.rhythm.days[day] || 0) + n
  }

  for (const c of calls as any[]) {
    const a = byName.get(callerOf(c.detail)); if (!a || !inRegion(c.mkt, a)) continue
    const p = personFor(a)
    const m = String(c.title || '').match(/(\d+) сек/)
    const talk = m ? Number(m[1]) : 0
    p.touch.calls++
    if (talk >= 30) { p.touch.answered++; p.touch.talkSec += talk; bump(p, c.day, 1) }
  }
  for (const r of acts as any[]) {
    const a = byId.get(r.agent_id); if (!a || !inRegion(r.mkt, a)) continue
    const p = personFor(a)
    p.touch.msgs += r.msgs; p.crm.notes += r.notes
    bump(p, r.day, r.msgs + r.notes)
  }
  for (const r of moves as any[]) {
    const a = byName.get(String(r.who || '').trim()); if (!a || !inRegion(r.mkt, a)) continue
    const p = personFor(a)
    p.crm.moves += r.n; bump(p, r.day, r.n)
  }
  for (const r of tasks as any[]) {
    const a = byId.get(r.agent_id); if (!a || !inRegion(r.mkt, a)) continue
    const p = personFor(a)
    p.crm.tasks += r.n; p.touch.meetings += r.meetings; bump(p, r.day, r.n)
  }
  for (const r of deals as any[]) {
    const a = byId.get(r.agent_id); if (!a) continue
    const p = personFor(a)
    const won = Number(r.won), lost = Number(r.lost)
    const amounts: Record<string, number> = {}
    for (const [cur, v] of Object.entries(r.won_amounts || {})) amounts[cur] = Number(v)
    p.result = {
      ...p.result,
      won, lost, closed: won + lost, conv: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      created: Number(r.created), advanced: Number(r.advanced), open: Number(r.open),
      wonAmounts: amounts,
      wonUzs: Object.entries(amounts).reduce((s, [cur, v]) => s + v * (TO_UZS[cur] || 0), 0),
    }
    p.clean = {
      ...p.clean, open: Number(r.open), withStep: Number(r.with_step), qualified: Number(r.qualified),
      late: Number(r.late), lateAmt: Number(r.late_amt), lost, lostReasoned: Number(r.lost_reasoned), stale14: Number(r.stale14),
    }
  }

  for (const r of cash as any[]) {
    const a = byId.get(r.agent_id); if (!a) continue
    const p = personFor(a)
    p.result.cash = Number(r.amt); p.result.cashN = Number(r.n)
  }
  for (const r of reached as any[]) {
    const a = byId.get(r.agent_id); if (!a) continue
    const p = personFor(a)
    const k = Math.min(5, Math.max(1, Number(r.k)))
    // Дошёл до ступени k — значит прошёл и все предыдущие
    p.stages.reached[0] += r.n
    for (let i = 1; i <= k; i++) p.stages.reached[i] += r.n
  }
  // Слабое место — переход, где человек отстаёт от команды сильнее всего
  // (на базе от пяти сделок, иначе это шум)
  const teamReached = [0, 0, 0, 0, 0, 0]
  for (const p of people.values()) for (let i = 0; i <= 5; i++) teamReached[i] += p.stages.reached[i]
  const stepRate = (r: number[], i: number) => (r[i] >= 5 ? r[i + 1] / r[i] : null)
  for (const p of people.values()) {
    let worst: Person['stages']['weakest'] = null
    for (let i = 1; i <= 4; i++) {
      const mine = stepRate(p.stages.reached, i), team = stepRate(teamReached, i)
      if (mine === null || team === null) continue
      if (mine < team - 0.1 && (!worst || mine - team < worst.rate - worst.team)) worst = { step: i, rate: mine, team }
    }
    p.stages.weakest = worst
  }

  for (const p of people.values()) {
    p.touch.total = p.touch.answered + p.touch.msgs + p.touch.meetings
    p.crm.total = p.crm.moves + p.crm.tasks

    const c = p.clean
    const ratio = (pass: number, of: number) => (of > 0 ? pass / of : null)
    c.checks = [
      { key: 'step', label: 'есть следующий шаг', pass: c.withStep, of: c.open, ratio: ratio(c.withStep, c.open) },
      { key: 'qual', label: 'заполнена квалификация', pass: c.qualified, of: c.open, ratio: ratio(c.qualified, c.open) },
      { key: 'amt', label: 'на КП и дальше есть сумма', pass: c.lateAmt, of: c.late, ratio: ratio(c.lateAmt, c.late) },
      { key: 'reason', label: 'проигрыш с причиной', pass: c.lostReasoned, of: c.lost, ratio: ratio(c.lostReasoned, c.lost) },
      { key: 'fresh', label: 'не стоит 14+ дней', pass: c.open - c.stale14, of: c.open, ratio: ratio(c.open - c.stale14, c.open) },
    ]
    const applicable = c.checks.filter(x => x.ratio !== null)
    c.score = applicable.length ? Math.round((applicable.reduce((s, x) => s + (x.ratio as number), 0) / applicable.length) * 100) : null

    // Ритм: рабочие дни с хотя бы одним действием; для новичка — с его даты
    const r = p.rhythm
    const myWork = p.since ? workDays.filter(d => d >= (p.since as string)) : workDays
    r.workDays = myWork.length
    r.activeDays = myWork.filter(d => (r.days[d] || 0) > 0).length
    r.weekendDays = Object.keys(r.days).filter(d => isWeekend(d) && r.days[d] > 0).length
    let gap = 0, longest = 0, seen = false
    for (const d of myWork) {
      if ((r.days[d] || 0) > 0) { seen = true; gap = 0 } else if (seen) { gap++; longest = Math.max(longest, gap) }
    }
    r.longestGap = longest
    const active = Object.keys(r.days).filter(d => r.days[d] > 0).sort()
    r.lastActive = active.length ? active[active.length - 1] : null
  }

  // Сигналы — правила, не мнение. Один-три на человека, самое важное первым
  const list = [...people.values()]
  const bestWon = Math.max(0, ...list.map(p => p.result.won))
  const bestTalk = Math.max(0, ...list.map(p => p.touch.answered))
  const lastWork = workDays[workDays.length - 1]
  for (const p of list) {
    const s: Signal[] = []
    const c = p.clean, r = p.rhythm
    if (p.result.won > 0 && p.result.won === bestWon && list.filter(x => x.result.won === bestWon).length === 1) s.push({ tone: 'good', text: 'лучший результат' })
    if (c.score !== null && c.score >= 80 && c.open >= 5) s.push({ tone: 'good', text: 'чистые карточки' })
    if (p.touch.answered > 0 && p.touch.answered === bestTalk && list.filter(x => x.touch.answered === bestTalk).length === 1) s.push({ tone: 'good', text: 'больше всех разговоров' })
    if (c.open >= 10 && c.withStep / c.open < 0.2) s.push({ tone: 'bad', text: `${c.open} открытых, ${c.open - c.withStep} без шага` })
    if (c.stale14 >= 5 && c.stale14 / c.open >= 0.25) s.push({ tone: 'bad', text: `${c.stale14} из ${c.open} стоят 14+ дней` })
    if (c.late >= 5 && c.lateAmt / c.late < 0.5) s.push({ tone: 'bad', text: `${c.late - c.lateAmt} из ${c.late} на КП и дальше без суммы` })
    if (c.lost >= 10 && c.lostReasoned / c.lost < 0.5) s.push({ tone: 'warn', text: `${c.lostReasoned} из ${c.lost} проигрышей с причиной` })
    if (p.touch.calls >= 30 && p.touch.answered / p.touch.calls < 0.3) s.push({ tone: 'warn', text: `${p.touch.calls} звонков → ${p.touch.answered} разговоров (${Math.round((p.touch.answered / p.touch.calls) * 100)}%)` })
    if (!p.since && r.lastActive && lastWork) {
      const idx = workDays.indexOf(r.lastActive)
      const silent = idx >= 0 ? workDays.length - 1 - idx : workDays.filter(d => d > (r.lastActive as string)).length
      if (silent >= 3) s.push({ tone: 'warn', text: `тихо с ${fmtDay(r.lastActive)}` })
    }
    if (!p.since && !r.lastActive && r.workDays > 0) s.push({ tone: 'warn', text: 'ни одного действия за период' })
    if (p.since) s.push({ tone: 'info', text: `с ${fmtDay(p.since)} · рано судить` })
    if (!p.touch.visible) s.push({ tone: 'info', text: 'звонки и сообщения не видим' })
    p.signals = s.slice(0, 3)
  }

  // Команда: без тех, у кого за период пусто везде — это не продавцы, а
  // владельцы одной старой сделки
  const peopleOut = list.filter(p => p.result.created || p.result.closed || p.result.open || p.touch.total || p.crm.total || p.crm.notes)
    .sort((a, b) => b.result.won - a.result.won || b.result.wonUzs - a.result.wonUzs || b.result.advanced - a.result.advanced)

  const withScore = peopleOut.filter(p => p.clean.score !== null)
  const wonAmounts: Record<string, number> = {}
  for (const p of peopleOut) for (const [cur, v] of Object.entries(p.result.wonAmounts)) wonAmounts[cur] = (wonAmounts[cur] || 0) + v
  const byMarket: Record<string, number> = {}
  for (const p of peopleOut) { const k = p.market || '—'; byMarket[k] = (byMarket[k] || 0) + 1 }

  return {
    period: { from: o.from, to: toDay, workDays: workDays.length, crmSince: CRM_CUTOVER },
    workDays,
    teamReached,
    totals: {
      people: peopleOut.length, byMarket,
      won: peopleOut.reduce((s, p) => s + p.result.won, 0), wonAmounts,
      cash: peopleOut.reduce((s, p) => s + p.result.cash, 0),
      cashN: peopleOut.reduce((s, p) => s + p.result.cashN, 0),
      wonNoOwner: Number((orphan as any[])[0]?.n || 0),
      touches: peopleOut.reduce((s, p) => s + p.touch.total, 0),
      cleanAvg: withScore.length ? Math.round(withScore.reduce((s, p) => s + (p.clean.score as number), 0) / withScore.length) : null,
      rhythmAvg: peopleOut.length ? Math.round((peopleOut.reduce((s, p) => s + (p.rhythm.workDays ? p.rhythm.activeDays / p.rhythm.workDays : 0), 0) / peopleOut.length) * 100) : 0,
    },
    people: peopleOut,
  }
}
