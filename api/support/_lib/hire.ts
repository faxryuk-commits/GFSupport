import { getOpenAIKey } from './db.js'
import { ensureOnce } from './db.js'

/**
 * Наём: скрининг кандидатов ИИ-интервью.
 *
 * Кандидат проходит анкету и короткий адаптивный диалог на языке вакансии;
 * на выходе — скоринг по блокам с весами и расшифровка с переводом на русский.
 * ИИ никого не отказывает: он ранжирует, решение всегда за человеком.
 * Скоринг стартует в «тени» (shadow): оценки пишутся, но порог ни на что
 * не влияет, пока команда не откалибрует веса на первых кандидатах.
 */

export async function ensureHireSchema(sql: any) {
  await ensureOnce('hire', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS hire_vacancies (
        id VARCHAR(40) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        slug VARCHAR(80) NOT NULL,
        title TEXT NOT NULL,
        lang VARCHAR(8) NOT NULL DEFAULT 'ru',
        region VARCHAR(40),
        location TEXT,
        schedule TEXT,
        intro TEXT,
        duties JSONB NOT NULL DEFAULT '[]',
        requirements JSONB NOT NULL DEFAULT '[]',
        offers JSONB NOT NULL DEFAULT '[]',
        pay_fix BIGINT NOT NULL DEFAULT 0,
        pay_kpi BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'UZS',
        questions_count INT NOT NULL DEFAULT 8,
        scenarios JSONB NOT NULL DEFAULT '[]',
        weights JSONB NOT NULL DEFAULT '{}',
        threshold INT NOT NULL DEFAULT 65,
        shadow BOOLEAN NOT NULL DEFAULT true,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, slug)
      )
    `.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS hire_candidates (
        id VARCHAR(40) PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        vacancy_id VARCHAR(40) NOT NULL,
        token VARCHAR(60) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        city TEXT,
        experience TEXT,
        salary_exp TEXT,
        extra JSONB NOT NULL DEFAULT '{}',
        stage VARCHAR(20) NOT NULL DEFAULT 'applied',
        question_no INT NOT NULL DEFAULT 0,
        score INT,
        grade VARCHAR(2),
        blocks JSONB,
        summary TEXT,
        red_flags TEXT,
        recommended BOOLEAN,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {})
    await sql`CREATE INDEX IF NOT EXISTS hire_cand_org_vac ON hire_candidates(org_id, vacancy_id, stage)`.catch(() => {})
    await sql`
      CREATE TABLE IF NOT EXISTS hire_messages (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        org_id VARCHAR(50) NOT NULL,
        candidate_id VARCHAR(40) NOT NULL,
        role VARCHAR(12) NOT NULL,
        text TEXT NOT NULL,
        translated TEXT,
        question_no INT,
        answer_ms INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {})
    await sql`CREATE INDEX IF NOT EXISTS hire_msg_cand ON hire_messages(candidate_id, id)`.catch(() => {})
  })
}

export function hireId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const LANG_NAMES: Record<string, string> = {
  ru: 'русском', az: 'азербайджанском', uz: 'узбекском', kz: 'казахском', en: 'английском',
}

const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions'

