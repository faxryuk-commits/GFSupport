import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { generateFromTemplate } from '../lib/google-docs.js'

export const config = { runtime: 'edge' }

/**
 * Генерация файла договора из шаблона Google Docs.
 *
 * POST { documentId }  — документ должен быть уже создан (kind = contract | act |
 *                        partner_contract) и иметь номер
 *
 * Ссылка на готовый файл сохраняется в документе: бухгалтерии уходит именно она,
 * а не вложение. Правки в файле остаются в Google — мы не пытаемся быть
 * редактором документов, мы ведём сделку.
 *
 * Переменные: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_CONTRACTS_FOLDER_ID
 * и id шаблонов в справочнике sales_doc_templates (поле entity.google_template_id).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body?.documentId) return json({ error: 'documentId is required' }, 400)

  const [doc] = await sql`
    SELECT * FROM sales_documents WHERE id = ${body.documentId} AND org_id = ${orgId} LIMIT 1
  `
  if (!doc) return json({ error: 'not found' }, 404)
  if (doc.kind === 'quote') {
    return json({ error: 'КП отправляется ссылкой, файл для него не нужен' }, 400)
  }

  const [deal] = await sql`SELECT * FROM sales_deals WHERE id = ${doc.deal_id} LIMIT 1`
  const [account] = await sql`SELECT * FROM sales_accounts WHERE id = ${doc.account_id} LIMIT 1`
  const [tpl] = await sql`
    SELECT * FROM sales_doc_templates WHERE id = ${doc.template_id || ''} LIMIT 1
  `
  const googleTemplateId = tpl?.entity?.google_template_id || process.env.GOOGLE_CONTRACT_TEMPLATE_ID
  if (!googleTemplateId) {
    return json({
      error: 'Не задан шаблон Google Docs. Укажите google_template_id в справочнике шаблонов ' +
             'или GOOGLE_CONTRACT_TEMPLATE_ID в переменных окружения.',
    }, 400)
  }

  const entity = tpl?.entity || {}
  const req_ = doc.requisites || {}
  const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

  // Плейсхолдеры те же, что в текстовом шаблоне справочника: один набор имён
  // на оба пути, чтобы юрист не держал в голове две системы обозначений
  const values: Record<string, string> = {
    '{{contract_number}}': doc.number || '',
    '{{contract_date}}': today,
    '{{city}}': entity.city || account?.city || '',
    '{{licensor_legal}}': entity.legal || '',
    '{{licensor_signer}}': entity.signer || '',
    '{{licensor_basis}}': entity.basis || 'на основании Устава',
    '{{licensor_requisites}}': [entity.bin ? `БИН ${entity.bin}` : '', entity.kbe ? `КБе ${entity.kbe}` : '',
      entity.account || '', entity.bank || '', entity.bik ? `БИК ${entity.bik}` : '', entity.address || '']
      .filter(Boolean).join(', '),
    '{{client_legal}}': deal?.legal_name || req_.legal_name || account?.name || '',
    '{{client_signer}}': deal?.dm_name || req_.signer || '',
    '{{client_signer_title}}': req_.signer_title || 'Директор',
    '{{client_basis}}': req_.basis || 'на основании Устава',
    '{{client_inn}}': account?.inn || req_.inn || '',
    '{{client_bin}}': req_.bin || account?.inn || '',
    '{{client_kbe}}': req_.kbe || '',
    '{{client_bank}}': req_.bank || '',
    '{{client_bik}}': req_.bik || '',
    '{{client_mfo}}': req_.mfo || '',
    '{{client_account}}': req_.account || '',
    '{{client_address}}': req_.address || '',
    '{{client_requisites}}': [req_.bank, req_.account, req_.address].filter(Boolean).join(', '),
    '{{tariff}}': deal?.tariff || '',
    '{{points}}': String(deal?.points ?? ''),
    '{{monthly_amount}}': deal?.monthly_amount ? Number(deal.monthly_amount).toLocaleString('ru-RU') : '',
    '{{currency}}': doc.currency || deal?.currency || '',
    '{{total}}': doc.total ? Number(doc.total).toLocaleString('ru-RU') : '',
    '{{term_months}}': String(deal?.term_months ?? ''),
    '{{start_date}}': deal?.start_date
      ? new Date(deal.start_date).toLocaleDateString('ru-RU') : '',
    '{{manager}}': ctx.agentId || '',
    '{{partner_kind}}': account?.partner_kind || '',
    '{{partner_territory}}': account?.market_id || '',
    '{{partner_fee}}': account?.partner_terms?.fee || '',
    '{{partner_settlement}}': account?.partner_terms?.settlement || '',
  }

  const name = `${doc.kind === 'act' ? 'Акт' : 'Договор'} №${doc.number || doc.id} — ${account?.name || ''}`.trim()
  const result = await generateFromTemplate(googleTemplateId, name, values)
  if (!result.ok) return json({ error: result.error }, 502)

  await sql`
    UPDATE sales_documents SET file_url = ${result.url}, updated_at = NOW()
    WHERE id = ${doc.id}
  `

  return json({ ok: true, url: result.url, pdfUrl: result.pdfUrl, documentId: result.documentId })
}
