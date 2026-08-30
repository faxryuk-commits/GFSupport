import { getSQL, json } from '../lib/db.js'
import { checkRateLimit } from '../lib/rate-limit.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Публичная страница документа: то, что открывает клиент по ссылке /d/<token>.
 * Авторизации нет — знание токена и есть доступ, поэтому токен длинный и
 * одноразово выдаётся при публикации.
 *
 * GET  ?token=...                  — содержимое документа для отрисовки
 * POST ?token=... {seconds}        — маячок времени чтения, шлётся страницей
 *                                    раз в 15 секунд, пока вкладка активна
 * POST ?token=...&action=accept    — клиент принял оферту: фиксируем согласие
 *                                    и отдаём ссылку на оплату Click
 *
 * Зачем время, а не только факт открытия: «открыл и закрыл через 4 секунды» и
 * «читал 6 минут, вернулся дважды» — это разные сделки, и разговаривать с ними
 * надо по-разному.
 */

/** Один читатель = один отпечаток. Разные отпечатки → документ переслали. */
async function viewerHash(req: Request, token: string): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
  const ua = req.headers.get('user-agent') || ''
  const data = new TextEncoder().encode(`${token}:${ip}:${ua}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return json({ error: 'token is required' }, 400)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(`doc-public:${ip}`, 120, 60_000).allowed) {
    return json({ error: 'rate limited' }, 429)
  }

  const sql = getSQL()
  const [doc] = await sql`
    SELECT id, org_id, kind, number, version, status, title, lines, conditions, body,
           total, currency, valid_till, requisites, sent_at, accepted_at, paid_at, materials
    FROM sales_documents WHERE share_token = ${token} LIMIT 1
  `
  if (!doc) return json({ error: 'not found' }, 404)

  const expired = doc.valid_till && new Date(doc.valid_till).getTime() < Date.now()

  // Клик по материалу: пишем отдельно от открытия документа — по этому
  // видно, дочитал ли клиент до презентации или закрыл на первом экране
  if (req.method === 'POST' && new URL(req.url).searchParams.get('action') === 'material') {
    const body = await req.json().catch(() => null)
    const id = String(body?.materialId || '')
    if (id) {
      await sql`
        UPDATE sales_materials SET opened_count = opened_count + 1
        WHERE org_id = ${doc.org_id} AND id = ${id}
      `
      await sql`
        INSERT INTO sales_document_views (org_id, document_id, viewer_hash, user_agent, referrer)
        VALUES (${doc.org_id}, ${doc.id}, ${await viewerHash(req, token)}, 'material', ${id})
      `
    }
    return json({ ok: true })
  }

  if (req.method === 'GET') {
    const hash = await viewerHash(req, token)
    // Открытие фиксируем сразу: даже если клиент закроет вкладку через секунду,
    // менеджер должен знать, что документ дошёл
    await sql`
      INSERT INTO sales_document_views (org_id, document_id, viewer_hash, user_agent, referrer)
      VALUES (${doc.org_id}, ${doc.id}, ${hash},
              ${(req.headers.get('user-agent') || '').slice(0, 255)},
              ${(req.headers.get('referer') || '').slice(0, 255)})
    `
    await sql`
      UPDATE sales_documents SET
        opened_count = opened_count + 1,
        first_opened_at = COALESCE(first_opened_at, NOW()),
        last_opened_at = NOW(),
        status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END
      WHERE id = ${doc.id}
    `
    // Материалы: одна ссылка вместо четырёх вложений в директе, и видно,
    // что именно смотрели — открыл предложение, но не открыл презентацию
    // это другой разговор при следующем звонке
    const ids: string[] = Array.isArray(doc.materials) ? doc.materials.map(String) : []
    const materials = ids.length
      ? await sql`
          SELECT id, title, description, url, kind FROM sales_materials
          WHERE org_id = ${doc.org_id} AND id = ANY(${ids}) AND is_active = true
          ORDER BY sort_order, title
        `
      : []

    return json({
      document: {
        kind: doc.kind, number: doc.number, version: doc.version, title: doc.title,
        lines: doc.lines, conditions: doc.conditions, body: doc.body,
        total: doc.total, currency: doc.currency,
        validTill: doc.valid_till, requisites: doc.requisites, expired,
        acceptedAt: doc.accepted_at, paidAt: doc.paid_at, status: doc.status,
      },
      materials,
    })
  }

  // Принятие оферты: согласие фиксируем до оплаты, иначе не отличить
  // «передумал на странице оплаты» от «не открывал вовсе»
  if (req.method === 'POST' && url.searchParams.get('action') === 'accept') {
    if (doc.kind !== 'offer') return json({ error: 'документ не является офертой' }, 400)
    if (expired) return json({ error: 'срок действия оферты истёк' }, 409)

    await sql`
      UPDATE sales_documents
      SET accepted_at = COALESCE(accepted_at, NOW()), status = 'accepted', updated_at = NOW()
      WHERE id = ${doc.id}
    `

    const serviceId = process.env.CLICK_SERVICE_ID
    const merchantId = process.env.CLICK_MERCHANT_ID
    if (!serviceId || !merchantId) {
      return json({ ok: true, accepted: true, payUrl: null,
        note: 'Оплата через Click не настроена — менеджер выставит счёт' })
    }
    const payUrl = `https://my.click.uz/services/pay?service_id=${serviceId}`
      + `&merchant_id=${merchantId}&amount=${Number(doc.total || 0)}`
      + `&transaction_param=${encodeURIComponent(doc.id)}`
      + `&return_url=${encodeURIComponent(`${url.origin}/d/${token}`)}`
    return json({ ok: true, accepted: true, payUrl })
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const seconds = Math.max(0, Math.min(600, Number(body?.seconds) || 0))
    if (!seconds) return json({ ok: true })
    const hash = await viewerHash(req, token)
    // Дописываем к последнему просмотру этого читателя, а не плодим строки
    await sql`
      UPDATE sales_document_views SET seconds = seconds + ${seconds}
      WHERE id = (
        SELECT id FROM sales_document_views
        WHERE document_id = ${doc.id} AND viewer_hash = ${hash}
        ORDER BY opened_at DESC LIMIT 1
      )
    `
    await sql`
      UPDATE sales_documents SET read_seconds = read_seconds + ${seconds}, last_opened_at = NOW()
      WHERE id = ${doc.id}
    `
    return json({ ok: true })
  }

  return json({ error: 'method not allowed' }, 405)
}
