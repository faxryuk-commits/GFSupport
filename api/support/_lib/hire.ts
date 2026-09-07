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
    // Мультиязычность: langs — какие языки предлагает страница, i18n — переводы
    // контента (генерируются ИИ при сохранении вакансии), lang у кандидата —
    // его выбор: на нём идёт и лендинг, и само интервью
    await sql`ALTER TABLE hire_vacancies ADD COLUMN IF NOT EXISTS langs JSONB DEFAULT '[]'`.catch(() => {})
    await sql`ALTER TABLE hire_vacancies ADD COLUMN IF NOT EXISTS i18n JSONB DEFAULT '{}'`.catch(() => {})
    await sql`ALTER TABLE hire_candidates ADD COLUMN IF NOT EXISTS lang VARCHAR(8)`.catch(() => {})
    await sql`ALTER TABLE hire_candidates ADD COLUMN IF NOT EXISTS qualification JSONB`.catch(() => {})
  })
}

/**
 * Перевод контента вакансии на дополнительные языки страницы — один вызов
 * при сохранении. РОП пишет на одном языке, кандидат выбирает удобный.
 */
export async function translateVacancy(
  orgId: string,
  source: { title: string; intro: string | null; schedule: string | null; location: string | null
    duties: string[]; requirements: string[]; offers: string[] },
  fromLang: string, targets: string[],
): Promise<Record<string, any>> {
  const want = targets.filter(l => l !== fromLang && LANG_NAMES[l])
  if (!want.length) return {}
  const system = [
    `Ты переводишь текст вакансии компании Delever. Переведи контент с ${LANG_NAMES[fromLang] || fromLang} на языки: ${want.map(l => LANG_NAMES[l]).join(', ')}.`,
    `Стиль — живой язык объявления о работе, не машинный. Узбекский — латиницей, казахский — кириллицей.`,
    `Верни JSON: {${want.map(l => `"${l}": {"title": "...", "intro": "...", "schedule": "...", "location": "...", "duties": [...], "requirements": [...], "offers": [...]}`).join(', ')}}`,
    `Пустые поля оставляй пустыми строками/массивами. Число элементов списков сохраняй.`,
  ].join('\n')
  const user = JSON.stringify(source)
  const out = await llmJson(orgId, system, user, 3000)
  const result: Record<string, any> = {}
  for (const l of want) if (out[l] && typeof out[l] === 'object') result[l] = out[l]
  return result
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
  const total = v.questions_count
  // Жёсткая арка вместо импровизации: кандидат должен чувствовать логику
  // разговора, а не случайный набор вопросов. Продукт — только после
  // короткого контекста: кандидат не обязан знать Delever заранее.
  const arc = [
    `№1 — поздоровайся, В ОДНОЙ фразе объяви план («поговорим об опыте, потом пара рабочих ситуаций, в конце — об условиях») и задай вопрос про опыт из анкеты.`,
    `№2 и №3 — углубление в опыт: конкретика, цифры, «как именно». Если ответ уже конкретный — переходи к новой грани опыта, а не выдумывай уточнение.`,
    `№${Math.min(4, total - 3)} — понимание продукта: СНАЧАЛА в 1-2 предложениях объясни, что Delever — это B2B SaaS: ресторан платит подписку и получает свой сайт и приложение для онлайн-заказов, доставку и QR-меню. Потом задай ОДИН сценарий из списка — как кандидат ПРОДАЛ БЫ это владельцу бизнеса. Кандидат не обязан знать продукт — оцениваем мышление продавца, не знание.`,
    `№${Math.min(5, total - 2)} — мотивация: почему к нам, почему уходит с прошлого места.`,
    `№${Math.min(6, total - 1)} — ожидания по деньгам и графику, если из анкеты не ясно; назови вилку честно.`,
    `Остальные до №${total} — добор по самому слабому или неясному месту разговора.`,
  ].join('\n')
  const system = [
    `Ты — дружелюбный интервьюер отдела продаж Delever — международной IT-компании, B2B SaaS-платформы для ресторанного бизнеса (онлайн-заказы, доставка, QR-меню по подписке).`,
    `ВАЖНО: мы нанимаем менеджера по продажам IT-продукта, а НЕ сотрудника ресторана. Оценивай навыки B2B-продаж: поиск клиентов, выход на владельца бизнеса, презентация, работа с возражениями, доведение до сделки. Опыт в ресторанной сфере кандидата ценен как знание клиента, не как самоцель.`,
    `Проводишь короткий скрининг кандидата. Пиши ТОЛЬКО на ${langName} языке.`,
    `Всего ${total} вопросов, это будет вопрос №${askedNo + 1}. План интервью:`,
    arc,
    `Один вопрос за раз, коротко (кроме вопроса о продукте — там сначала контекст). Не повторяй уже спрошенное.`,
    `Требуй конкретику: цифры, имена, сроки. Привязывай вопросы к анкете и предыдущим ответам.`,
    `ПУСТОЙ ОТВЕТ НЕ ПРИНИМАЕТСЯ. Если кандидат ответил парой слов без цифр и примеров («новый опыт», «надо смотреть», «понимаю что к чему») — следующим вопросом вежливо, но прямо переспроси ИМЕННО ЭТО, попросив конкретику: цифру, пример, диапазон. Один переспрос на тему; если снова пусто — двигайся дальше.`,
    `Если на сценарий о продукте кандидат отвечает общими словами («изучу», «посчитаю», «пообщаюсь») — попроси сыграть сцену: «Представьте, что я и есть владелец — что вы скажете мне прямо сейчас?»`,
    `Про деньги добивайся числа или диапазона: «надо смотреть» — не ответ.`,
    `Никогда не сообщай оценок и не отказывай.`,
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
  qualification: Array<{ requirement: string; status: string; note?: string }>
}> {
  const w = v.weights || {}
  const system = [
    `Ты — ассистент по найму Delever — международной IT-компании, B2B SaaS-платформы для ресторанного бизнеса. Вакансия — менеджер по продажам IT-продукта (не работа в ресторане!). Оцени кандидата по интервью и анкете как будущего B2B-сейлза. Отвечай на русском.`,
    `Блоки и веса: опыт ${w.experience ?? 30}% (продажи и переговоры весят больше, чем годы в общепите), понимание продукта ${w.product ?? 25}% (мыслит ли как продавец B2B SaaS: ценность, возражения, ЛПР), ожидания vs вилка ${w.expectations ?? 20}%, мотивация ${w.motivation ?? 15}%, red flags ${w.red_flags ?? 10}%.`,
    `Правила: несовпадение ожиданий с вилкой — это флаг с пояснением, а не приговор. Red flags: противоречия с анкетой, явное враньё, грубость, полностью шаблонные ответы (возможен ChatGPT — учитывай слишком гладкие обезличенные формулировки и слишком быстрые длинные ответы по answer_ms).`,
    `Верни JSON строго такой формы: {"score": 0-100, "grade": "A|B|C|D", "blocks": {"experience": {"score": 0-100, "note": "..."}, "product": {...}, "expectations": {...}, "motivation": {...}, "red_flags": {...}}, "qualification": [{"requirement": "...", "status": "met|unmet|unknown", "note": "кратко почему"}], "summary": "3-4 предложения: сильное, слабое, что проверить на собеседовании", "red_flags_text": "чисто | описание", "translations": [{"id": <id реплики>, "ru": "перевод на русский"}] }`,
    `В qualification пройди по КАЖДОМУ требованию вакансии по отдельности + добавь пункты «Ожидания в вилке» и «Опыт продаж (не только управления)». status=met только если это ПОДТВЕРЖДЕНО словами кандидата; не выяснено в интервью — unknown, противоречит — unmet. Не выдумывай.`,
    `В translations переведи КАЖДУЮ реплику диалога (и вопросы, и ответы) на русский. Если реплика уже на русском — повтори её как есть.`,
  ].join('\n')
  const user = [
    vacancyBrief(v),
    `Анкета: имя ${profile.name}; город ${profile.city || '—'}; опыт: ${profile.experience || '—'}; ожидания: ${profile.salary_exp || '—'}.`,
    `Диалог (в скобках id реплики и время ответа в мс):`,
    messages.map(m => `[id=${m.id}${m.answer_ms ? ` ${m.answer_ms}мс` : ''}] ${m.role === 'ai' ? 'Интервьюер' : 'Кандидат'}: ${m.text}`).join('\n'),
  ].join('\n\n')
  const out = await llmJson(orgId, system, user, 3000)
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)))
  return {
    qualification: Array.isArray(out.qualification) ? out.qualification : [],
    score,
    grade: ['A', 'B', 'C', 'D'].includes(out.grade) ? out.grade : (score >= 85 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D'),
    blocks: out.blocks || {},
    summary: String(out.summary || ''),
    redFlags: String(out.red_flags_text || ''),
    recommended: score >= (v.threshold || 65),
    translations: Array.isArray(out.translations) ? out.translations : [],
  }
}

