/**
 * Атрибуция лидов Meta: кампания, группа, объявление — по номеру лида.
 *
 * Заявка с лид-формы приезжает через Amo, и в поле «кампания» у неё лежит
 * «Facebook №882336018148488» — это не кампания, а номер самого лида
 * (leadgen_id). У каждого свой, «кампаний» получалось столько же, сколько
 * лидов, и сравнивать было нечего. Настоящие кампания, группа объявлений
 * и креатив достаются у Meta по этому номеру — право leads_retrieval
 * одобрено на App Review 14.09.2026.
 *
 * Тот же номер нужен обратной петле: событие с точным lead_id Meta
 * сопоставляет с рекламой без промахов, а по хешу телефона — как получится
 * (11 из 84 событий уходили в no_match).
 *
 * Meta хранит лиды 90 дней: старше — не достать, помечаем и не долбим.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'
const FIELDS = 'campaign_name,adset_name,ad_name,campaign_id,ad_id,platform'

/** Номер лида Meta из служебных названий Amo: «Facebook №882336018148488». */
export function metaLeadIdFrom(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const m = String(c || '').match(/^Facebook №(\d{12,})$/)
    if (m) return m[1]
  }
  return null
}

export interface EnrichResult { checked: number; enriched: number; gone: number; error: string | null }

/**
 * Дообогатить лиды без атрибуции. Пачка до 50 номеров одним запросом
 * (?ids=…): Graph отдаёт словарь id → поля, недоступные — с ошибкой
 * внутри словаря, а не всем запросом.
 */
export async function enrichMetaLeads(sql: any, orgId: string, limit = 50): Promise<EnrichResult> {
  const { readMetaConfig } = await import('./meta-config.js')
  const cfg = await readMetaConfig(orgId)
  const token = cfg.userToken || cfg.pageToken || cfg.capiToken
  if (!token) return { checked: 0, enriched: 0, gone: 0, error: 'нет токена Meta' }

  const rows = await sql`
    SELECT id, meta_lead_id FROM sales_leads
    WHERE org_id = ${orgId} AND meta_lead_id IS NOT NULL AND meta_enriched_at IS NULL
    ORDER BY created_at DESC LIMIT ${Math.min(50, Math.max(1, limit))}
  ` as Array<{ id: string; meta_lead_id: string }>
  if (!rows.length) return { checked: 0, enriched: 0, gone: 0, error: null }

  const ids = rows.map(r => r.meta_lead_id).join(',')
  const res = await fetch(`${GRAPH}/?ids=${ids}&fields=${FIELDS}&access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20000),
  })
  const data: any = await res.json().catch(() => null)
  if (!res.ok || !data || data.error) {
    return { checked: rows.length, enriched: 0, gone: 0, error: String(data?.error?.message || `HTTP ${res.status}`).slice(0, 200) }
  }

  let enriched = 0, gone = 0
  for (const r of rows) {
    const d = data[r.meta_lead_id]
    if (!d || d.error || !d.campaign_id) {
      // Лид старше 90 дней или недоступен — помечаем, чтобы не спрашивать снова
      await sql`UPDATE sales_leads SET meta_enriched_at = NOW() WHERE id = ${r.id}`
      gone++
      continue
    }
    await sql`
      UPDATE sales_leads SET
        campaign = ${String(d.campaign_name || '').slice(0, 255) || null},
        ad_id = ${d.ad_id ? String(d.ad_id) : null},
        meta_campaign_id = ${String(d.campaign_id)},
        meta_adset = ${String(d.adset_name || '').slice(0, 200) || null},
        meta_ad = ${String(d.ad_name || '').slice(0, 200) || null},
        meta_platform = ${d.platform ? String(d.platform).slice(0, 10) : null},
        meta_enriched_at = NOW()
      WHERE id = ${r.id}
    `
    enriched++
  }
  return { checked: rows.length, enriched, gone, error: null }
}
