import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders, ensureOnce } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { getPlanfactKey, pfIncomeOperations } from '../_lib/planfact.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * KPI-мотивация продаж: шаблон месяца от РОПа, живой расчёт для менеджера,
 * свод команды и заморозка месяца в историю.
 *
 * Согласованные правила:
 *  — дисциплинарный бюджет платится пропорционально, каждая шкала с капом 100%;
 *  — комиссия только от фактически поступивших денег (sales_payments);
 *  — 10% до личного плана, 15% на превышение;
 *  — порог 80% — управленческий флаг, деньги не режет;
 *  — депремирование — ручная корректировка РОПа с обязательной причиной;
 *  — после «Закрыть месяц» цифры замораживаются и не пересчитываются.
 */

const TZ = 'Asia/Tashkent'

const DEFAULT_METRICS = [
  { key: 'calls', label: 'Звонки', norm: 15, minAvgMin: 5, weight: 33.4 },
  { key: 'meetings', label: 'Встречи', norm: 20, weight: 33.3 },
  { key: 'proposals', label: 'Коммерческие предложения', norm: 20, weight: 33.3 },
]

async function ensureKpiSchema(sql: any) {
  await ensureOnce('sales_kpi', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_kpi_templates (
        org_id VARCHAR(50) NOT NULL,
        month DATE NOT NULL,
        budget BIGINT NOT NULL DEFAULT 2000000,
        metrics JSONB NOT NULL DEFAULT '[]',
        commission_below NUMERIC NOT NULL DEFAULT 10,
        commission_above NUMERIC NOT NULL DEFAULT 15,
        rop_agent_id VARCHAR(80),
        rop_fix BIGINT NOT NULL DEFAULT 0,
        rop_percent NUMERIC NOT NULL DEFAULT 4,
        team_plan BIGINT NOT NULL DEFAULT 0,
        enterprise_plan BIGINT NOT NULL DEFAULT 0,
        region_plans JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        closed_at TIMESTAMP,
        closed_by VARCHAR(80),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (org_id, month)
      )
    `.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS sales_kpi_plans (
        org_id VARCHAR(50) NOT NULL,
        month DATE NOT NULL,
        agent_id VARCHAR(80) NOT NULL,
        fix_salary BIGINT NOT NULL DEFAULT 0,
        plan_amount BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (org_id, month, agent_id)
      )
    `.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS sales_kpi_adjustments (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        month DATE NOT NULL,
        agent_id VARCHAR(80) NOT NULL,
        amount BIGINT NOT NULL,
        reason TEXT NOT NULL,
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS sales_payments (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        deal_id VARCHAR(80),
        agent_id VARCHAR(80),
        amount BIGINT NOT NULL,
        paid_at DATE NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'manual',
        note TEXT,
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => {})
    await sql`CREATE INDEX IF NOT EXISTS sales_payments_org_paid ON sales_payments(org_id, paid_at)`.catch(() => {})
    await sql`ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS external_id VARCHAR(80)`.catch(() => {})
    // Входящие из ПланФакта: операция лежит здесь, пока РОП не привяжет её
    // к сделке или не отметит «не продажи» (займы, возвраты, прочее)
    await sql`
      CREATE TABLE IF NOT EXISTS sales_pf_inbox (
        org_id VARCHAR(50) NOT NULL,
        pf_operation_id BIGINT NOT NULL,
        operation_date DATE NOT NULL,
        amount BIGINT NOT NULL,
        contragent TEXT,
        comment TEXT,
        account TEXT,
        category TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        deal_id VARCHAR(80),
        payment_id BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (org_id, pf_operation_id)
      )
    `.catch(() => {})
    await sql`ALTER TABLE sales_pf_inbox ADD COLUMN IF NOT EXISTS currency VARCHAR(8) DEFAULT 'UZS'`.catch(() => {})
    await sql`ALTER TABLE sales_pf_inbox ADD COLUMN IF NOT EXISTS amount_original BIGINT`.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS sales_kpi_closures (
        org_id VARCHAR(50) NOT NULL,
        month DATE NOT NULL,
        payload JSONB NOT NULL,
        closed_by VARCHAR(80),
        closed_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (org_id, month)
      )
    `.catch(() => {})
  })
}

/** Границы месяца и «сегодня» в Ташкенте; рабочие дни — пн-пт. */
function monthInfo(month: string) {
  const [y, m] = month.split('-').map(Number)
  const now = new Date()
  const tashNow = new Date(now.getTime() + 5 * 3600 * 1000)
  const todayIso = tashNow.toISOString().slice(0, 10)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`
  // До какого дня считаем «норму на сегодня»: для прошлых месяцев — весь месяц
  const cutIso = todayIso > monthEnd ? monthEnd : (todayIso < monthStart ? monthStart : todayIso)
  const cutDay = Number(cutIso.slice(8, 10))
  let workTotal = 0, workElapsed = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    if (dow === 0 || dow === 6) continue
    workTotal++
    if (d <= cutDay) workElapsed++
  }
  // Timestamptz-границы месяца по Ташкенту
  const fromTs = `${monthStart}T00:00:00+05:00`
  const toTs = `${monthEnd}T23:59:59.999+05:00`
  return { monthStart, monthEnd, todayIso: cutIso, workTotal, workElapsed: Math.max(1, workElapsed), fromTs, toTs }
}

async function loadTemplate(sql: any, orgId: string, month: string) {
  const monthDate = `${month}-01`
  const [t] = await sql`
    SELECT month, budget, metrics, commission_below, commission_above,
           rop_agent_id, rop_fix, rop_percent, team_plan, enterprise_plan,
           region_plans, status, closed_at
    FROM sales_kpi_templates WHERE org_id = ${orgId} AND month = ${monthDate}
  `
  const plans = await sql`
    SELECT p.agent_id, p.fix_salary, p.plan_amount, a.name
    FROM sales_kpi_plans p
    LEFT JOIN support_agents a ON a.id = p.agent_id
    WHERE p.org_id = ${orgId} AND p.month = ${monthDate}
    ORDER BY a.name
  `
  return {
    exists: !!t,
    template: t ? {
      budget: Number(t.budget),
      metrics: Array.isArray(t.metrics) && t.metrics.length ? t.metrics : DEFAULT_METRICS,
      commissionBelow: Number(t.commission_below),
      commissionAbove: Number(t.commission_above),
      ropAgentId: t.rop_agent_id,
      ropFix: Number(t.rop_fix),
      ropPercent: Number(t.rop_percent),
      teamPlan: Number(t.team_plan),
      enterprisePlan: Number(t.enterprise_plan),
      regionPlans: t.region_plans || {},
      status: t.status,
      closedAt: t.closed_at,
    } : {
      budget: 2000000, metrics: DEFAULT_METRICS,
      commissionBelow: 10, commissionAbove: 15,
      ropAgentId: null, ropFix: 0, ropPercent: 4,
      teamPlan: 0, enterprisePlan: 0, regionPlans: {}, status: 'draft',
      closedAt: null,
    },
    plans: (plans as any[]).map(p => ({
      agentId: p.agent_id, name: p.name || p.agent_id,
      fix: Number(p.fix_salary), plan: Number(p.plan_amount),
    })),
  }
}

/**
 * Живой расчёт месяца: дисциплина, поступления, комиссии, корректировки —
 * по каждому менеджеру с планом. Один и тот же расчёт кормит и «Мой KPI»,
 * и свод, и заморозку при закрытии месяца.
 */
async function computeMonth(sql: any, orgId: string, month: string) {
  const { monthStart, monthEnd, todayIso, workTotal, workElapsed, fromTs, toTs } = monthInfo(month)
  const { template, plans, exists } = await loadTemplate(sql, orgId, month)
  const monthDate = `${month}-01`
  const elapsedFrac = workElapsed / workTotal

  const [agents, callRows, meetRows, docRows, payRows, adjRows] = await Promise.all([
    sql`
      SELECT id, name FROM support_agents
      WHERE org_id = ${orgId} AND is_active = true AND merged_into IS NULL
    `,
    // Звонки из телефонии: имя сотрудника — третий сегмент detail
    sql`
      SELECT trim(split_part(detail, '·', 3)) AS who,
             ((happened_at AT TIME ZONE ${TZ})::date)::text AS d,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE title ~ ${'\\d+ сек'})::int AS answered,
             COALESCE(SUM(NULLIF(substring(title from ${'(\\d+) сек'}), '')::int), 0)::int AS talk
      FROM sales_touchpoints
      WHERE org_id = ${orgId} AND kind = 'call'
        AND happened_at BETWEEN ${fromTs}::timestamptz AND ${toTs}::timestamptz
        AND trim(split_part(detail, '·', 3)) <> ''
      GROUP BY 1, 2
    `,
    sql`
      SELECT assignee_agent_id AS agent_id, COUNT(*)::int AS n
      FROM sales_tasks
      WHERE org_id = ${orgId} AND kind = 'meeting' AND done_at IS NOT NULL
        AND done_at BETWEEN (${fromTs}::timestamptz AT TIME ZONE 'UTC')
                        AND (${toTs}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1
    `,
    sql`
      SELECT created_by AS agent_id, COUNT(*)::int AS n
      FROM sales_documents
      WHERE org_id = ${orgId} AND kind = 'quote' AND sent_at IS NOT NULL
        AND sent_at BETWEEN (${fromTs}::timestamptz AT TIME ZONE 'UTC')
                        AND (${toTs}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1
    `,
    sql`
      SELECT p.id, p.deal_id, p.amount, p.paid_at::text AS paid_at, p.note, p.source,
             COALESCE(p.agent_id, d.owner_agent_id) AS agent_id,
             d.title AS deal_title, d.pipeline, d.market_id
      FROM sales_payments p
      LEFT JOIN sales_deals d ON d.id = p.deal_id
      WHERE p.org_id = ${orgId} AND p.paid_at BETWEEN ${monthStart}::date AND ${monthEnd}::date
      ORDER BY p.paid_at
    `,
    sql`
      SELECT id, agent_id, amount, reason, created_at
      FROM sales_kpi_adjustments
      WHERE org_id = ${orgId} AND month = ${monthDate}
      ORDER BY created_at
    `,
  ])

  const nameById = new Map<string, string>()
  const idByName = new Map<string, string>()
  for (const a of agents as any[]) { nameById.set(a.id, a.name); idByName.set(a.name, a.id) }

  const metrics = template.metrics as any[]
  const callMetric = metrics.find(m => m.key === 'calls')
  const meetMetric = metrics.find(m => m.key === 'meetings')
  const propMetric = metrics.find(m => m.key === 'proposals')

  // Звонки: день в зачёте, если звонков ≥ нормы и средняя ≥ минимальной
  const callDays = new Map<string, { ok: number; today: { n: number; avgSec: number } | null }>()
  for (const r of callRows as any[]) {
    const agentId = idByName.get(r.who)
    if (!agentId) continue
    const cur = callDays.get(agentId) || { ok: 0, today: null }
    const avgSec = r.answered > 0 ? r.talk / r.answered : 0
    const passes = callMetric
      ? r.n >= Number(callMetric.norm || 0) && avgSec >= Number(callMetric.minAvgMin || 0) * 60
      : false
    if (passes) cur.ok++
    if (r.d === todayIso) cur.today = { n: r.n, avgSec: Math.round(avgSec) }
    callDays.set(agentId, cur)
  }
  const meetings = new Map<string, number>()
  for (const r of meetRows as any[]) meetings.set(r.agent_id, r.n)
  const proposals = new Map<string, number>()
  for (const r of docRows as any[]) proposals.set(r.agent_id, r.n)

  const paidByAgent = new Map<string, number>()
  let paidTotal = 0, paidEnterprise = 0
  const paidByRegion: Record<string, number> = {}
  for (const p of payRows as any[]) {
    const amt = Number(p.amount)
    paidTotal += amt
    if (String(p.pipeline || '').startsWith('enterprise')) paidEnterprise += amt
    const region = p.market_id || 'uz'
    paidByRegion[region] = (paidByRegion[region] || 0) + amt
    if (p.agent_id) paidByAgent.set(p.agent_id, (paidByAgent.get(p.agent_id) || 0) + amt)
  }

  const adjByAgent = new Map<string, number>()
  for (const a of adjRows as any[]) {
    adjByAgent.set(a.agent_id, (adjByAgent.get(a.agent_id) || 0) + Number(a.amount))
  }

  const cap = (x: number) => Math.max(0, Math.min(1, x))
  const people = plans.map(pl => {
    const cd = callDays.get(pl.agentId) || { ok: 0, today: null }
    const meetDone = meetings.get(pl.agentId) || 0
    const propDone = proposals.get(pl.agentId) || 0

    // Процент каждой шкалы — к норме на сегодня; кап 100%
    const scales: any[] = []
    let discipline = 0, weightSum = 0
    if (callMetric) {
      const pct = cap(cd.ok / workElapsed)
      scales.push({
        key: 'calls', label: callMetric.label, pct: Math.round(pct * 100),
        done: cd.ok, target: workElapsed, unit: 'дней в зачёте',
        today: cd.today,
      })
      discipline += pct * Number(callMetric.weight); weightSum += Number(callMetric.weight)
    }
    if (meetMetric) {
      const normToDate = Number(meetMetric.norm) * elapsedFrac
      const pct = cap(normToDate > 0 ? meetDone / normToDate : 0)
      scales.push({
        key: 'meetings', label: meetMetric.label, pct: Math.round(pct * 100),
        done: meetDone, target: Number(meetMetric.norm), unit: 'за месяц',
      })
      discipline += pct * Number(meetMetric.weight); weightSum += Number(meetMetric.weight)
    }
    if (propMetric) {
      const normToDate = Number(propMetric.norm) * elapsedFrac
      const pct = cap(normToDate > 0 ? propDone / normToDate : 0)
      scales.push({
        key: 'proposals', label: propMetric.label, pct: Math.round(pct * 100),
        done: propDone, target: Number(propMetric.norm), unit: 'за месяц',
      })
      discipline += pct * Number(propMetric.weight); weightSum += Number(propMetric.weight)
    }
    const discPct = weightSum > 0 ? discipline / weightSum : 0
    const kpiMoney = Math.round(template.budget * discPct)

    const paid = paidByAgent.get(pl.agentId) || 0
    const below = Math.min(paid, pl.plan)
    const above = Math.max(0, paid - pl.plan)
    const commission = Math.round(below * template.commissionBelow / 100 + above * template.commissionAbove / 100)

    const adj = adjByAgent.get(pl.agentId) || 0
    const planPct = pl.plan > 0 ? paid / pl.plan : 0
    // Темп: выполнение против нормы на сегодня
    const pace = pl.plan > 0 && elapsedFrac > 0 ? planPct / elapsedFrac : 0

    return {
      agentId: pl.agentId, name: pl.name,
      fix: pl.fix, plan: pl.plan, paid,
      planPct: Math.round(planPct * 100), pace: Math.round(pace * 100),
      belowPace80: pl.plan > 0 && pace < 0.8,
      disciplinePct: Math.round(discPct * 100), kpiMoney,
      commission, adjustments: adj,
      total: pl.fix + kpiMoney + commission - adj,
      scales,
    }
  })

  // РОП: фикс + процент от поступлений всего отдела
  let rop: any = null
  if (template.ropAgentId || template.ropFix > 0) {
    const ropCommission = Math.round(paidTotal * template.ropPercent / 100)
    rop = {
      agentId: template.ropAgentId,
      name: template.ropAgentId ? (nameById.get(template.ropAgentId) || 'РОП') : 'РОП',
      fix: template.ropFix,
      percent: template.ropPercent,
      commission: ropCommission,
      total: template.ropFix + ropCommission,
    }
  }

  const fund = {
    fix: people.reduce((s, p) => s + p.fix, 0) + (rop?.fix || 0),
    kpi: people.reduce((s, p) => s + p.kpiMoney, 0),
    commission: people.reduce((s, p) => s + p.commission, 0) + (rop?.commission || 0),
    adjustments: people.reduce((s, p) => s + p.adjustments, 0),
    total: people.reduce((s, p) => s + p.total, 0) + (rop?.total || 0),
  }

  const paceOf = (paid: number, plan: number) =>
    plan > 0 && elapsedFrac > 0 ? Math.round((paid / plan) / elapsedFrac * 100) : 0

  return {
    month, monthStart, monthEnd, todayIso,
    workTotal, workElapsed,
    templateExists: exists,
    template,
    people,
    rop,
    fund,
    goals: {
      team: { plan: template.teamPlan, paid: paidTotal, pace: paceOf(paidTotal, template.teamPlan) },
      enterprise: { plan: template.enterprisePlan, paid: paidEnterprise, pace: paceOf(paidEnterprise, template.enterprisePlan) },
      regions: Object.entries({ ...(template.regionPlans as Record<string, number>) }).map(([rid, plan]) => ({
        region: rid, plan: Number(plan) || 0, paid: paidByRegion[rid] || 0,
        pace: paceOf(paidByRegion[rid] || 0, Number(plan) || 0),
      })),
    },
    adjustments: (adjRows as any[]).map(a => ({
      id: Number(a.id), agentId: a.agent_id, name: nameById.get(a.agent_id) || a.agent_id,
      amount: Number(a.amount), reason: a.reason, createdAt: a.created_at,
    })),
    payments: (payRows as any[]).map(p => ({
      id: Number(p.id), dealId: p.deal_id, dealTitle: p.deal_title,
      agentId: p.agent_id, name: p.agent_id ? (nameById.get(p.agent_id) || '') : '',
      amount: Number(p.amount), paidAt: p.paid_at, note: p.note, source: p.source,
    })),
  }
}

function currentMonthTashkent(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

/**
 * Нормализация названия для сверки «контрагент ПланФакта ↔ сделка CRM»:
 * регистр, кавычки и организационные приставки (ООО, MCHJ, ИП…) — шум,
 * по которому имена расходятся, хотя компания одна.
 */
function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/["'«»“”„()]/g, ' ')
    .replace(/\b(ооо|оoo|мчж|mchj|xk|ип|яттб|llc|ltd|inc|co)\b/g, ' ')
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Кандидаты-сделки для привязки поступления.
 *
 * Сверяем три подписи операции — контрагента, статью (у Delever это бренд
 * клиента) и комментарий — с названием сделки и именем аккаунта.
 * «Физ лицо» и подобные заглушки в матчинг не идут.
 */
const NOISE_NAMES = new Set(['физ лицо', 'физлицо', 'не выбран', 'не выбрано'])

function matchDeals(
  signals: Array<string | null | undefined>,
  deals: Array<{ id: string; title: string; account_name: string | null; owner_name: string | null; won_at: string | null }>,
): string[] {
  const targets = signals
    .map(s => normName(s || ''))
    .filter(t => t.length >= 3 && !NOISE_NAMES.has(t))
  if (!targets.length) return []
  const scored: Array<{ id: string; score: number }> = []
  for (const d of deals) {
    const names = [normName(d.title), normName(d.account_name || '')]
    let score = 0
    for (const n of names) {
      if (!n || n.length < 3) continue
      for (const t of targets) {
        if (n === t) score = Math.max(score, 100)
        else if (t.length >= 5 && n.length >= 5 && (n.includes(t) || t.includes(n))) score = Math.max(score, 60)
      }
    }
    if (score > 0) scored.push({ id: d.id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.id)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  await ensureKpiSchema(sql)

  const url = new URL(req.url)
  const month = (url.searchParams.get('month') || '').match(/^\d{4}-\d{2}$/)
    ? url.searchParams.get('month')!
    : currentMonthTashkent()
  const monthDate = `${month}-01`

  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'my'

    if (action === 'template') {
      const data = await loadTemplate(sql, orgId, month)
      // Ростер продаж — чтобы РОП видел, кому ставить планы, без ручного ввода
      const roster = await sql`
        SELECT id, name, role FROM support_agents
        WHERE org_id = ${orgId} AND is_active = true AND merged_into IS NULL
          AND (department IN ('sales', 'sale')
               OR role IN ('cco', 'sales', 'sale', 'kam', 'sdr', 'sales_lead'))
        ORDER BY name
      `
      return json({ month, ...data, roster, canEdit: !!ctx.isLead })
    }

    if (action === 'my') {
      const data = await computeMonth(sql, orgId, month)
      const me = data.people.find(p => p.agentId === ctx.agentId)
        || (data.rop?.agentId === ctx.agentId ? { ...data.rop, isRop: true } : null)
      return json({
        month, todayIso: data.todayIso, template: {
          commissionBelow: data.template.commissionBelow,
          commissionAbove: data.template.commissionAbove,
          budget: data.template.budget,
        },
        me,
        myPayments: data.payments.filter(p => p.agentId === ctx.agentId),
        closed: data.template.status === 'closed',
      })
    }

    if (action === 'team') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      // Закрытый месяц отдаём из заморозки — как выплатили, так и показываем
      const [closure] = await sql`
        SELECT payload, closed_at, closed_by FROM sales_kpi_closures
        WHERE org_id = ${orgId} AND month = ${monthDate}
      `
      if (closure) return json({ ...closure.payload, closed: true, closedAt: closure.closed_at })
      const data = await computeMonth(sql, orgId, month)
      return json({ ...data, closed: false })
    }

    if (action === 'history') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const rows = await sql`
        SELECT month::text AS month, payload, closed_at, closed_by
        FROM sales_kpi_closures WHERE org_id = ${orgId}
        ORDER BY month DESC LIMIT 24
      `
      return json({
        months: (rows as any[]).map(r => ({
          month: r.month.slice(0, 7),
          closedAt: r.closed_at,
          fund: r.payload?.fund || null,
          paid: r.payload?.goals?.team?.paid ?? null,
          teamPlan: r.payload?.goals?.team?.plan ?? null,
          people: r.payload?.people || [],
          rop: r.payload?.rop || null,
          adjustments: r.payload?.adjustments || [],
        })),
      })
    }

    // Входящие ПланФакта с подсказками привязки
    if (action === 'pf_inbox') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const status = url.searchParams.get('status') || 'new'
      const [inbox, deals] = await Promise.all([
        sql`
          SELECT pf_operation_id, operation_date::text AS operation_date, amount,
                 contragent, comment, account, category, status, deal_id,
                 currency, amount_original
          FROM sales_pf_inbox
          WHERE org_id = ${orgId} AND status = ${status}
          ORDER BY operation_date DESC LIMIT 200
        `,
        // Пул для привязки: живые и ВСЕ выигранные — исторические клиенты
        // из Amo платят подписку, их сделки давно выиграны, но именно к ним
        // и привязываются регулярные поступления
        sql`
          SELECT d.id, d.title, a.name AS account_name, ag.name AS owner_name,
                 d.won_at::text AS won_at
          FROM sales_deals d
          LEFT JOIN sales_accounts a ON a.id = d.account_id
          LEFT JOIN support_agents ag ON ag.id = d.owner_agent_id
          WHERE d.org_id = ${orgId} AND d.archived_at IS NULL AND d.lost_at IS NULL
          ORDER BY (d.won_at IS NULL) DESC, d.updated_at DESC LIMIT 2500
        `,
      ])
      const dealPool = deals as any[]
      const items = (inbox as any[]).map(op => ({
        id: Number(op.pf_operation_id),
        date: op.operation_date,
        amount: Number(op.amount),
        amountOriginal: op.amount_original !== null ? Number(op.amount_original) : null,
        currency: op.currency || 'UZS',
        contragent: op.contragent,
        comment: op.comment,
        account: op.account,
        category: op.category,
        status: op.status,
        dealId: op.deal_id,
        suggested: status === 'new'
          ? matchDeals([op.contragent, op.category, op.comment], dealPool)
          : [],
      }))
      return json({
        items,
        deals: dealPool.map(d => ({
          id: d.id, title: d.title, account: d.account_name, owner: d.owner_name, won: !!d.won_at,
        })),
      })
    }

    if (action === 'payments') {
      const dealId = url.searchParams.get('dealId') || ''
      if (!dealId) return json({ error: 'dealId required' }, 400)
      const rows = await sql`
        SELECT id, amount, paid_at::text AS paid_at, note, source, created_by
        FROM sales_payments WHERE org_id = ${orgId} AND deal_id = ${dealId}
        ORDER BY paid_at DESC
      `
      return json({ payments: rows })
    }

    return json({ error: 'unknown action' }, 400)
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    // Отметка «оплата пришла» на сделке: РОП или финансист
    if (action === 'payment') {
      if (!ctx.isLead) return json({ error: 'Отмечать оплаты может только руководитель' }, 403)
      const dealId = String(body.dealId || '')
      const amount = Math.round(Number(body.amount))
      const paidAt = String(body.paidAt || '').match(/^\d{4}-\d{2}-\d{2}$/)
        ? String(body.paidAt)
        : new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
      if (!dealId || !Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'нужны dealId и сумма больше нуля' }, 400)
      }
      const [deal] = await sql`
        SELECT id, owner_agent_id FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId}
      `
      if (!deal) return json({ error: 'сделка не найдена' }, 404)
      const [row] = await sql`
        INSERT INTO sales_payments (org_id, deal_id, agent_id, amount, paid_at, note, created_by)
        VALUES (${orgId}, ${dealId}, ${deal.owner_agent_id}, ${amount}, ${paidAt}, ${body.note || null}, ${ctx.agentId})
        RETURNING id
      `
      return json({ ok: true, id: Number(row.id) })
    }

    if (action === 'payment_delete') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      await sql`DELETE FROM sales_payments WHERE id = ${Number(body.id)} AND org_id = ${orgId} AND source = 'manual'`
      return json({ ok: true })
    }

    if (action === 'template') {
      if (!ctx.isLead) return json({ error: 'Шаблон правит только руководитель' }, 403)
      const [closed] = await sql`
        SELECT 1 FROM sales_kpi_closures WHERE org_id = ${orgId} AND month = ${monthDate}
      `
      if (closed) return json({ error: 'Месяц закрыт — правила заморожены' }, 400)

      const metrics = Array.isArray(body.metrics) && body.metrics.length ? body.metrics : DEFAULT_METRICS
      const weightSum = metrics.reduce((s: number, m: any) => s + Number(m.weight || 0), 0)
      if (Math.abs(weightSum - 100) > 0.5) {
        return json({ error: `Веса показателей дают ${weightSum}% вместо 100%` }, 400)
      }

      await sql`
        INSERT INTO sales_kpi_templates (
          org_id, month, budget, metrics, commission_below, commission_above,
          rop_agent_id, rop_fix, rop_percent, team_plan, enterprise_plan, region_plans,
          status, updated_at
        ) VALUES (
          ${orgId}, ${monthDate}, ${Math.round(Number(body.budget) || 2000000)},
          ${JSON.stringify(metrics)},
          ${Number(body.commissionBelow) || 10}, ${Number(body.commissionAbove) || 15},
          ${body.ropAgentId || null}, ${Math.round(Number(body.ropFix) || 0)},
          ${Number(body.ropPercent) || 4},
          ${Math.round(Number(body.teamPlan) || 0)}, ${Math.round(Number(body.enterprisePlan) || 0)},
          ${JSON.stringify(body.regionPlans || {})}, 'active', NOW()
        )
        ON CONFLICT (org_id, month) DO UPDATE SET
          budget = EXCLUDED.budget, metrics = EXCLUDED.metrics,
          commission_below = EXCLUDED.commission_below,
          commission_above = EXCLUDED.commission_above,
          rop_agent_id = EXCLUDED.rop_agent_id, rop_fix = EXCLUDED.rop_fix,
          rop_percent = EXCLUDED.rop_percent, team_plan = EXCLUDED.team_plan,
          enterprise_plan = EXCLUDED.enterprise_plan, region_plans = EXCLUDED.region_plans,
          status = 'active', updated_at = NOW()
      `

      if (Array.isArray(body.plans)) {
        for (const p of body.plans) {
          if (!p?.agentId) continue
          await sql`
            INSERT INTO sales_kpi_plans (org_id, month, agent_id, fix_salary, plan_amount)
            VALUES (${orgId}, ${monthDate}, ${String(p.agentId)},
                    ${Math.round(Number(p.fix) || 0)}, ${Math.round(Number(p.plan) || 0)})
            ON CONFLICT (org_id, month, agent_id) DO UPDATE SET
              fix_salary = EXCLUDED.fix_salary, plan_amount = EXCLUDED.plan_amount
          `
        }
        const keep = body.plans.map((p: any) => String(p.agentId)).filter(Boolean)
        if (keep.length) {
          await sql`
            DELETE FROM sales_kpi_plans
            WHERE org_id = ${orgId} AND month = ${monthDate} AND NOT (agent_id = ANY(${keep}))
          `
        }
      }
      return json({ ok: true })
    }

    // Забрать поступления из ПланФакта во «входящие»
    if (action === 'pf_sync') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const key = await getPlanfactKey(sql, orgId)
      if (!key) return json({ error: 'ПланФакт не подключён — вставьте ключ в Настройки → Интеграции' }, 400)

      const days = Math.min(365, Number(body.days) || 60)
      const to = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
      const from = new Date(Date.now() - days * 86400000 + 5 * 3600 * 1000).toISOString().slice(0, 10)

      let offset = 0, fetched = 0, added = 0
      for (let page = 0; page < 10; page++) {
        const r = await pfIncomeOperations(key, from, to, 100, offset)
        if (!r.ok) return json({ error: r.error }, 502)
        const items = r.data?.items || []
        fetched += items.length
        for (const op of items) {
          if (!op.operationId || !(op.value > 0)) continue
          // Неразобранные строки обновляем: первый синк не умел доставать
          // контрагента из частей операции, и они легли «безымянными».
          // Привязанные и отклонённые не трогаем — по ним решение принято
          const rows = await sql`
            INSERT INTO sales_pf_inbox (
              org_id, pf_operation_id, operation_date, amount,
              contragent, comment, account, category, currency, amount_original
            ) VALUES (
              ${orgId}, ${op.operationId}, ${op.operationDate}, ${op.value},
              ${op.contragent}, ${op.comment}, ${op.account}, ${op.category},
              ${op.currency}, ${op.valueOriginal}
            )
            ON CONFLICT (org_id, pf_operation_id) DO UPDATE SET
              operation_date = EXCLUDED.operation_date, amount = EXCLUDED.amount,
              contragent = EXCLUDED.contragent, comment = EXCLUDED.comment,
              account = EXCLUDED.account, category = EXCLUDED.category,
              currency = EXCLUDED.currency, amount_original = EXCLUDED.amount_original
            WHERE sales_pf_inbox.status = 'new'
            RETURNING (xmax = 0) AS inserted
          `
          if (rows.length && rows[0].inserted) added++
        }
        if (items.length < 100 || fetched >= (r.data?.total || 0)) break
        offset += 100
      }
      const [cnt] = await sql`
        SELECT COUNT(*)::int AS n FROM sales_pf_inbox WHERE org_id = ${orgId} AND status = 'new'
      `
      return json({ ok: true, fetched, added, pending: cnt?.n || 0, from, to })
    }

    // Привязка операции к сделке: рождается поступление, комиссия оживает
    if (action === 'pf_link') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const opId = Number(body.inboxId)
      const dealId = String(body.dealId || '')
      if (!opId || !dealId) return json({ error: 'нужны inboxId и dealId' }, 400)
      const [op] = await sql`
        SELECT pf_operation_id, operation_date, amount, contragent, status
        FROM sales_pf_inbox WHERE org_id = ${orgId} AND pf_operation_id = ${opId}
      `
      if (!op) return json({ error: 'операция не найдена' }, 404)
      if (op.status === 'linked') return json({ error: 'уже привязана' }, 400)
      const [deal] = await sql`
        SELECT id, owner_agent_id FROM sales_deals WHERE id = ${dealId} AND org_id = ${orgId}
      `
      if (!deal) return json({ error: 'сделка не найдена' }, 404)

      const [pay] = await sql`
        INSERT INTO sales_payments (org_id, deal_id, agent_id, amount, paid_at, source, note, created_by, external_id)
        VALUES (${orgId}, ${dealId}, ${deal.owner_agent_id}, ${op.amount},
                ${op.operation_date}, 'planfact', ${op.contragent || 'ПланФакт'},
                ${ctx.agentId}, ${'pf_' + opId})
        RETURNING id
      `
      await sql`
        UPDATE sales_pf_inbox SET status = 'linked', deal_id = ${dealId}, payment_id = ${Number(pay.id)}
        WHERE org_id = ${orgId} AND pf_operation_id = ${opId}
      `
      return json({ ok: true, paymentId: Number(pay.id) })
    }

    // «Не продажи»: займ, возврат, перевод — убрать из разбора
    if (action === 'pf_ignore') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      await sql`
        UPDATE sales_pf_inbox SET status = 'ignored'
        WHERE org_id = ${orgId} AND pf_operation_id = ${Number(body.inboxId)} AND status = 'new'
      `
      return json({ ok: true })
    }

    // Отвязать: поступление удаляется, операция возвращается в разбор
    if (action === 'pf_unlink') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      const opId = Number(body.inboxId)
      const [op] = await sql`
        SELECT payment_id FROM sales_pf_inbox
        WHERE org_id = ${orgId} AND pf_operation_id = ${opId} AND status = 'linked'
      `
      if (op?.payment_id) {
        await sql`DELETE FROM sales_payments WHERE id = ${Number(op.payment_id)} AND org_id = ${orgId}`
      }
      await sql`
        UPDATE sales_pf_inbox SET status = 'new', deal_id = NULL, payment_id = NULL
        WHERE org_id = ${orgId} AND pf_operation_id = ${opId}
      `
      return json({ ok: true })
    }

    if (action === 'pf_restore') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      await sql`
        UPDATE sales_pf_inbox SET status = 'new'
        WHERE org_id = ${orgId} AND pf_operation_id = ${Number(body.inboxId)} AND status = 'ignored'
      `
      return json({ ok: true })
    }

    if (action === 'adjust') {
      if (!ctx.isLead) return json({ error: 'Корректировки вносит только руководитель' }, 403)
      const agentId = String(body.agentId || '')
      const amount = Math.round(Number(body.amount))
      const reason = String(body.reason || '').trim()
      if (!agentId || !Number.isFinite(amount) || amount <= 0) return json({ error: 'нужны сотрудник и сумма' }, 400)
      if (!reason) return json({ error: 'Причина обязательна — её увидит сотрудник' }, 400)
      const [row] = await sql`
        INSERT INTO sales_kpi_adjustments (org_id, month, agent_id, amount, reason, created_by)
        VALUES (${orgId}, ${monthDate}, ${agentId}, ${amount}, ${reason}, ${ctx.agentId})
        RETURNING id
      `
      return json({ ok: true, id: Number(row.id) })
    }

    if (action === 'unadjust') {
      if (!ctx.isLead) return json({ error: 'forbidden' }, 403)
      await sql`DELETE FROM sales_kpi_adjustments WHERE id = ${Number(body.id)} AND org_id = ${orgId}`
      return json({ ok: true })
    }

    if (action === 'close') {
      if (!ctx.isLead) return json({ error: 'Закрывает месяц только руководитель' }, 403)
      const [already] = await sql`
        SELECT 1 FROM sales_kpi_closures WHERE org_id = ${orgId} AND month = ${monthDate}
      `
      if (already) return json({ error: 'Месяц уже закрыт' }, 400)
      const data = await computeMonth(sql, orgId, month)
      await sql`
        INSERT INTO sales_kpi_closures (org_id, month, payload, closed_by)
        VALUES (${orgId}, ${monthDate}, ${JSON.stringify(data)}, ${ctx.agentId})
      `
      await sql`
        UPDATE sales_kpi_templates SET status = 'closed', closed_at = NOW(), closed_by = ${ctx.agentId}
        WHERE org_id = ${orgId} AND month = ${monthDate}
      `
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
