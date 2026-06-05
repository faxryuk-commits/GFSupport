import { getSQL, json } from '../lib/db.js'
import { getRequestOrgId } from '../lib/org.js'

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
}

const VAGUE_KEYS = new Set(['не_конкретизировано', 'прочее'])

interface SubtypeRow { subtype: string; issues: number; automatablePct: number }
interface DomainRow {
  domain: string
  issues: number
  automatablePct: number
  vaguePct: number
  subtypes: SubtypeRow[]
}

export default async function handler(req: Request): Promise<Response> {
  const orgId = await getRequestOrgId(req)
  const sql = getSQL()

  try {
    const rows = await sql`
      SELECT domain, subtype, issues, automatable_pct
      FROM support_issue_taxonomy
      WHERE org_id = ${orgId}
      ORDER BY issues DESC
    ` as Array<{ domain: string; subtype: string; issues: number; automatable_pct: number }>

    if (!rows.length) {
      return json({ available: false, domains: [], snapshot: null })
    }

    // group by domain
    const map = new Map<string, DomainRow>()
    for (const r of rows) {
      let d = map.get(r.domain)
      if (!d) { d = { domain: r.domain, issues: 0, automatablePct: 0, vaguePct: 0, subtypes: [] }; map.set(r.domain, d) }
      d.subtypes.push({ subtype: r.subtype, issues: r.issues, automatablePct: r.automatable_pct })
    }
    const domains: DomainRow[] = []
    for (const d of map.values()) {
      const total = d.subtypes.reduce((s, x) => s + x.issues, 0)
      const autoWeighted = d.subtypes.reduce((s, x) => s + x.issues * x.automatablePct, 0)
      const vague = d.subtypes.filter(x => VAGUE_KEYS.has(x.subtype)).reduce((s, x) => s + x.issues, 0)
      d.issues = total
      d.automatablePct = total ? Math.round(autoWeighted / total) : 0
      d.vaguePct = total ? Math.round((100 * vague) / total) : 0
      d.subtypes.sort((a, b) => b.issues - a.issues)
      domains.push(d)
    }
    domains.sort((a, b) => b.issues - a.issues)

    // automation candidates (across all, excl vague)
    const candidates = rows
      .filter(r => r.issues >= 25 && !VAGUE_KEYS.has(r.subtype))
      .map(r => ({ domain: r.domain, subtype: r.subtype, issues: r.issues, automatablePct: r.automatable_pct }))
      .sort((a, b) => b.automatablePct - a.automatablePct)
      .slice(0, 15)

    const snapRows = await sql`
      SELECT data, computed_at FROM support_analytics_snapshot WHERE org_id = ${orgId} LIMIT 1
    ` as Array<{ data: any; computed_at: string }>
    const snapshot = snapRows[0]?.data || null
    const computedAt = snapRows[0]?.computed_at || null

    return json({ available: true, computedAt, snapshot, domains, candidates })
  } catch (e: any) {
    return json({ available: false, error: e.message, domains: [] }, 200)
  }
}