/**
 * Прощание после интервью — на языке кандидата, без вердикта, но с конкретикой:
 * кто, по какому каналу и в какой срок выйдет на связь. «Мы свяжемся» без
 * деталей читается как вежливый отказ — и кандидат уходит дальше по рынку.
 */
export function farewell(lang: string, phone: string): string {
  const texts: Record<string, string> = {
    ru: `Спасибо, интервью завершено! Ответы уже у руководителя отдела продаж Delever. В течение 3 рабочих дней он свяжется с вами по WhatsApp или звонком на номер ${phone}. Если удобнее другой канал — напишите его последним сообщением здесь.`,
    az: `Təşəkkür edirik, müsahibə tamamlandı! Cavablarınız artıq Delever satış rəhbərindədir. 3 iş günü ərzində o sizinlə ${phone} nömrəsi ilə WhatsApp və ya zənglə əlaqə saxlayacaq.`,
    uz: `Rahmat, suhbat yakunlandi! Javoblaringiz Delever savdo rahbarida. 3 ish kuni ichida u siz bilan ${phone} raqami orqali WhatsApp yoki qo‘ng‘iroq bilan bog‘lanadi.`,
    kz: `Рақмет, сұхбат аяқталды! Жауаптарыңыз Delever сату жетекшісінде. 3 жұмыс күні ішінде ол сізбен ${phone} нөмірі арқылы WhatsApp немесе қоңырау арқылы хабарласады.`,
    en: `Thank you, the interview is complete! Your answers are with the Delever head of sales. Within 3 business days they will contact you via WhatsApp or a call to ${phone}.`,
  }
  return texts[lang] || texts.ru
}
