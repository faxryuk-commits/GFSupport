import type { NeonQueryFunction } from '@neondatabase/serverless'
import { ensureOnce } from './db.js'
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
  })
}

export function draftId(): string {
  return `crd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

const GITBOOK_INDEX = 'https://delever.gitbook.io/delever/description-updated/otchyoty-o-relizakh/2026.md'

/** Свежий отчёт о релизе Delever: GitBook отдаёт markdown по URL с `.md`. */
export async function fetchDeleverRelease(): Promise<{ title: string; text: string; url: string } | null> {
  try {
    const idx = await fetch(GITBOOK_INDEX).then(r => r.text())
    const m = idx.match(/\[Отчёт о релизе: [^\]]+\]\((https:[^)]+\.md)\)/)
    if (!m) return null
    const url = m[1]
    let text = await fetch(url).then(r => r.text())
    // Служебная шапка GitBook и картинки смысла не несут
    text = text.replace(/^>.*$/gm, '').replace(/<figure>[\s\S]*?<\/figure>/g, '')
    // «Как настроить» — инструкции для админов, посту они не нужны
    text = text.replace(/\*\*Как настроить:\*\*[\s\S]*?(?=\*\*Польза|####|###|$)/g, '')
    const title = text.match(/^# (.+)$/m)?.[1] || 'Отчёт о релизе'
    return { title, text: text.trim().slice(0, 6000), url }
  } catch {
    return null
  }
}

/** Последние выпуски GFSupport — линия «как мы это строим». */
export function gfsupportFacts(): string {
  return RELEASES.slice(0, 3)
    .map(r => `${r.date} — ${r.title}:\n` + r.items.map(i => `• ${i.text}`).join('\n'))
    .join('\n\n')
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

export interface GeneratedDraft { title: string; body_ru: string; body_en: string }

const SYSTEM_PROMPT = `Ты — редактор личного бренда Фахриддина Юсупова, фаундера Delever (платформа управления доставкой для ресторанов, рынки Центральной Азии и Кавказа) и внутренней системы GFSupport (CRM и поддержка, которую он пишет сам).

Формат поста — «бутерброд», чтение 1–2 минуты:
1) сцена или боль с рынка — живая, конкретная;
2) обезличенный кейс с деталями;
3) наш апдейт как участник истории — максимум 2 строки;
4) в конце мысль фаундера про рынок или ремесло.

ЖЁСТКИЕ ПРАВИЛА (нарушение = брак):
- Имена клиентов и брендов-клиентов не называть никогда. Только «сеть из N точек», «один из наших рынков».
- Никакой продажи: не «купите/подключите Delever», не перечисление преимуществ. Вывод поста — всегда мысль, не продукт.
- Отказы главной функции продукта не выносить: если речь о сбоях — виноваты стыки разных систем и сложность отрасли, а мы — те, кто видит цепочку и ловит сбой раньше клиента. Признание ошибки допустимо только в форме «нашли класс проблем и закрыли его системно».
- Не выдумывать цифр и фактов: использовать только данные из материала. Художественная сцена (курьер во дворе) допустима, вымышленная статистика — нет.

Стиль автора (по образцам ниже): первое лицо, короткие абзацы в 1–2 предложения, разговорно и честно, без канцелярита, без эмодзи, вывод в последнем абзаце. Английская версия — тот же пост для LinkedIn: живой founder-английский, не перевод слово в слово.

Ответ — строго JSON: {"title": "...", "body_ru": "...", "body_en": "..."}. title — короткий рабочий заголовок по-русски (в сам пост не входит).`

export async function generateDraft(
  key: string,
  line: 'delever' | 'gfsupport',
  facts: string,
  samples: string[],
  avoid: string[],
): Promise<GeneratedDraft | null> {
  const user = [
    line === 'delever'
      ? 'Материал — свежий отчёт о релизе Delever (написан для админов; инструкции игнорируй, выбери ОДИН самый живой факт и построй бутерброд вокруг него):'
      : 'Материал — свежие выпуски GFSupport, внутренней системы, которую фаундер пишет сам (линия «как мы это строим»; выбери ОДИН факт):',
    facts,
    samples.length ? '\nОбразцы тона автора (для стиля, не для копирования):\n---\n' + samples.join('\n---\n') : '',
    avoid.length ? '\nВ этом выпуске уже есть посты на темы (возьми ДРУГУЮ): ' + avoid.join('; ') : '',
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
    if (!p.body_ru || !p.body_en) return null
    return { title: String(p.title || '').slice(0, 200), body_ru: String(p.body_ru), body_en: String(p.body_en) }
  } catch {
    return null
  }
}