async function llmJson(orgId: string, system: string, user: string, maxTokens = 900): Promise<any> {
  const key = await getOpenAIKey(orgId)
  if (!key) throw new Error('OpenAI-ключ не настроен')
  const res = await fetch(OPENAI_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}`)
  const body = await res.json()
  const raw = body?.choices?.[0]?.message?.content || '{}'
  return JSON.parse(raw)
}

interface VacancyRow {
  title: string; lang: string; region: string | null
  pay_fix: number; pay_kpi: number; currency: string
  requirements: string[]; duties: string[]
  questions_count: number; scenarios: string[]
}

function vacancyBrief(v: VacancyRow): string {
  return [
    `Вакансия: ${v.title}${v.region ? ` (регион ${v.region})` : ''}.`,
    `Вилка: ${v.pay_fix} фикс + ${v.pay_kpi} KPI ${v.currency}.`,
    `Обязанности: ${(v.duties || []).join('; ')}.`,
    `Требования: ${(v.requirements || []).join('; ')}.`,
    `Сценарии на понимание продукта (использовать РОВНО ОДИН за интервью): ${(v.scenarios || []).join(' | ')}`,
  ].join('\n')
}

function transcriptText(messages: Array<{ role: string; text: string; question_no: number | null }>): string {
  return messages.map(m => `${m.role === 'ai' ? 'Интервьюер' : 'Кандидат'}: ${m.text}`).join('\n')
}

/**
 * Следующий вопрос интервью. Адаптивный, но короткий: общий лимит вопросов
 * задан в вакансии, уточнения вглубь — максимум по двум темам, один сценарий
 * на продукт, один вопрос про ожидания. Язык — язык вакансии.
 */
export async function nextQuestion(orgId: string, v: VacancyRow, profile: any,
  messages: Array<{ role: string; text: string; question_no: number | null }>, askedNo: number,
): Promise<string> {
  const langName = LANG_NAMES[v.lang] || v.lang
  const system = [
    `Ты — дружелюбный интервьюер компании Delever (технологии для ресторанов: онлайн-заказы, доставка, QR-меню).`,
    `Проводишь короткий скрининг кандидата. Пиши ТОЛЬКО на ${langName} языке.`,
    `Правила: всего ${v.questions_count} вопросов, это будет вопрос №${askedNo + 1}.`,
    `Один вопрос за раз, коротко (максимум 2 предложения). Не повторяй уже спрошенное.`,
    `Требуй конкретику: цифры, имена, сроки. Если ответ общий — задай уточнение вглубь, но не более двух уточнений за всё интервью.`,
    `Обязательно за интервью: 1 вопрос-сценарий на понимание продукта (из списка), 1 вопрос про зарплатные ожидания (если ещё не ясно из анкеты), 1 вопрос про мотивацию (почему к нам / почему ушёл).`,
    `Привязывай вопросы к анкете кандидата. Никогда не сообщай оценок и не отказывай.`,
    `Ответ верни JSON: {"question": "..."}`,
  ].join('\n')
  const user = [
    vacancyBrief(v),
    `Анкета кандидата: имя ${profile.name}; город ${profile.city || '—'}; опыт: ${profile.experience || '—'}; ожидания по зарплате: ${profile.salary_exp || '—'}.`,
    `Диалог до этого момента:`,
    transcriptText(messages) || '(ещё не начался — поздоровайся одной фразой и задай первый вопрос)',
  ].join('\n\n')
  const out = await llmJson(orgId, system, user, 300)
  return String(out.question || '').trim()
}

/**
 * Финальный скоринг: блоки с весами из вакансии, оценка 0-100, буква,
 * выжимка и перевод каждой реплики на русский. Рекомендация — по порогу,
 * но в shadow-режиме она только пишется, ни на что не влияя.
 */
export async function scoreCandidate(orgId: string, v: VacancyRow & { weights: any; threshold: number }, profile: any,
  messages: Array<{ id: number; role: string; text: string; question_no: number | null; answer_ms: number | null }>,
): Promise<{
  score: number; grade: string; blocks: any; summary: string; redFlags: string
  recommended: boolean; translations: Array<{ id: number; ru: string }>
}> {
  const w = v.weights || {}
  const system = [
    `Ты — ассистент по найму Delever. Оцени кандидата по интервью и анкете. Отвечай на русском.`,
    `Блоки и веса: опыт ${w.experience ?? 30}%, понимание продукта ${w.product ?? 25}%, ожидания vs вилка ${w.expectations ?? 20}%, мотивация ${w.motivation ?? 15}%, red flags ${w.red_flags ?? 10}%.`,
    `Правила: несовпадение ожиданий с вилкой — это флаг с пояснением, а не приговор. Red flags: противоречия с анкетой, явное враньё, грубость, полностью шаблонные ответы (возможен ChatGPT — учитывай слишком гладкие обезличенные формулировки и слишком быстрые длинные ответы по answer_ms).`,
    `Верни JSON строго такой формы: {"score": 0-100, "grade": "A|B|C|D", "blocks": {"experience": {"score": 0-100, "note": "..."}, "product": {...}, "expectations": {...}, "motivation": {...}, "red_flags": {...}}, "summary": "3-4 предложения: сильное, слабое, что проверить на собеседовании", "red_flags_text": "чисто | описание", "translations": [{"id": <id реплики>, "ru": "перевод на русский"}] }`,
    `В translations переведи КАЖДУЮ реплику диалога (и вопросы, и ответы) на русский. Если реплика уже на русском — повтори её как есть.`,
  ].join('\n')
  const user = [
    vacancyBrief(v),
    `Анкета: имя ${profile.name}; город ${profile.city || '—'}; опыт: ${profile.experience || '—'}; ожидания: ${profile.salary_exp || '—'}.`,
    `Диалог (в скобках id реплики и время ответа в мс):`,
    messages.map(m => `[id=${m.id}${m.answer_ms ? ` ${m.answer_ms}мс` : ''}] ${m.role === 'ai' ? 'Интервьюер' : 'Кандидат'}: ${m.text}`).join('\n'),
  ].join('\n\n')
  const out = await llmJson(orgId, system, user, 2500)
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)))
  return {
    score,
    grade: ['A', 'B', 'C', 'D'].includes(out.grade) ? out.grade : (score >= 85 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D'),
    blocks: out.blocks || {},
    summary: String(out.summary || ''),
    redFlags: String(out.red_flags_text || ''),
    recommended: score >= (v.threshold || 65),
    translations: Array.isArray(out.translations) ? out.translations : [],
  }
}

/** Прощание после интервью — на языке кандидата, без вердикта. */
export const FAREWELL: Record<string, string> = {
  ru: 'Спасибо! Интервью завершено. Мы внимательно всё изучим и свяжемся с вами в течение 3 рабочих дней.',
  az: 'Təşəkkür edirik! Müsahibə tamamlandı. Cavablarınızı diqqətlə nəzərdən keçirib 3 iş günü ərzində sizinlə əlaqə saxlayacağıq.',
  uz: 'Rahmat! Suhbat yakunlandi. Javoblaringizni diqqat bilan ko‘rib chiqamiz va 3 ish kuni ichida siz bilan bog‘lanamiz.',
  kz: 'Рақмет! Сұхбат аяқталды. Жауаптарыңызды мұқият қарап, 3 жұмыс күні ішінде хабарласамыз.',
  en: 'Thank you! The interview is complete. We will review your answers carefully and get back to you within 3 business days.',
}
