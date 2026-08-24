import { logEvent } from './system-journal.js'

/**
 * Автораспределение каналов по регионам.
 *
 * 457 каналов размечали руками, 40 остались «без региона» — и такие каналы
 * выпадают из региональных срезов. Регион почти всегда виден из самой
 * переписки: язык (казахские ә/і/ң/ү/ұ против узбекских ў/ҳ и латиницы
 * с oʻ/gʻ), упомянутые инструменты (Kaspi — Казахстан, Payme/Uzum —
 * Узбекистан) и страна прямо в названии группы.
 *
 * Правила безопасности:
 *  - трогаем ТОЛЬКО каналы с пустым market_id — ручной выбор не перезаписывается;
 *  - назначаем только при уверенном сигнале (≥5 голосов и ≥80% за один регион),
 *    сомнительное остаётся пустым;
 *  - каждое назначение — событие в Хронике, откатывается одним кликом в канале.
 */

const NAME_HINTS: Array<[RegExp, string]> = [
  [/kyrgyzstan|кыргызстан|bishkek|бишкек/i, 'kg'],
  [/kazakhstan|казахстан|almaty|алматы|астана|astana|shymkent|шымкент/i, 'kz'],
  [/azerbaijan|азербайджан|baku|баку/i, 'az'],
  [/dubai|дубай|\buae\b|эмират/i, 'ae'],
  [/georgia|грузия|tbilisi|тбилиси/i, 'ge'],
]

export async function autoAssignChannelMarkets(sql: any, orgId: string): Promise<number> {
  const markets = await sql`SELECT id, code FROM support_markets` as any[]
  const byCode: Record<string, string> = {}
  for (const m of markets) byCode[(m.code || '').toLowerCase()] = m.id
  if (!byCode.uz && !byCode.kz) return 0

  // Сигналы одной пачкой по всем безрегионным каналам: язык + инструменты
  const rows = await sql`
    SELECT ch.id, ch.name,
      COUNT(*) FILTER (WHERE m.text_content ~* '[әіңүұ]|рахмет|тапсырыс')::int kz_lang,
      COUNT(*) FILTER (WHERE m.text_content ~* '[ўҳ]|(oʻ|o''|gʻ|g'')|rahmat|raxmat|buyurtma|tushunarli|ishlamayapti')::int uz_lang,
      COUNT(*) FILTER (WHERE m.text_content ~* 'kaspi|каспи|halyk|халык')::int kz_inst,
      COUNT(*) FILTER (WHERE m.text_content ~* 'payme|пайме|uzum|узум|atmos|eskiz')::int uz_inst
    FROM support_channels ch
    LEFT JOIN support_messages m ON m.channel_id = ch.id
      AND m.text_content IS NOT NULL AND m.created_at > NOW() - INTERVAL '180 days'
    WHERE ch.org_id = ${orgId} AND ch.is_active = true AND ch.market_id IS NULL
      AND COALESCE(ch.type, '') <> 'feed'
    GROUP BY ch.id, ch.name
  ` as any[]

  let assigned = 0
  for (const ch of rows) {
    let code: string | null = null
    let why = ''

    for (const [re, c] of NAME_HINTS) {
      if (re.test(ch.name || '')) { code = c; why = 'страна в названии группы'; break }
    }

    if (!code) {
      const uzV = Number(ch.uz_lang) + Number(ch.uz_inst) * 2
      const kzV = Number(ch.kz_lang) + Number(ch.kz_inst) * 2
      const total = uzV + kzV
      if (total >= 5 && uzV >= total * 0.8) {
        code = 'uz'; why = `язык и инструменты переписки (${uzV} голосов)`
      } else if (total >= 5 && kzV >= total * 0.8) {
        code = 'kz'; why = `язык и инструменты переписки (${kzV} голосов)`
      }
    }

    const marketId = code ? byCode[code] : null
    if (!marketId) continue

    await sql`UPDATE support_channels SET market_id = ${marketId}
      WHERE id = ${ch.id} AND org_id = ${orgId} AND market_id IS NULL`
    await logEvent(sql, 'Регионовед', 'канал распределён',
      `${(ch.name || ch.id).slice(0, 80)} → ${code.toUpperCase()}: ${why}`, ch.id)
    assigned++
  }
  return assigned
}

/**
 * Регион бренда по выбранным инструментам заявки: если все размеченные
 * поставщики из ТЗ принадлежат одному региону — это и есть регион бренда.
 */
export async function inferBrandMarket(sql: any, orgId: string, optionIds: string[]): Promise<string | null> {
  if (!optionIds.length) return null
  try {
    const tagged = await sql`
      SELECT DISTINCT markets FROM onboarding_options
      WHERE org_id = ${orgId} AND id = ANY(${optionIds}) AND markets IS NOT NULL
    ` as any[]
    const uniq = [...new Set(tagged.flatMap((r: any) => String(r.markets).split(',').filter(Boolean)))]
    return uniq.length === 1 ? uniq[0] : null
  } catch {
    return null
  }
}
