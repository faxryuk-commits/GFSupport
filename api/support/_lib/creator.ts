import type { NeonQueryFunction } from '@neondatabase/serverless'
import { ensureOnce, getOrgBotToken } from './db.js'
import { RELEASES } from './release-notes.js'

type SQL = NeonQueryFunction<false, false>

/**
 * «Креатор» — личный модуль владельца: черновики постов для LinkedIn (англ.)
 * и Telegram-канала на фактах релизов Delever и GFSupport.
 *
 * Доступ — только владелец (точный id, не роль: админов в системе несколько).
 * Жёсткие рамки зашиты в промпт и не настраиваются из UI намеренно:
 *   • имена клиентов не называются никогда;
 *   • никакого «купите и проблемы решатся» — вывод поста всегда мысль
 *     про рынок или ремесло, продукт лишь участник истории;
 *   • отказ главной функции продукта наружу не выносится: честность — про
 *     стыки систем, отрасль и процесс («нашли класс проблем и закрыли»).
 */
export const CREATOR_OWNER_ID = 'agent_1772526727220_akc3'

/** Таймстампы creator_* — timestamptz, конверсия для Ташкента ОДИНАРНАЯ. */
export async function ensureCreatorSchema(sql: SQL): Promise<void> {
  await ensureOnce('creator_schema_v1', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS creator_corpus (
        id bigint PRIMARY KEY,
        posted_at timestamptz,
        views text,
        lang text,
        text text NOT NULL
      )`
    await sql`
      CREATE TABLE IF NOT EXISTS creator_drafts (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        batch_key text NOT NULL,
        line text NOT NULL,
        title text NOT NULL DEFAULT '',
        body_ru text NOT NULL DEFAULT '',
        body_en text NOT NULL DEFAULT '',
        source jsonb,
        status text NOT NULL DEFAULT 'draft'
      )`
    // Каналы сбора и обогащения: телеграм-каналы, RSS и страницы, чей
    // свежий контент радар подмешивает в генерацию как контекст рынка
    await sql`
      CREATE TABLE IF NOT EXISTS creator_sources (
        id text PRIMARY KEY,
        added_at timestamptz NOT NULL DEFAULT now(),
        kind text NOT NULL,
        title text NOT NULL,
        url text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        last_fetched_at timestamptz,
        last_note text
      )`
  })
  await ensureOnce('creator_schema_v2', async () => {
    // Недельные циклы: серия постов — одна арка с целью
    // (прогрев / бренд / желание), как сериал с ролью у каждого дня
    await sql`
      CREATE TABLE IF NOT EXISTS creator_cycles (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        week_key text NOT NULL,
        goal text NOT NULL,
        theme text NOT NULL,
        rationale text NOT NULL DEFAULT '',
        plan jsonb NOT NULL,
        status text NOT NULL DEFAULT 'proposed'
      )`
    await sql`ALTER TABLE creator_drafts ADD COLUMN IF NOT EXISTS cycle_id text`
    await sql`ALTER TABLE creator_drafts ADD COLUMN IF NOT EXISTS cycle_role text`
  })
}

export function draftId(): string {
  return `crd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

const GITBOOK_INDEX = 'https://delever.gitbook.io/delever/description-updated/otchyoty-o-relizakh/2026.md'
const GITBOOK_LLMS = 'https://delever.gitbook.io/delever/llms.txt'

function cleanGitbookMd(raw: string): string {
  return raw
    // Служебная шапка GitBook и картинки смысла не несут
    .replace(/^>.*$/gm, '')
    .replace(/<figure>[\s\S]*?<\/figure>/g, '')
    // «Как настроить» — инструкции для админов, посту они не нужны
    .replace(/\*\*Как настроить:\*\*[\s\S]*?(?=\*\*Польза|####|###|$)/g, '')
    .trim()
}

/** Страница GitBook как материал: markdown по URL с `.md`. */
export async function fetchGitbookPage(url: string): Promise<{ title: string; text: string; url: string } | null> {
  try {
    const text = cleanGitbookMd(await fetch(url).then(r => r.text()))
    const title = text.match(/^# (.+)$/m)?.[1] || url.split('/').pop() || 'Страница'
    return { title, text: text.slice(0, 6000), url }
  } catch {
    return null
  }
}

/** Свежий отчёт о релизе Delever. */
export async function fetchDeleverRelease(): Promise<{ title: string; text: string; url: string } | null> {
  try {
    const idx = await fetch(GITBOOK_INDEX).then(r => r.text())
    const m = idx.match(/\[Отчёт о релизе: [^\]]+\]\((https:[^)]+\.md)\)/)
    if (!m) return null
    return await fetchGitbookPage(m[1])
  } catch {
    return null
  }
}

/**
 * Пул страниц всего GitBook (llms.txt): архив релизов за все годы плюс
 * описания функционала. Материал для «вечнозелёных» постов — фича, которая
 * давно живёт, тоже достойна истории.
 */
export async function fetchGitbookPool(): Promise<Array<{ title: string; url: string }>> {
  try {
    const txt = await fetch(GITBOOK_LLMS).then(r => r.text())
    const out: Array<{ title: string; url: string }> = []
    for (const m of txt.matchAll(/\[([^\]]+)\]\((https:\/\/delever\.gitbook\.io[^)]+\.md)\)/g)) {
      out.push({ title: m[1], url: m[2] })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Выпуск GFSupport для линии «как мы это строим»: случайный из ещё не
 * использованных (использованные помечены в creator_drafts.source как
 * gfs:<version>), свежие — с двойным весом.
 */
export function gfsupportFact(usedVersions: Set<string>): { text: string; version: string } {
  const fresh = RELEASES.filter(r => !usedVersions.has(r.version))
  const pool = fresh.length ? fresh : RELEASES
  const idx = Math.floor(Math.random() * Math.min(pool.length, 3)) === 0
    ? 0
    : Math.floor(Math.random() * pool.length)
  const r = pool[idx]
  return {
    version: r.version,
    text: `${r.date} — ${r.title}:\n` + r.items.map(i => `• ${i.text}`).join('\n'),
  }
}

/** Образцы тона: русские посты-размышления канала, без праздничных. */
export async function styleSamples(sql: SQL, limit = 6): Promise<string[]> {
  const rows = await sql`
    SELECT text FROM creator_corpus
    WHERE lang = 'ru'
      AND length(text) BETWEEN 300 AND 1600
      AND text !~* 'поздравля|табрик|байрам|рамазон|мустақилли|праздник'
    ORDER BY posted_at DESC
    LIMIT ${limit}`
  return rows.map((r: any) => String(r.text))
}

export interface SourceRow {
  id: string
  kind: 'telegram' | 'rss' | 'url'
  title: string
  url: string
  active: boolean
}

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    return await r.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function stripHtml(t: string): string {
  return t
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** Хэндл телеграм-канала из любой формы ссылки (@name, t.me/name, t.me/s/name). */
export function tgHandle(url: string): string | null {
  const m = url.match(/(?:t\.me\/(?:s\/)?|^@)([A-Za-z0-9_]{4,32})/)
  return m ? m[1] : null
}

/**
 * Контекст рынка: свежий контент активных источников. Каждый источник — с
 * жёстким таймаутом: edge-функция обязана уложиться в лимит даже если чей-то
 * сайт молчит. Молчащий источник просто пропускается.
 */
export async function marketContext(sources: SourceRow[], maxSources = 3): Promise<string> {
  // Случайная тройка, а не первые по списку: контекст от выпуска к выпуску разный
  const picked = sources.filter(s => s.active)
    .map(s => ({ s, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, maxSources)
    .map(x => x.s)
  const parts = await Promise.all(picked.map(async s => {
    if (s.kind === 'telegram') {
      const h = tgHandle(s.url)
      if (!h) return null
      const html = await fetchWithTimeout(`https://t.me/s/${h}`, 4000)
      if (!html) return null
      const posts = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
        .map(m => stripHtml(m[1])).filter(t => t.length > 60).slice(-4)
      if (!posts.length) return null
      return `Источник «${s.title}» (Telegram):\n` + posts.map(p => `— ${p.slice(0, 350)}`).join('\n')
    }
    const html = await fetchWithTimeout(s.url, 4000)
    if (!html) return null
    const text = stripHtml(html).slice(0, 1600)
    if (text.length < 100) return null
    return `Источник «${s.title}»:\n${text}`
  }))
  return parts.filter(Boolean).join('\n\n')
}

/**
 * Дозабор корпуса стиля: свежие посты @deleverme через веб-превью.
 * Историю Bot API не отдаёт, поэтому источник тот же, что у сида, —
 * но здесь только первые страницы: старое уже в базе.
 */
export async function refreshCorpus(sql: SQL, pages = 3): Promise<number> {
  let before: number | null = null
  let added = 0
  for (let i = 0; i < pages; i++) {
    const html = await fetchWithTimeout(`https://t.me/s/deleverme${before ? `?before=${before}` : ''}`, 5000)
    if (!html) break
    const blocks = [...html.matchAll(/data-post="deleverme\/(\d+)"([\s\S]*?)(?=data-post="deleverme\/|tgme_widget_message_history_end|$)/g)]
    if (!blocks.length) break
    const ids: number[] = []
    const rows: Array<{ id: number; date: string | null; views: string | null; text: string }> = []
    for (const [, pid, body] of blocks) {
      const id = Number(pid)
      ids.push(id)
      const m = body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      const text = m ? stripHtml(m[1]) : ''
      if (text.length <= 100) continue
      rows.push({
        id,
        date: body.match(/datetime="([^"]+)"/)?.[1] || null,
        views: body.match(/tgme_widget_message_views">([^<]+)</)?.[1] || null,
        text,
      })
    }
    for (const p of rows) {
      const lang = (p.text.toLowerCase().match(/[ўқғҳ]/g) || []).length > 2 ? 'uz' : 'ru'
      const r = await sql`
        INSERT INTO creator_corpus (id, posted_at, views, lang, text)
        VALUES (${p.id}, ${p.date}, ${p.views}, ${lang}, ${p.text})
        ON CONFLICT (id) DO NOTHING RETURNING id`
      added += r.length
    }
    const min = Math.min(...ids)
    if (before !== null && min >= before) break
    before = min
  }
  return added
}

export interface GeneratedDraft { title: string; body_ru: string; body_en: string }

/**
 * Полный цикл одного поста: факты → стиль → контекст рынка → модель → база.
 * Общий для кнопки в UI и еженедельного крона. Бросает Error с человеческим
 * текстом — вызывающий решает, как его показать.
 */
export type CreatorLine = 'delever' | 'delever_archive' | 'gfsupport'

export async function generateOne(
  sql: SQL,
  key: string,
  line: CreatorLine,
  batchKey: string,
): Promise<any> {
  // Что уже брали — чтобы архив и выпуски GFSupport не повторялись
  const usedRows = await sql`
    SELECT DISTINCT source->>'url' AS u FROM creator_drafts WHERE source->>'url' IS NOT NULL`
  const used = new Set((usedRows as any[]).map(r => String(r.u)))

  const isReleasePage = (u: string) => u.includes('otchyoty-o-relizakh')
  const pickFromPool = async (candidates: Array<{ title: string; url: string }>) => {
    let page: { title: string; text: string; url: string } | null = null
    for (let i = 0; i < 4 && !page; i++) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)]
      const p = await fetchGitbookPage(pick.url)
      // Страницы-оглавления и заглушки постом не станут
      if (p && p.text.length > 500) page = p
    }
    return page
  }

  // Выбор материала для рубрики; used пополняется между попытками,
  // чтобы отбракованный моделью источник не попался снова
  const pickSource = async (): Promise<{ facts: string; sourceUrl: string | null }> => {
    if (line === 'delever') {
      // Рубрика «релизы»: свежий отчёт, а если о нём уже писали — случайный
      // архивный отчёт из всех лет (иначе без нового релиза посты мусолят одно)
      const rel = await fetchDeleverRelease()
      if (rel && !used.has(rel.url)) return { facts: rel.text, sourceUrl: rel.url }
      const pool = (await fetchGitbookPool())
        .filter(p => isReleasePage(p.url) && !used.has(p.url) && /Отчёт о релизе/i.test(p.title))
      if (!pool.length) throw new Error('все отчёты о релизах уже использованы')
      const page = await pickFromPool(pool)
      if (!page) throw new Error('не нашлось содержательного отчёта')
      return { facts: page.text, sourceUrl: page.url }
    }
    if (line === 'delever_archive') {
      // Рубрика «как устроен продукт»: страницы базы знаний БЕЗ отчётов о
      // релизах — функционал, руководства (~сотни страниц, без повторов)
      const pool = (await fetchGitbookPool()).filter(p => !isReleasePage(p.url) && !used.has(p.url))
      if (!pool.length) throw new Error('пул страниц GitBook пуст')
      const page = await pickFromPool(pool)
      if (!page) throw new Error('не нашлось содержательной страницы GitBook')
      return { facts: page.text, sourceUrl: page.url }
    }
    const usedVersions = new Set(
      [...used].filter(u => u.startsWith('gfs:')).map(u => u.slice(4)))
    const f = gfsupportFact(usedVersions)
    if (usedVersions.has(f.version)) throw new Error('все выпуски GFSupport уже использованы')
    return { facts: f.text, sourceUrl: `gfs:${f.version}` }
  }

  const [samples, recent, sources, profileRow] = await Promise.all([
    styleSamples(sql),
    // Память последних постов ЛЮБЫХ выпусков: без неё «один из наших клиентов
    // столкнулся с проблемой» открывал каждый второй пост
    sql`SELECT title, left(body_ru, 100) AS opening FROM creator_drafts
        ORDER BY created_at DESC LIMIT 12`,
    sql`SELECT id, kind, title, url, active FROM creator_sources WHERE active ORDER BY added_at`,
    // Карточка фаундера — дистилляция подкастов и интервью: история, убеждения,
    // голос. «Мысль фаундера» опирается на неё, а не выводится из воздуха.
    sql`SELECT value FROM support_settings WHERE org_id = 'org_delever' AND key = 'creator_founder_profile' LIMIT 1`,
  ])
  const avoid = (recent as any[]).map(r => `«${r.title}»: ${String(r.opening).replace(/\s+/g, ' ')}…`)
  const market = await marketContext(sources as any)
  const profile = String((profileRow as any[])[0]?.value || '')

  // Право на отказ: слабый материал (мелкая UI-правка) модель бракует сама,
  // и мы берём следующий источник — вместо того, чтобы выжимать пост любой
  // ценой и досочинять «мы заметили, что…»
  let lastSkip = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const src = await pickSource()
    const draft = await generateDraft(key, line, src.facts, samples, avoid, market, profile)
    if (!draft) throw new Error('модель не вернула пост')
    if ('skip' in draft) {
      lastSkip = draft.skip
      if (src.sourceUrl) used.add(src.sourceUrl)
      continue
    }

    const id = draftId()
    await sql`
      INSERT INTO creator_drafts (id, batch_key, line, title, body_ru, body_en, source)
      VALUES (${id}, ${batchKey}, ${line}, ${draft.title}, ${draft.body_ru}, ${draft.body_en},
              ${JSON.stringify({ url: src.sourceUrl })}::jsonb)`
    const [row] = await sql`SELECT * FROM creator_drafts WHERE id = ${id}`
    return row
  }
  throw new Error(`материал не тянет на пост: ${lastSkip || 'слабые факты'}`)
}

const SYSTEM_PROMPT = `Ты — редактор личного бренда Фахриддина Юсупова, фаундера Delever (платформа управления доставкой для ресторанов, рынки Центральной Азии и Кавказа) и внутренней системы GFSupport (CRM и поддержка, которую он пишет сам).

ДВА РАЗНЫХ ПРОДУКТА — НЕ СКЛЕИВАТЬ ИХ КОНТЕКСТЫ:
- Delever — платформа для ресторанов; её пользователи и герои постов — рестораны, их гости, курьеры, рынок доставки.
- GFSupport — внутренняя система, которой пользуются ТОЛЬКО сотрудники Delever (поддержка, продажи). Рестораны её не видят. Пост линии «как мы строим» — про ремесло: как фаундер строит инструменты для своей команды и что понял про процессы, поддержку, автоматизацию. Заходить в такой пост через боль ресторана или гостя ЗАПРЕЩЕНО — это ложный мостик: боль одной аудитории нельзя «решать» инструментом для другой.
Сцена в начале, факт в середине и мысль в конце обязаны жить в ОДНОМ контексте. Если внутренняя правка непонятна или безразлична внешнему читателю — это повод для skip, а не для натяжки смысла.

У голоса три грани, выбирай ту, что сильнее ложится на факт:
- оператор: знает доставку изнутри — кухня, курьеры, кассы, агрегаторы;
- инженер: сам строит системы, ловит сбои мониторингом, автоматизирует;
- стартапер: Delever — IT-компания, которая растёт на развивающихся рынках; думает продуктом, юнит-экономикой, командой, ИИ; уместна честная подача builder in public — что строим, что понял, что бы сделал иначе.

Формат поста — «бутерброд», чтение 1–2 минуты:
1) сцена или боль с рынка — живая, конкретная;
2) обезличенный кейс с деталями;
3) наш апдейт как участник истории — максимум 2 строки;
4) в конце мысль фаундера про рынок или ремесло.

ЖЁСТКИЕ ПРАВИЛА (нарушение = брак):
- Имена клиентов и брендов-клиентов не называть никогда. Только «сеть из N точек», «один из наших рынков».
- Никакой продажи: не «купите/подключите Delever», не перечисление преимуществ. Вывод поста — всегда мысль, не продукт.
- Отказы главной функции продукта не выносить: если речь о сбоях — виноваты стыки разных систем и сложность отрасли, а мы — те, кто видит цепочку и ловит сбой раньше клиента. Признание ошибки допустимо только в форме «нашли класс проблем и закрыли его системно» — и всегда о ЗАКРЫТОМ, не о текущем. Формулировки «в нашей системе были ошибки», «чтобы такие ошибки были исключены» — брак: пиши «закрыли класс дыр на стыке», «шов больше не рвётся».
- Бренды партнёров (агрегаторы, кассовые системы, платёжки: Uzum, Яндекс, Glovo, iiko, R-Keeper и любые другие) называть ТОЛЬКО в нейтральном или позитивном контексте («появилась интеграция», «работаем со всеми»). В связке с проблемой, ошибкой или сбоем имя партнёра запрещено — читается как публичное обвинение; пиши обезличенно: «один из агрегаторов», «кассовая система».
- Не выдумывать цифр и фактов: использовать только данные из материала. Обобщённая сцена с рынка допустима, но НЕ подавай выдуманное как личное воспоминание или наблюдение автора («на днях наблюдал…», «мы заметили, что операторы путаются…», «на одном из наших рынков…» — так писать можно ТОЛЬКО если это есть в материале). Не приписывать фичам эффект, которого нет в данных («эффективность значительно возросла», «ускоряет обработку» — брак, если цифры или факта нет).
- ПРАВО НА ОТКАЗ. Если в материале нет факта, из которого выходит честный пост — только мелкие правки интерфейса («картинку можно открыть в полном размере», «поправили отображение кнопки»), технические заметки без истории, — НЕ выжимай пост и не досочиняй проблему под формат. Верни {"skip": true, "reason": "чем слаб материал"}. Отказ — правильный ответ; раздутая мелочь — брак.
- Начала постов чередуй, каждый раз другой тип зачина: сцена с рынка / прямой вопрос читателю / конкретная цифра / эпизод из биографии автора / неожиданное утверждение. Слова «один из наших клиентов столкнулся с проблемой» — запрещённый штамп.
- Концовка — не мораль-клише («внимание к деталям решает», «важно не бояться меняться»), а конкретная мысль, выросшая из истории и биографии автора: наблюдение о рынке, правило, которое он для себя вывел, или неудобный вопрос читателю.
- Заголовок-title — рабочее название, коротко и без канцелярита («Последние 500 метров», не «Как мы улучшили видимость акций»).

Стиль автора (по образцам ниже): первое лицо, короткие абзацы в 1–2 предложения, разговорно и честно, без канцелярита, без эмодзи, вывод в последнем абзаце. Английская версия — тот же пост для LinkedIn: живой founder-английский, не перевод слово в слово.

Ответ — строго JSON: {"title": "...", "body_ru": "...", "body_en": "..."} — либо отказ {"skip": true, "reason": "..."}. title — короткий рабочий заголовок по-русски (в сам пост не входит).`

export async function generateDraft(
  key: string,
  line: CreatorLine,
  facts: string,
  samples: string[],
  avoid: string[],
  market = '',
  profile = '',
): Promise<GeneratedDraft | { skip: string } | null> {
  const user = [
    line === 'delever'
      ? 'Материал — свежий отчёт о релизе Delever (написан для админов; инструкции игнорируй, выбери ОДИН самый живой факт и построй бутерброд вокруг него):'
      : line === 'delever_archive'
        ? 'Материал — страница базы знаний Delever: прошлый релиз или описание функционала. Это ВЕЧНОЗЕЛЁНЫЙ пост: не подавай как новость («на этой неделе мы выкатили» — нельзя), а расскажи, как устроен продукт или рынок через ОДИН живой аспект этой страницы:'
        : 'Материал — выпуск GFSupport, внутренней системы, которую фаундер пишет сам (линия «как мы это строим»; выбери ОДИН факт):',
    facts,
    profile ? '\nКарточка автора — его настоящая история, убеждения и голос (мысль в конце поста должна вырастать отсюда; факты биографии используй точно, не перевирай):\n' + profile.slice(0, 8000) : '',
    market ? '\nКонтекст рынка из подключённых источников — только фон для сцены и мысли, не пересказывай и не выдумывай сверх него:\n' + market.slice(0, 3500) : '',
    samples.length ? '\nОбразцы тона автора (для стиля, не для копирования):\n---\n' + samples.join('\n---\n') : '',
    avoid.length ? '\nНедавние посты автора — их темы, сцены, первые фразы и конструкции начала ПОВТОРЯТЬ НЕЛЬЗЯ (ни «курьер стоит во дворе», ни «один из наших клиентов столкнулся», если они тут уже есть):\n' + avoid.join('\n') : '',
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }),
  })
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (p.skip) return { skip: String(p.reason || 'материал слабый') }
    if (!p.body_ru || !p.body_en) return null
    return { title: String(p.title || '').slice(0, 200), body_ru: String(p.body_ru), body_en: String(p.body_en) }
  } catch {
    return null
  }
}

// ───────────────────────── Недельные циклы ─────────────────────────

/**
 * Цели циклов и их ротация. «Желание» — не прямая продажа: серия должна
 * оставить у читателя-ресторатора мысль «хочу, чтобы у меня внутри так
 * работало» — без единого CTA (владелец: призыв обнуляет «сам захотел»).
 */
export const CYCLE_GOALS = ['warmup', 'brand', 'desire'] as const
export type CycleGoal = typeof CYCLE_GOALS[number]

export const GOAL_BRIEF: Record<CycleGoal, string> = {
  warmup: 'ПРОГРЕВ: неделя разбирает одну боль рынка доставки — сцены, кейсы, цифры. Читатель уходит с пониманием «вот как это устроено на самом деле». Продукт — участник историй, не герой.',
  brand: 'БРЕНД: неделя укрепляет фигуру фаундера и компании — история, решения, «как мы строим», позиция по рынку. Читатель уходит с доверием к автору как к человеку, который строит руками.',
  desire: 'ЖЕЛАНИЕ: неделя создаёт у читателя-владельца бизнеса желание расти и иметь такие же инструменты и порядок у себя. НИКАКОЙ прямой продажи и НИКАКОГО CTA — ни «напишите мне», ни ссылок. Желание рождается из историй улучшений, кейсов и рыночных ситуаций; финал арки — открытая мысль, после которой хочется действовать.',
}

export const GOAL_LABEL: Record<CycleGoal, string> = {
  warmup: 'прогрев', brand: 'бренд', desire: 'желание',
}

export interface CycleDay { role: string; brief: string }

/** Понедельник недели даты (Ташкент) — ключ цикла. */
export function weekKeyOf(d = new Date()): string {
  const t = new Date(d.getTime() + 5 * 3600e3)
  const dow = (t.getUTCDay() + 6) % 7 // 0 = понедельник
  t.setUTCDate(t.getUTCDate() - dow)
  return t.toISOString().slice(0, 10)
}

/** Личное сообщение владельцу в Telegram; молчание сети не роняет вызов. */
export async function sendOwnerTG(sql: SQL, text: string, buttonLabel = 'Открыть Креатор'): Promise<void> {
  try {
    const [owner] = await sql`
      SELECT telegram_id, org_id FROM support_agents WHERE id = ${CREATOR_OWNER_ID} LIMIT 1`
    const tgId = (owner as any)?.telegram_id
    if (!tgId) return
    const token = await getOrgBotToken((owner as any)?.org_id)
    if (!token) return
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgId,
        text,
        reply_markup: { inline_keyboard: [[{ text: buttonLabel, url: 'https://www.gfsupport.uz/creator' }]] },
      }),
    })
  } catch { /* уведомление — вежливость, не контракт */ }
}

