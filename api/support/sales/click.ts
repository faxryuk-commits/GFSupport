import { createHash } from 'node:crypto'
import { getSQL } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'

// Единственный не-edge обработчик модуля: Click подписывает запросы MD5,
// а Web Crypto в edge даёт только SHA. Ради одной хеш-функции держим здесь
// обычный рантайм, вместо того чтобы тащить свою реализацию MD5.
export const config = { runtime: 'nodejs' }

/**
 * Приём оплаты по оферте через Click (Merchant API).
 *
 * POST /api/support/sales/click  — оба шага Click: action=0 (prepare) и action=1 (complete)
 *
 * merchant_trans_id = id документа-оферты. Оплата закрывает оферту и переводит
 * сделку в выигранную: клиент принял условия и заплатил — договор не нужен.
 *
 * Переменные: CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY, SALES_ORG.
 */

const ORG = process.env.SALES_ORG || 'org_delever'

const ERR = {
  OK: 0,
  SIGN: -1,
  AMOUNT: -2,
  ACTION: -3,
  ALREADY_PAID: -4,
  NOT_FOUND: -5,
  CANCELLED: -9,
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: -3, error_note: 'method not allowed' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const reply = (body: any) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })

  // Click шлёт form-urlencoded, но встречается и JSON — принимаем оба
  let p: Record<string, string> = {}
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) {
      p = await req.json() as any
    } else {
      const form = await req.formData()
      form.forEach((v, k) => { p[k] = String(v) })
    }
  } catch {
    return reply({ error: ERR.ACTION, error_note: 'bad request' })
  }

  const secret = process.env.CLICK_SECRET_KEY || ''
  const action = String(p.action ?? '')
  const docId = String(p.merchant_trans_id || '')
  const amount = Number(p.amount || 0)

  // Подпись: click_trans_id + service_id + SECRET + merchant_trans_id
  // [+ merchant_prepare_id для complete] + amount + action + sign_time
  const base = action === '1'
    ? `${p.click_trans_id}${p.service_id}${secret}${docId}${p.merchant_prepare_id}${p.amount}${action}${p.sign_time}`
    : `${p.click_trans_id}${p.service_id}${secret}${docId}${p.amount}${action}${p.sign_time}`
  if (!secret || md5(base) !== String(p.sign_string || '').toLowerCase()) {
    return reply({ error: ERR.SIGN, error_note: 'SIGN CHECK FAILED' })
  }

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  const [doc] = await sql`
    SELECT id, deal_id, account_id, total, currency, status, paid_at
    FROM sales_documents WHERE id = ${docId} AND org_id = ${ORG} LIMIT 1
  `
  if (!doc) return reply({ error: ERR.NOT_FOUND, error_note: 'Document not found' })

  // Сумму сверяем всегда: оферта на 7 млн не должна закрываться платежом на 1000
  if (Math.round(Number(doc.total || 0)) !== Math.round(amount)) {
    return reply({ error: ERR.AMOUNT, error_note: 'Incorrect amount' })
  }

  const common = {
    click_trans_id: p.click_trans_id,
    merchant_trans_id: docId,
    merchant_prepare_id: docId,
    error: ERR.OK,
    error_note: 'Success',
  }

  if (action === '0') {
    if (doc.paid_at) return reply({ ...common, error: ERR.ALREADY_PAID, error_note: 'Already paid' })
    return reply(common)
  }

  if (action === '1') {
    if (doc.paid_at) return reply({ ...common, merchant_confirm_id: docId })

    await sql`
      UPDATE sales_documents
      SET paid_at = NOW(), accepted_at = COALESCE(accepted_at, NOW()), status = 'paid', updated_at = NOW()
      WHERE id = ${doc.id}
    `
    // Оплаченная оферта — это и есть закрытие сделки: клиент принял условия
    // и заплатил, подписывать нечего
    if (doc.deal_id) {
      const [wonStage] = await sql`
        SELECT id FROM sales_stages
        WHERE org_id = ${ORG} AND pipeline = 'sales' AND kind = 'won' LIMIT 1
      `
      await sql`
        UPDATE sales_deals
        SET paid_at = NOW(), won_at = COALESCE(won_at, NOW()),
            stage_id = COALESCE(${wonStage?.id || null}, stage_id),
            stage_since = NOW(), updated_at = NOW()
        WHERE id = ${doc.deal_id} AND org_id = ${ORG}
      `
      await sql`
        INSERT INTO sales_deal_events (org_id, deal_id, new_stage_id, changed_by)
        VALUES (${ORG}, ${doc.deal_id}, ${wonStage?.id || null}, 'оплата по оферте (Click)')
      `
    }
    if (doc.account_id) {
      await sql`UPDATE sales_accounts SET lifecycle = 'customer' WHERE id = ${doc.account_id}`
    }
    return reply({ ...common, merchant_confirm_id: docId })
  }

  return reply({ error: ERR.ACTION, error_note: 'Action not found' })
}
