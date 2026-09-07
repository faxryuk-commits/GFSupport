import { getSQL, json, corsHeaders, getOpenAIKey } from '../_lib/db.js'
import {
  ensureHireSchema, hireId, nextQuestion, scoreCandidate, FAREWELL,
} from '../_lib/hire.js'
import { getBotToken, tgSend } from '../_lib/sales-bot.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Публичная сторона найма: лендинг вакансии, анкета, ИИ-интервью.
 *
 * Без авторизации. Гейт кандидата — случайный токен сессии, который выдаётся
 * после анкеты; по нему же можно вернуться и продолжить прерванное интервью.
 * Наружу не уходит ничего внутреннего: ни скоринга, ни порогов, ни оценок.
 *
 * GET  ?slug=baku-sales            публичные данные вакансии
 * GET  ?token=...                  состояние сессии интервью (для возврата)
 * POST { action:'apply', slug, name, phone, ... }        → { token }
 * POST { action:'message', token, text }                 → следующий вопрос
 * POST { action:'voice', token, audio(base64), mime }    → Whisper → как message
 */

const PUBLIC_VACANCY_FIELDS = (v: any) => ({
  slug: v.slug, title: v.title, lang: v.lang, location: v.location,
  schedule: v.schedule, intro: v.intro,
  duties: v.duties || [], requirements: v.requirements || [], offers: v.offers || [],
  payFix: Number(v.pay_fix), payKpi: Number(v.pay_kpi), currency: v.currency,
  questions: Number(v.questions_count) || 8,
})

async function loadSession(sql: any, token: string) {
  if (!token || token.length < 20) return null
  const [cand] = await sql`
    SELECT c.*, v.title, v.lang, v.region, v.pay_fix, v.pay_kpi, v.currency,
           v.duties, v.requirements, v.questions_count, v.scenarios, v.weights, v.threshold
    FROM hire_candidates c
    JOIN hire_vacancies v ON v.id = c.vacancy_id
    WHERE c.token = ${token}
  `
  return cand || null
}

async function notifyLeads(sql: any, orgId: string, text: string) {
  try {
    const bot = await getBotToken(sql)
    if (!bot) return
    const leads = await sql`
      SELECT telegram_id FROM support_agents
      WHERE org_id = ${orgId} AND is_active = true AND telegram_id IS NOT NULL
        AND role IN ('admin', 'org_admin', 'cco', 'sales_lead', 'team_lead')
    `
    for (const l of leads as any[]) await tgSend(bot, l.telegram_id, text)
  } catch { /* уведомление не должно ронять интервью */ }
}

