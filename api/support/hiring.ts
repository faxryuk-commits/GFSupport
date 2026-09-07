import { getRequestOrgId } from './_lib/org.js'
import { getSQL, json, corsHeaders } from './_lib/db.js'
import { extractAgentContext } from './_lib/auth.js'
import { ensureHireSchema, hireId } from './_lib/hire.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Командная сторона найма: вакансии, доска кандидатов, карточка со скорингом
 * и расшифровкой, движение по этапам, текст приглашения для мессенджеров.
 *
 * Всё — только руководителям: кандидатские данные чувствительны.
 * ИИ никого не отказывает: отказ, резерв и оффер — ручные действия человека.
 */

const STAGES = ['applied', 'interview', 'scored', 'invited', 'interviewed', 'offer', 'rejected', 'reserve']

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (!ctx.isLead) return json({ error: 'Раздел «Наём» доступен только руководителям' }, 403)

  await ensureHireSchema(sql)
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'vacancies'

    if (action === 'vacancies') {
      const rows = await sql`
        SELECT v.*, (
          SELECT COUNT(*)::int FROM hire_candidates c WHERE c.vacancy_id = v.id
        ) AS candidates
        FROM hire_vacancies v WHERE v.org_id = ${orgId}
        ORDER BY v.created_at DESC
      `
      return json({ vacancies: rows })
    }

    if (action === 'board') {
      const vacancyId = url.searchParams.get('vacancyId') || ''
      const rows = await sql`
        SELECT id, vacancy_id, name, city, stage, score, grade, recommended,
               salary_exp, question_no, created_at, started_at, finished_at
        FROM hire_candidates
        WHERE org_id = ${orgId} AND (${vacancyId} = '' OR vacancy_id = ${vacancyId})
        ORDER BY created_at DESC LIMIT 300
      `
      return json({ candidates: rows, stages: STAGES })
    }

    if (action === 'candidate') {
      const id = url.searchParams.get('id') || ''
      const [cand] = await sql`
        SELECT c.*, v.title AS vacancy_title, v.lang, v.slug, v.shadow, v.threshold,
               v.pay_fix, v.pay_kpi, v.currency
        FROM hire_candidates c JOIN hire_vacancies v ON v.id = c.vacancy_id
        WHERE c.id = ${id} AND c.org_id = ${orgId}
      `
      if (!cand) return json({ error: 'not found' }, 404)
      const messages = await sql`
        SELECT id, role, text, translated, question_no, answer_ms
        FROM hire_messages WHERE candidate_id = ${id} ORDER BY id
      `
      return json({ candidate: cand, messages })
    }

    if (action === 'invite') {
      const id = url.searchParams.get('id') || ''
      const [cand] = await sql`
        SELECT c.name, c.phone, c.token, v.title, v.lang, v.slug
        FROM hire_candidates c JOIN hire_vacancies v ON v.id = c.vacancy_id
        WHERE c.id = ${id} AND c.org_id = ${orgId}
      `
      if (!cand) return json({ error: 'not found' }, 404)
      const link = `https://www.gfsupport.uz/jobs/${cand.slug}?t=${cand.token}`
      const texts: Record<string, string> = {
        az: `Salam, ${cand.name}! "${cand.title}" vakansiyasına müraciətiniz üçün təşəkkür edirik. Növbəti addım — 5-7 dəqiqəlik qısa onlayn söhbət: ${link}`,
        ru: `Здравствуйте, ${cand.name}! Спасибо за отклик на вакансию «${cand.title}». Следующий шаг — короткий онлайн-разговор на 5–7 минут: ${link}`,
        uz: `Assalomu alaykum, ${cand.name}! "${cand.title}" vakansiyasiga qiziqishingiz uchun rahmat. Keyingi qadam — 5-7 daqiqalik qisqa onlayn suhbat: ${link}`,
      }
      const text = texts[cand.lang] || texts.ru
      const digits = String(cand.phone || '').replace(/\D/g, '')
      return json({
        text, link,
        whatsapp: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
      })
    }

    return json({ error: 'unknown action' }, 400)
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'vacancy') {
      const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)
      if (!slug || !body.title) return json({ error: 'нужны slug и title' }, 400)
      const id = String(body.id || '') || hireId('hv')
      const weights = body.weights || {}
      const wSum = ['experience', 'product', 'expectations', 'motivation', 'red_flags']
        .reduce((s, k) => s + (Number(weights[k]) || 0), 0)
      if (wSum && Math.abs(wSum - 100) > 0.5) {
        return json({ error: `Веса скоринга дают ${wSum}% вместо 100%` }, 400)
      }
      await sql`
        INSERT INTO hire_vacancies (
          id, org_id, slug, title, lang, region, location, schedule, intro,
          duties, requirements, offers, pay_fix, pay_kpi, currency,
          questions_count, scenarios, weights, threshold, shadow, status
        ) VALUES (
          ${id}, ${orgId}, ${slug}, ${String(body.title).slice(0, 200)},
          ${String(body.lang || 'ru').slice(0, 8)}, ${body.region || null},
          ${body.location || null}, ${body.schedule || null}, ${body.intro || null},
          ${JSON.stringify(body.duties || [])}, ${JSON.stringify(body.requirements || [])},
          ${JSON.stringify(body.offers || [])},
          ${Math.round(Number(body.payFix) || 0)}, ${Math.round(Number(body.payKpi) || 0)},
          ${String(body.currency || 'UZS').slice(0, 8)},
          ${Math.min(12, Math.max(4, Number(body.questions) || 8))},
          ${JSON.stringify(body.scenarios || [])}, ${JSON.stringify(weights)},
          ${Math.min(100, Math.max(0, Number(body.threshold) || 65))},
          ${body.shadow !== false}, ${body.status === 'paused' ? 'paused' : 'active'}
        )
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug, title = EXCLUDED.title, lang = EXCLUDED.lang,
          region = EXCLUDED.region, location = EXCLUDED.location,
          schedule = EXCLUDED.schedule, intro = EXCLUDED.intro,
          duties = EXCLUDED.duties, requirements = EXCLUDED.requirements,
          offers = EXCLUDED.offers, pay_fix = EXCLUDED.pay_fix,
          pay_kpi = EXCLUDED.pay_kpi, currency = EXCLUDED.currency,
          questions_count = EXCLUDED.questions_count, scenarios = EXCLUDED.scenarios,
          weights = EXCLUDED.weights, threshold = EXCLUDED.threshold,
          shadow = EXCLUDED.shadow, status = EXCLUDED.status
      `
      return json({ ok: true, id, url: `https://www.gfsupport.uz/jobs/${slug}` })
    }

    if (action === 'stage') {
      const id = String(body.id || '')
      const stage = String(body.stage || '')
      if (!STAGES.includes(stage)) return json({ error: 'unknown stage' }, 400)
      await sql`
        UPDATE hire_candidates SET stage = ${stage}
        WHERE id = ${id} AND org_id = ${orgId}
      `
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  }

  return json({ error: 'method not allowed' }, 405)
}