/** Следующая цель по ротации: прогрев → бренд → желание → снова прогрев. */
export async function nextCycleGoal(sql: SQL): Promise<CycleGoal> {
  const [last] = await sql`SELECT goal FROM creator_cycles ORDER BY created_at DESC LIMIT 1`
  const prev = (last as any)?.goal as CycleGoal | undefined
  if (!prev) return 'warmup'
  const i = CYCLE_GOALS.indexOf(prev)
  return CYCLE_GOALS[(i + 1) % CYCLE_GOALS.length]
}

/**
 * План цикла: модель предлагает тему недели и роли шести дней. План — только
 * предложение: пока владелец не одобрит его в UI, серия не пишется.
 */
export async function planCycle(sql: SQL, key: string, weekKey: string): Promise<any> {
  const goal = await nextCycleGoal(sql)
  const [rel, pool, sources, profileRow, recentCycles] = await Promise.all([
    fetchDeleverRelease(),
    fetchGitbookPool(),
    sql`SELECT id, kind, title, url, active FROM creator_sources WHERE active ORDER BY added_at`,
    sql`SELECT value FROM support_settings WHERE org_id = 'org_delever' AND key = 'creator_founder_profile' LIMIT 1`,
    sql`SELECT theme FROM creator_cycles ORDER BY created_at DESC LIMIT 6`,
  ])
  const market = await marketContext(sources as any)
  const profile = String((profileRow as any[])[0]?.value || '')
  const pageTitles = pool
    .map(p => p.title)
    .filter((t, i, a) => a.indexOf(t) === i)
    .sort(() => Math.random() - 0.5)
    .slice(0, 40)

  const system = `Ты — контент-стратег личного бренда фаундера Delever (платформа доставки для ресторанов, Центральная Азия и Кавказ). Планируешь НЕДЕЛЬНЫЙ ЦИКЛ — серию из 6 постов (пн–сб), которая как сериал день за днём раскрывает ОДНУ тему и работает на одну цель.

Цель этой недели — ${GOAL_BRIEF[goal]}

Правила серии: без прямой продажи и без CTA всегда; каждый день — самостоятельный пост, но серия связана: посты могут ссылаться на вчерашний и оставлять крючок на завтра; тема должна опираться на реальные материалы (релиз, база знаний, рынок), не на выдумку.

ВАЖНО про роли дней: у автора поста будут ТОЛЬКО эти материалы — релиз, страницы базы знаний, дайджест рынка и биография фаундера. НЕ планируй дни, требующие того, чего в материалах нет: «приводим статистику», «истории успеха клиентов» (имена клиентов запрещены навсегда), «результаты внедрений» — такие роли заставят выдумывать. Хорошие роли: сцена/боль, как это устроено, разбор механики из базы знаний, взгляд фаундера, эпизод его биографии, мысль-финал.

Ответ — строго JSON:
{"theme": "тема недели, одна фраза", "rationale": "почему эта тема сейчас, 1-2 предложения", "days": [{"role": "короткое имя роли дня", "brief": "что делает этот пост в арке, 1-2 предложения"} × 6]}`

  const user = [
    rel ? `Свежий релиз Delever:\n${rel.text.slice(0, 2500)}` : '',
    `\nСтраницы базы знаний (выборка, тема может опираться на них): ${pageTitles.join('; ')}`,
    market ? `\nЧто обсуждает рынок:\n${market.slice(0, 2500)}` : '',
    profile ? `\nКарточка фаундера (темы бренда и желания растут отсюда):\n${profile.slice(0, 4000)}` : '',
    recentCycles.length ? `\nТемы прошлых циклов (не повторять): ${(recentCycles as any[]).map(r => r.theme).join('; ')}` : '',
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.8,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const data = await res.json()
  const p = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
  if (!p.theme || !Array.isArray(p.days) || p.days.length < 4) throw new Error('модель не вернула план цикла')

  const id = `crc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  await sql`
    INSERT INTO creator_cycles (id, week_key, goal, theme, rationale, plan)
    VALUES (${id}, ${weekKey}, ${goal}, ${String(p.theme).slice(0, 300)},
            ${String(p.rationale || '').slice(0, 600)}, ${JSON.stringify(p.days.slice(0, 6))}::jsonb)`
  const [row] = await sql`SELECT * FROM creator_cycles WHERE id = ${id}`
  return row
}

/**
 * Серийный пост дня: знает цель цикла, роль дня и все предыдущие посты серии —
 * связки «вчера я показал…» и крючки на завтра настоящие. Право на отказ в
 * серии не действует: тема первична, материал — опора.
 */
export async function generateSeriesDraft(sql: SQL, key: string, cycle: any, batchKey: string): Promise<any> {
  const days: CycleDay[] = Array.isArray(cycle.plan) ? cycle.plan : JSON.parse(cycle.plan)
  const prev = await sql`
    SELECT title, body_ru, cycle_role FROM creator_drafts
    WHERE cycle_id = ${cycle.id} ORDER BY created_at`
  const dayIndex = (prev as any[]).length
  if (dayIndex >= days.length) return null
  const day = days[dayIndex]

  const usedRows = await sql`
    SELECT DISTINCT source->>'url' AS u FROM creator_drafts WHERE source->>'url' IS NOT NULL`
  const used = new Set((usedRows as any[]).map(r => String(r.u)))

  // Материалы-опоры: свежий релиз, случайная страница функционала, рынок
  const [rel, pool, sources, profileRow, samples] = await Promise.all([
    fetchDeleverRelease(),
    fetchGitbookPool(),
    sql`SELECT id, kind, title, url, active FROM creator_sources WHERE active ORDER BY added_at`,
    sql`SELECT value FROM support_settings WHERE org_id = 'org_delever' AND key = 'creator_founder_profile' LIMIT 1`,
    styleSamples(sql),
  ])
  const market = await marketContext(sources as any)
  const profile = String((profileRow as any[])[0]?.value || '')
  const funcPool = pool.filter(p => !p.url.includes('otchyoty-o-relizakh') && !used.has(p.url))
  let page: { title: string; text: string; url: string } | null = null
  for (let i = 0; i < 3 && !page && funcPool.length; i++) {
    const pick = funcPool[Math.floor(Math.random() * funcPool.length)]
    const p = await fetchGitbookPage(pick.url)
    if (p && p.text.length > 500) page = p
  }

  const seriesBlock = [
    `НЕДЕЛЬНЫЙ ЦИКЛ. Цель: ${GOAL_BRIEF[cycle.goal as CycleGoal]}`,
    `Тема недели: ${cycle.theme}`,
    `Сегодня день ${dayIndex + 1} из ${days.length}. Роль поста: ${day.role} — ${day.brief}`,
    dayIndex + 1 < days.length
      ? 'В конце можно оставить лёгкий крючок на завтрашний пост (без слова «завтра» в лоб — интригой).'
      : 'Это ФИНАЛ арки: собери мысль недели воедино; никакого CTA — закрой открытой мыслью, после которой читателю хочется действовать самому.',
    (prev as any[]).length
      ? '\nПредыдущие посты серии (продолжай их линию, не повторяй):\n' + (prev as any[])
          .map((p2: any, i: number) => `День ${i + 1} (${p2.cycle_role}): «${p2.title}»\n${String(p2.body_ru).slice(0, 700)}`)
          .join('\n---\n')
      : '',
  ].join('\n')

  const user = [
    seriesBlock,
    '\nМатериалы-опоры (бери то, что ложится в роль дня; факты не выдумывать):',
    rel ? `\n[Свежий релиз Delever]\n${rel.text.slice(0, 3000)}` : '',
    page ? `\n[Страница базы знаний: ${page.title}]\n${page.text.slice(0, 2500)}` : '',
    market ? `\n[Что обсуждает рынок]\n${market.slice(0, 2000)}` : '',
    profile ? `\nКарточка автора (мысль растёт отсюда; факты биографии точно):\n${profile.slice(0, 6000)}` : '',
    samples.length ? '\nОбразцы тона автора:\n---\n' + samples.slice(0, 4).join('\n---\n') : '',
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }),
  })
  const data = await res.json()
  const p = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
  if (!p.body_ru || !p.body_en) throw new Error('модель не вернула серийный пост')

  const id = draftId()
  await sql`
    INSERT INTO creator_drafts (id, batch_key, line, title, body_ru, body_en, source, cycle_id, cycle_role)
    VALUES (${id}, ${batchKey}, 'cycle', ${String(p.title || '').slice(0, 200)},
            ${String(p.body_ru)}, ${String(p.body_en)},
            ${JSON.stringify({ url: page?.url || null, cycle: cycle.id })}::jsonb,
            ${cycle.id}, ${String(day.role).slice(0, 80)})`
  const [row] = await sql`SELECT * FROM creator_drafts WHERE id = ${id}`
  return row
}