/** Финал: скоринг, перевод, карточка готова — и сигнал руководителям. */
async function finishInterview(sql: any, cand: any): Promise<void> {
  const messages = await sql`
    SELECT id, role, text, question_no, answer_ms FROM hire_messages
    WHERE candidate_id = ${cand.id} ORDER BY id
  `
  const v = {
    title: cand.title, lang: cand.lang, region: cand.region,
    pay_fix: Number(cand.pay_fix), pay_kpi: Number(cand.pay_kpi), currency: cand.currency,
    duties: cand.duties || [], requirements: cand.requirements || [],
    questions_count: Number(cand.questions_count), scenarios: cand.scenarios || [],
    weights: cand.weights || {}, threshold: Number(cand.threshold) || 65,
  }
  const profile = { name: cand.name, city: cand.city, experience: cand.experience, salary_exp: cand.salary_exp }
  let scored: any = null
  try {
    scored = await scoreCandidate(cand.org_id, v, profile, messages as any[])
  } catch {
    // Скоринг упал — кандидат не должен об этом узнать, карточка останется
    // без оценки, руководитель увидит расшифровку и оценит руками
  }
  await sql`
    UPDATE hire_candidates SET
      stage = 'scored', finished_at = NOW(),
      score = ${scored?.score ?? null}, grade = ${scored?.grade ?? null},
      blocks = ${scored ? JSON.stringify(scored.blocks) : null},
      summary = ${scored?.summary ?? null}, red_flags = ${scored?.redFlags ?? null},
      recommended = ${scored?.recommended ?? null}
    WHERE id = ${cand.id}
  `
  if (scored?.translations?.length) {
    for (const t of scored.translations) {
      if (!t?.id || !t?.ru) continue
      await sql`
        UPDATE hire_messages SET translated = ${String(t.ru)}
        WHERE id = ${Number(t.id)} AND candidate_id = ${cand.id}
      `
    }
  }
  const mins = cand.started_at
    ? Math.round((Date.now() - new Date(cand.started_at).getTime()) / 60000) : null
  await notifyLeads(sql, cand.org_id,
    `🧲 Наём · ${cand.title}\n` +
    `${cand.name} завершил(а) интервью${mins ? ` за ${mins} мин` : ''}.\n` +
    (scored
      ? `Оценка: ${scored.grade} · ${scored.score}/100${scored.recommended ? ' · рекомендован' : ''}\n${scored.summary?.slice(0, 200) || ''}`
      : 'Автооценка не посчиталась — посмотрите расшифровку руками.') +
    `\n\nКарточка: https://www.gfsupport.uz/hiring?c=${cand.id}`)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  await ensureHireSchema(sql)
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const slug = url.searchParams.get('slug') || ''
    const token = url.searchParams.get('token') || ''

    if (token) {
      const cand = await loadSession(sql, token)
      if (!cand) return json({ error: 'not found' }, 404)
      const messages = await sql`
        SELECT role, text, question_no FROM hire_messages
        WHERE candidate_id = ${cand.id} ORDER BY id
      `
      return json({
        name: cand.name, lang: cand.lang, title: cand.title,
        questionNo: Number(cand.question_no), total: Number(cand.questions_count) || 8,
        finished: !!cand.finished_at,
        farewell: cand.finished_at ? (FAREWELL[cand.lang] || FAREWELL.ru) : null,
        messages: (messages as any[]).map(m => ({ role: m.role, text: m.text })),
      })
    }

    if (slug) {
      const [v] = await sql`
        SELECT * FROM hire_vacancies
        WHERE slug = ${slug} AND status = 'active' LIMIT 1
      `
      if (!v) return json({ error: 'vacancy not found' }, 404)
      return json({ vacancy: PUBLIC_VACANCY_FIELDS(v) })
    }
    return json({ error: 'slug or token required' }, 400)
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'apply') {
      const slug = String(body.slug || '')
      const name = String(body.name || '').trim().slice(0, 120)
      const phone = String(body.phone || '').trim().slice(0, 40)
      if (!slug || !name || phone.replace(/\D/g, '').length < 9) {
        return json({ error: 'name and phone required' }, 400)
      }
      if (!body.consent) return json({ error: 'consent required' }, 400)
      const [v] = await sql`
        SELECT id, org_id, lang FROM hire_vacancies WHERE slug = ${slug} AND status = 'active' LIMIT 1
      `
      if (!v) return json({ error: 'vacancy not found' }, 404)

      // Повторная подача с тем же телефоном — возвращаем ту же сессию:
      // человек мог закрыть вкладку и прийти по ссылке заново
      const norm = phone.replace(/\D/g, '')
      const [existing] = await sql`
        SELECT token FROM hire_candidates
        WHERE vacancy_id = ${v.id} AND regexp_replace(phone, '[^0-9]', '', 'g') = ${norm}
        ORDER BY created_at DESC LIMIT 1
      `
      if (existing) return json({ token: existing.token, resumed: true })

      const id = hireId('hc')
      const token = `${hireId('ht')}${Math.random().toString(36).slice(2, 10)}`
      await sql`
        INSERT INTO hire_candidates (
          id, org_id, vacancy_id, token, name, phone, city, experience, salary_exp, extra
        ) VALUES (
          ${id}, ${v.org_id}, ${v.id}, ${token}, ${name}, ${phone},
          ${String(body.city || '').slice(0, 80) || null},
          ${String(body.experience || '').slice(0, 500) || null},
          ${String(body.salary || '').slice(0, 80) || null},
          ${JSON.stringify({ car: !!body.car, langs: body.langs || null })}
        )
      `
      return json({ token })
    }

    if (action === 'message' || action === 'voice') {
      const cand = await loadSession(sql, String(body.token || ''))
      if (!cand) return json({ error: 'session not found' }, 404)
      if (cand.finished_at) {
        return json({ done: true, farewell: FAREWELL[cand.lang] || FAREWELL.ru })
      }

      let text = String(body.text || '').trim().slice(0, 2000)

      if (action === 'voice') {
        // Голос вместо текста: сейлзы говорят лучше, чем пишут
        const audio = String(body.audio || '')
        if (!audio || audio.length > 4_000_000) return json({ error: 'audio too large' }, 400)
        const key = await getOpenAIKey(cand.org_id)
        if (!key) return json({ error: 'voice unavailable' }, 503)
        const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
        const form = new FormData()
        form.append('file', new Blob([bytes], { type: String(body.mime || 'audio/webm') }), 'answer.webm')
        form.append('model', 'whisper-1')
        const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
        })
        if (!wr.ok) return json({ error: 'transcription failed' }, 502)
        const wj = await wr.json()
        text = String(wj.text || '').trim().slice(0, 2000)
        if (!text) return json({ error: 'empty transcription' }, 400)
      }

      const total = Number(cand.questions_count) || 8
      const askedNo = Number(cand.question_no)

      // Ответ кандидата (кроме самого первого запроса «начать»)
      if (text) {
        const [lastAi] = await sql`
          SELECT created_at FROM hire_messages
          WHERE candidate_id = ${cand.id} AND role = 'ai' ORDER BY id DESC LIMIT 1
        `
        const answerMs = lastAi ? Date.now() - new Date(lastAi.created_at).getTime() : null
        await sql`
          INSERT INTO hire_messages (org_id, candidate_id, role, text, question_no, answer_ms)
          VALUES (${cand.org_id}, ${cand.id}, 'candidate', ${text}, ${askedNo}, ${answerMs})
        `
      }

      if (!cand.started_at) {
        await sql`UPDATE hire_candidates SET started_at = NOW(), stage = 'interview' WHERE id = ${cand.id}`
      }

      // Лимит достигнут — финалим и прощаемся без вердикта
      if (askedNo >= total && text) {
        await finishInterview(sql, cand)
        return json({ done: true, farewell: FAREWELL[cand.lang] || FAREWELL.ru })
      }

      const messages = await sql`
        SELECT role, text, question_no FROM hire_messages
        WHERE candidate_id = ${cand.id} ORDER BY id
      `
      const v = {
        title: cand.title, lang: cand.lang, region: cand.region,
        pay_fix: Number(cand.pay_fix), pay_kpi: Number(cand.pay_kpi), currency: cand.currency,
        duties: cand.duties || [], requirements: cand.requirements || [],
        questions_count: total, scenarios: cand.scenarios || [],
      }
      let question: string
      try {
        question = await nextQuestion(cand.org_id, v as any,
          { name: cand.name, city: cand.city, experience: cand.experience, salary_exp: cand.salary_exp },
          messages as any[], askedNo)
      } catch {
        return json({ error: 'try again' }, 502)
      }
      if (!question) return json({ error: 'try again' }, 502)

      await sql`
        INSERT INTO hire_messages (org_id, candidate_id, role, text, question_no)
        VALUES (${cand.org_id}, ${cand.id}, 'ai', ${question}, ${askedNo + 1})
      `
      await sql`UPDATE hire_candidates SET question_no = ${askedNo + 1} WHERE id = ${cand.id}`
      return json({ question, no: askedNo + 1, total, transcribed: action === 'voice' ? text : undefined })
    }

    return json({ error: 'unknown action' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
