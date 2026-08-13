/**
 * Разбор ежедневной сводки по сайту, которую присылает бот delever.io.
 *
 * Бот уже умеет считать и отправлять текст в Telegram — просить его научиться
 * ещё и структурированному формату значит менять два проекта вместо одного.
 * Поэтому принимаем ровно то сообщение, которое он и так шлёт, и разбираем на
 * поля здесь. Если бот когда-нибудь начнёт слать JSON — приёмник его тоже
 * примет, разбор просто не понадобится.
 */

export interface SiteDigest {
  day: string | null
  views: number | null
  uniques: number | null
  sessions: number | null
  median_seconds: number | null
  leads: number | null
  new_visitors: number | null
  returning_visitors: number | null
  devices: Record<string, number>
  os: Record<string, number>
  langs: Record<string, number>
  top_pages: Array<{ path: string; hits: number }>
  interests: Array<{ label: string; hits: number }>
  sources: Array<{ label: string; hits: number }>
  countries: Array<{ code: string; hits: number }>
  engagement: Array<{ path: string; hits: number }>
  hot_visitors: Array<{ country: string; score: number; signal: string; path: string }>
  ab_tests: Array<{ name: string; variant: string; visits: number; conversions: number }>
}

const num = (v: string | undefined | null): number | null => {
  if (!v) return null
  const n = parseInt(v.replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

/** «0м 46с» → 46; «2м 05с» → 125. */
function seconds(v: string | null): number | null {
  if (!v) return null
  const m = v.match(/(\d+)\s*м\s*(\d+)\s*с/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const only = v.match(/(\d+)\s*с/)
  return only ? Number(only[1]) : null
}

/** «UZ 70, AZ 9» → пары. Разделители у бота разные, поэтому оба. */
function pairs(line: string | null): Array<[string, number]> {
  if (!line) return []
  return line
    .split(/[,·]/)
    .map(chunk => chunk.trim())
    .map(chunk => {
      // Доли бот пишет с процентом: «Mobile 44%» — цифра всё равно наша
      const m = chunk.match(/^(.+?)[\s:]+(\d+)\s*%?$/)
      return m ? ([m[1].trim(), Number(m[2])] as [string, number]) : null
    })
    .filter(Boolean) as Array<[string, number]>
}

/** Строки вида «  1. / (Главная) — 66» или «  • Google: 18». */
function listItems(block: string): Array<{ label: string; hits: number }> {
  return block
    .split('\n')
    .map(l => l.trim())
    .map(l => l.replace(/^\d+\.\s*/, '').replace(/^[•·]\s*/, ''))
    .map(l => {
      const m = l.match(/^(.+?)\s*[—:-]\s*(\d+)$/)
      return m ? { label: m[1].trim(), hits: Number(m[2]) } : null
    })
    .filter(Boolean) as Array<{ label: string; hits: number }>
}

/** Кусок текста от заголовка до следующей пустой строки или конца. */
function section(text: string, header: RegExp): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => header.test(l))
  if (start === -1) return ''
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) break
    out.push(line)
  }
  return out.join('\n')
}

export function parseSiteDigest(text: string): SiteDigest {
  const t = String(text || '')

  // Дата в шапке: «Аналитика delever.io — 12.08.2026»
  const dm = t.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  const day = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null

  const line = (re: RegExp): string | null => {
    const m = t.match(re)
    return m ? m[1].trim() : null
  }

  const hot = section(t, /Горячие посетители/i)
  const hotVisitors: SiteDigest['hot_visitors'] = []
  {
    const lines = hot.split('\n').map(l => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const head = lines[i].match(/^[•·]?\s*([A-Z]{2})\s*·\s*score\s*(\d+)\s*·\s*(.+)$/i)
      if (!head) continue
      const pathLine = (lines[i + 1] || '').match(/^путь:\s*(.+)$/i)
      hotVisitors.push({
        country: head[1].toUpperCase(),
        score: Number(head[2]),
        signal: head[3].trim(),
        path: pathLine ? pathLine[1].trim() : '',
      })
    }
  }

  // A/B: «A (контроль): 18 визитов → 0 конв. (0.0%)»
  const abTests: SiteDigest['ab_tests'] = []
  {
    const lines = t.split('\n')
    let current = ''
    for (const raw of lines) {
      const l = raw.trim()
      const nameMatch = l.match(/^([^:]+):\s*$/)
      if (nameMatch && !/^[AB]\s/.test(l)) current = nameMatch[1].trim()
      // \w в JS — только латиница, поэтому «визитов» обрывалось на «визит»
      // и разбор A/B молча возвращал пусто
      const v = l.match(/^([AB])\s*\(([^)]+)\):\s*(\d+)\s*визит\S*\s*→\s*(\d+)\s*конв/i)
      if (v) {
        abTests.push({
          name: current || 'тест',
          variant: `${v[1]} (${v[2]})`,
          visits: Number(v[3]),
          conversions: Number(v[4]),
        })
      }
    }
  }

  const toMap = (arr: Array<[string, number]>) =>
    Object.fromEntries(arr) as Record<string, number>

  return {
    day,
    views: num(line(/Просмотры:\s*([\d\s]+)/)),
    uniques: num(line(/Уник\.?\s*посетители:\s*([\d\s]+)/)),
    sessions: num(line(/Сессии:\s*([\d\s]+)/)),
    median_seconds: seconds(line(/Медиан\.?\s*время:\s*(.+)/)),
    leads: num(line(/Лидов:\s*([\d\s]+)/)),
    new_visitors: num(line(/Новые:\s*([\d\s]+)/)),
    returning_visitors: num(line(/Возвращ\.?:?\s*([\d\s]+)/)),
    devices: toMap(pairs(line(/Устройства:\s*(.+)/)).map(([k, v]) => [k.replace(/\s*\d+%$/, '').trim(), v])),
    os: toMap(pairs(line(/ОС:\s*(.+)/))),
    langs: toMap(pairs(line(/Языки:\s*(.+)/))),
    top_pages: listItems(section(t, /Топ страниц/i)).map(x => ({ path: x.label, hits: x.hits })),
    interests: listItems(section(t, /Интересы посетителей/i)),
    sources: listItems(section(t, /Источники трафика/i)),
    countries: pairs(line(/Страны:\s*(.+)/)).map(([code, hits]) => ({ code, hits })),
    engagement: listItems(section(t, /Вовлечённость/i)).map(x => ({ path: x.label, hits: x.hits })),
    hot_visitors: hotVisitors,
    ab_tests: abTests,
  }
}
