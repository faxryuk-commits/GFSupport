import { getRequestOrgId } from '../_lib/org.js'
import { getSQL, json, corsHeaders } from '../_lib/db.js'
import { extractAgentContext } from '../_lib/auth.js'
import { ensureSalesSchema, salesId } from '../_lib/sales-schema.js'
import { sendNotification } from '../_lib/notifications.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Внутренняя переписка при карточке: сотрудники между собой, клиент не видит.
 *
 * Разговор о клиенте шёл в Telegram, и через месяц «а что мы тогда решили»
 * искали по чатам. Здесь ветка живёт при сделке или обращении: упомянул
 * коллегу — ему пришло уведомление со ссылкой на карточку; отметил «как
 * задачу» — сообщение стало задачей с исполнителем и сроком; приложил файл —
 * он остался при карточке, а не в чьей-то личке.
 *
 * GET    ?dealId= | ?leadId= | ?accountId=
 * POST   { dealId?, leadId?, accountId?, text, mentions?: [agentId], attachments?: [{url,name,size,type}],
 *          task?: { dueAt, assigneeAgentId? } }
 * POST   ?action=upload   multipart: file → { url, name, size, type }
 * DELETE ?id=
 */

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || ''
const MAX_BYTES = 25 * 1024 * 1024

let tableReady = false
async function ensureTable(sql: any): Promise<void> {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS sales_comments (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      deal_id VARCHAR(50),
      lead_id VARCHAR(50),
      account_id VARCHAR(50),
      author_agent_id VARCHAR(60),
      text TEXT NOT NULL,
      mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      task_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_comments_deal ON sales_comments (deal_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_comments_lead ON sales_comments (lead_id)`
  tableReady = true
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const url = new URL(req.url)
  const orgId = await getRequestOrgId(req)
  await ensureSalesSchema(sql, orgId)
  await ensureTable(sql)

  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  const action = url.searchParams.get('action')

  // ─── Файл к сообщению ───────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'upload') {
    if (!BLOB_TOKEN) return json({ error: 'Хранилище файлов не настроено' }, 500)
    let file: File | null = null
    try {
      const f = (await req.formData()).get('file')
      if (f instanceof File) file = f
    } catch { return json({ error: 'Не удалось прочитать файл' }, 400) }
    if (!file) return json({ error: 'Файл не приложен' }, 400)
    if (file.size > MAX_BYTES) return json({ error: 'Файл больше 25 МБ' }, 413)

    // Имя в адресе обезличено: адрес живёт долго и попадает в уведомления
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = `sales/threads/${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    const res = await fetch(`https://blob.vercel-storage.com/${key}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${BLOB_TOKEN}`,
        'x-api-version': '7',
        'x-content-type': file.type || 'application/octet-stream',
        'x-add-random-suffix': '0',
        'x-cache-control-max-age': '31536000',
      },
      body: await file.arrayBuffer(),
    })
    if (!res.ok) return json({ error: 'Хранилище не приняло файл' }, 502)
    const data: any = await res.json()
    return json({ ok: true, url: data?.url, name: file.name, size: file.size, type: file.type || null })
  }

  // ─── Сообщение ──────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const text = String(body?.text || '').trim().slice(0, 4000)
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments.filter((a: any) => a?.url).slice(0, 10)
          .map((a: any) => ({ url: String(a.url), name: String(a.name || 'файл').slice(0, 200),
                              size: Number(a.size || 0), type: a.type ? String(a.type) : null }))
      : []
    if (!text && !attachments.length) return json({ error: 'Пустое сообщение' }, 400)
    if (!body?.dealId && !body?.leadId && !body?.accountId) {
      return json({ error: 'Сообщение должно быть к сделке, обращению или клиенту' }, 400)
    }
    const mentions: string[] = Array.isArray(body?.mentions)
      ? [...new Set<string>(body.mentions.map((m: unknown) => String(m)))].filter(id => id !== ctx.agentId).slice(0, 20) : []

    let accountId: string | null = body.accountId || null
    if (!accountId && body.dealId) {
      const [d] = await sql`SELECT account_id FROM sales_deals WHERE id = ${body.dealId} AND org_id = ${orgId} LIMIT 1` as any[]
      accountId = d?.account_id || null
    }

    // «Как задачу»: сообщение становится задачей тем же путём, что и из
    // карточки, — с уведомлением исполнителю и записью следующего шага
    let taskId: string | null = null
    if (body?.task && text) {
      try {
        const r = await fetch(new URL('/api/support/sales/tasks', req.url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers.get('authorization') || '',
            'X-Org-Id': req.headers.get('x-org-id') || '',
          },
          body: JSON.stringify({
            dealId: body.dealId || undefined, leadId: body.leadId || undefined,
            accountId: accountId || undefined,
            title: text.slice(0, 500), kind: 'task',
            dueAt: body.task.dueAt || undefined,
            assigneeAgentId: body.task.assigneeAgentId || mentions[0] || undefined,
          }),
        })
        const j: any = await r.json().catch(() => null)
        if (r.ok && j?.id) taskId = String(j.id)
      } catch { /* задача не встала — сообщение всё равно сохраняем */ }
    }

    const id = salesId('sc')
    await sql`
      INSERT INTO sales_comments (id, org_id, deal_id, lead_id, account_id, author_agent_id,
                                  text, mentions, attachments, task_id)
      VALUES (${id}, ${orgId}, ${body.dealId || null}, ${body.leadId || null}, ${accountId},
              ${ctx.agentId}, ${text}, ${JSON.stringify(mentions)}::jsonb,
              ${JSON.stringify(attachments)}::jsonb, ${taskId})
    `

    if (mentions.length) {
      const [me] = await sql`SELECT name FROM support_agents WHERE id = ${ctx.agentId} LIMIT 1` as any[]
      const link = body.dealId ? `/sales/deals/${body.dealId}`
        : body.leadId ? `/sales/leads/${body.leadId}` : `/sales/accounts/${accountId}`
      await sendNotification({
        orgId, type: 'tag', priority: 'medium',
        title: `${me?.name || 'Коллега'} упомянул вас в карточке`,
        body: (text || attachments[0]?.name || '').slice(0, 140),
        link, targetAgentIds: mentions,
      }).catch(() => {})
    }
    return json({ ok: true, id, taskId })
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id is required' }, 400)
    const [row] = await sql`SELECT author_agent_id FROM sales_comments WHERE id = ${id} AND org_id = ${orgId} LIMIT 1` as any[]
    if (!row) return json({ error: 'not found' }, 404)
    if (row.author_agent_id !== ctx.agentId && !ctx.isLead) {
      return json({ error: 'Удалить чужое сообщение может только руководитель' }, 403)
    }
    await sql`DELETE FROM sales_comments WHERE id = ${id} AND org_id = ${orgId}`
    return json({ ok: true })
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const dealId = url.searchParams.get('dealId') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const accountId = url.searchParams.get('accountId') || ''
  if (!dealId && !leadId && !accountId) return json({ error: 'dealId, leadId or accountId is required' }, 400)
  const comments = await sql`
    SELECT c.id, c.deal_id, c.lead_id, c.text, c.mentions, c.attachments, c.task_id, c.created_at,
           c.author_agent_id, ag.name AS author_name,
           t.done_at AS task_done_at, t.due_at AS task_due_at, ta.name AS task_assignee
    FROM sales_comments c
    LEFT JOIN support_agents ag ON ag.id = c.author_agent_id
    LEFT JOIN sales_tasks t ON t.id = c.task_id
    LEFT JOIN support_agents ta ON ta.id = t.assignee_agent_id
    WHERE c.org_id = ${orgId}
      AND ((${dealId} <> '' AND c.deal_id = ${dealId})
        OR (${leadId} <> '' AND c.lead_id = ${leadId})
        OR (${accountId} <> '' AND ${dealId} = '' AND ${leadId} = '' AND c.account_id = ${accountId}))
    ORDER BY c.created_at ASC
    LIMIT 300
  `
  return json({ comments })
}
