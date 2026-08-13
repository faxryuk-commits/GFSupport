import { createHash } from 'node:crypto'
import { getSQL } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'

/**
 * Приём оплаты по оферте через Click (Merchant API).
 *
 * Единственный обработчик модуля на обычном рантайме, а не на edge: Click
 * подписывает запросы MD5, а Web Crypto даёт только SHA. Поэтому и сигнатура
 * здесь классическая (req, res) — Vercel в Node-рантайме ожидает именно её,
 * с веб-сигнатурой функция падает с FUNCTION_INVOCATION_FAILED (проверено).
 *
 * merchant_trans_id = id документа-оферты. Оплата закрывает оферту и переводит
 * сделку в выигранную: клиент принял условия и заплатил, договор не нужен.
 *
 * Переменные: CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY, SALES_ORG.
 */

const ORG = process.env.SALES_ORG || 'org_delever'

const ERR = { OK: 0, SIGN: -1, AMOUNT: -2, ACTION: -3, ALREADY_PAID: -4, NOT_FOUND: -5 }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(200).json({ error: ERR.ACTION, error_note: 'method not allowed' })
    return
  }

  // Click шлёт form-urlencoded; Vercel разбирает его в req.body сам
  const p: Record<string, any> = req.body && typeof req.body === 'object' ? req.body : {}

  const secret = process.env.CLICK_SECRET_KEY || ''
  const action = String(p.action ?? '')
  const docId = String(p.merchant_trans_id || '')
  const amount = Number(p.amount || 0)

  // Подпись: click_trans_id + service_id + SECRET + merchant_trans_id
  // [+ merchant_prepare_id для complete] + amount + action + sign_time
  const base = action === '1'
    ? `${p.click_trans_id}${p.service_id}${secret}${docId}${p.merchant_prepare_id}${p.amount}${action}${p.sign_time}`
    : `${p.click_trans_id}${p.service_id}${secret}${docId}${p.amount}${action}${p.sign_time}`
  const expected = createHash('md5').update(base).digest('hex')
  if (!secret || expected !== String(p.sign_string || '').toLowerCase()) {
    res.status(200).json({ error: ERR.SIGN, error_note: 'SIGN CHECK FAILED' })
    return
  }

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  const [doc] = await sql`
    SELECT d.id, d.deal_id, d.account_id, d.total, d.currency, d.status, d.paid_at,
           COALESCE(sd.pipeline, 'sales') AS pipeline
    FROM sales_documents d
    LEFT JOIN sales_deals sd ON sd.id = d.deal_id
    WHERE d.id = ${docId} AND d.org_id = ${ORG} LIMIT 1
  `
  if (!doc) {
    res.status(200).json({ error: ERR.NOT_FOUND, error_note: 'Document not found' })
    return
  }

  // Сумму сверяем всегда: оферта на 7 млн не должна закрываться платежом на 1000
  if (Math.round(Number(doc.total || 0)) !== Math.round(amount)) {
    res.status(200).json({ error: ERR.AMOUNT, error_note: 'Incorrect amount' })
    return
  }

  const common = {
    click_trans_id: p.click_trans_id,
    merchant_trans_id: docId,
    merchant_prepare_id: docId,
    error: ERR.OK,
    error_note: 'Success',
  }

  if (action === '0') {
    if (doc.paid_at) {
      res.status(200).json({ ...common, error: ERR.ALREADY_PAID, error_note: 'Already paid' })
      return
    }
    res.status(200).json(common)
    return
  }

  if (action === '1') {
    if (doc.paid_at) {
      res.status(200).json({ ...common, merchant_confirm_id: docId })
      return
    }

    await sql`
      UPDATE sales_documents
      SET paid_at = NOW(), accepted_at = COALESCE(accepted_at, NOW()), status = 'paid', updated_at = NOW()
      WHERE id = ${doc.id}
    `
    // Оплаченная оферта и есть закрытие сделки: клиент принял условия и заплатил
    if (doc.deal_id) {
      const [wonStage] = await sql`
        SELECT id FROM sales_stages
        WHERE org_id = ${ORG} AND pipeline = ${doc.pipeline} AND kind = 'won' LIMIT 1
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
    res.status(200).json({ ...common, merchant_confirm_id: docId })
    return
  }

  res.status(200).json({ error: ERR.ACTION, error_note: 'Action not found' })
}
