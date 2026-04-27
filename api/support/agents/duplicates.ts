import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

/**
 * GET  /api/support/agents/duplicates
 *   → возвращает группы дубликатов сотрудников (≥2 записи на одного человека).
 *   Признаки:
 *     - совпадение нормализованного имени (lowercase + транслитерация кир→лат + удаление пробелов/символов)
 *     - совпадение telegram_id (если у обоих заполнен)
 *     - совпадение email
 *
 * POST /api/support/agents/duplicates
 *   body: { keepId: string, mergeIds: string[] }
 *   → перевешивает ссылки (assigned_to, sender_name) на keepId,
 *     объединяет метрики (best-of), удаляет mergeIds из support_agents.
 */

const RU_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function normalizeName(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input).toLowerCase().trim()
  // Удаляем эмодзи и не-буквенно-цифровые символы (оставляем буквы кир/лат и цифры)
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  // Транслитерируем кириллицу
  s = s.split('').map((ch) => RU_TO_LAT[ch] ?? ch).join('')
  // Сжимаем пробелы и удаляем
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

interface AgentRow {
  id: string
  name: string
  username: string | null
  email: string | null
  role: string
  status: string | null
  telegram_id: string | null
  created_at: string | null
  last_active_at: string | null
  total_messages: number
  total_cases: number
}

interface DuplicateGroup {
  key: string
  reason: 'name' | 'telegram_id' | 'email'
  members: Array<{
    id: string
    name: string
    username: string | null
    email: string | null
    role: string
    status: string | null
    telegramId: string | null
    createdAt: string | null
    lastActiveAt: string | null
    totalMessages: number
    totalCases: number
    isRecommendedKeep: boolean
  }>
}

function groupAgents(agents: AgentRow[]): DuplicateGroup[] {
  const byNorm = new Map<string, AgentRow[]>()
  const byTg = new Map<string, AgentRow[]>()
  const byEmail = new Map<string, AgentRow[]>()

  for (const a of agents) {
    const n = normalizeName(a.name)
    if (n) {
      const arr = byNorm.get(n) || []
      arr.push(a)
      byNorm.set(n, arr)
    }
    if (a.telegram_id) {
      const k = String(a.telegram_id).trim()
      const arr = byTg.get(k) || []
      arr.push(a)
      byTg.set(k, arr)
    }
    if (a.email) {
      const k = String(a.email).trim().toLowerCase()
      const arr = byEmail.get(k) || []
      arr.push(a)
      byEmail.set(k, arr)
    }
  }

  const seen = new Set<string>() // ключ группы: отсортированные id членов
  const groups: DuplicateGroup[] = []

  function pushGroup(key: string, reason: DuplicateGroup['reason'], rows: AgentRow[]) {
    if (rows.length < 2) return
    const ids = rows.map((r) => r.id).sort().join('|')
    if (seen.has(ids)) return
    seen.add(ids)
    // Кандидат на сохранение: больше всего сообщений+кейсов; tie-breaker — admin > manager > agent; ранее созданный
    const ROLE_RANK: Record<string, number> = { admin: 3, manager: 2, agent: 1 }
    const sorted = [...rows].sort((a, b) => {
      const sa = a.total_messages + a.total_cases * 10
      const sb = b.total_messages + b.total_cases * 10
      if (sa !== sb) return sb - sa
      const ra = ROLE_RANK[a.role] || 0
      const rb = ROLE_RANK[b.role] || 0
      if (ra !== rb) return rb - ra
      const ta = a.created_at ? new Date(a.created_at).getTime() : Infinity
      const tb = b.created_at ? new Date(b.created_at).getTime() : Infinity
      return ta - tb
    })
    const keepId = sorted[0]?.id

    groups.push({
      key,
      reason,
      members: sorted.map((r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        email: r.email,
        role: r.role,
        status: r.status,
        telegramId: r.telegram_id,
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
        totalMessages: Number(r.total_messages || 0),
        totalCases: Number(r.total_cases || 0),
        isRecommendedKeep: r.id === keepId,
      })),
    })
  }

  for (const [k, rows] of byTg) pushGroup(`tg:${k}`, 'telegram_id', rows)
  for (const [k, rows] of byEmail) pushGroup(`email:${k}`, 'email', rows)
  for (const [k, rows] of byNorm) pushGroup(`name:${k}`, 'name', rows)

  return groups
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // ---------- GET: список групп дубликатов ----------
  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          a.id, a.name, a.username, a.email, a.role, a.status, a.telegram_id,
          a.created_at, a.last_active_at,
          COALESCE(msg.cnt, 0)::int AS total_messages,
          COALESCE(cs.cnt, 0)::int AS total_cases
        FROM support_agents a
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
          FROM support_messages m
          WHERE m.org_id = a.org_id
            AND (
              m.sender_id::text = a.telegram_id::text
              OR LOWER(m.sender_username) = LOWER(a.username)
              OR LOWER(m.sender_name) = LOWER(a.name)
            )
            AND m.is_from_client = false
        ) msg ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
          FROM support_cases c
          WHERE c.org_id = a.org_id AND c.assigned_to::text = a.id::text
        ) cs ON true
        WHERE a.org_id = ${orgId}
        ORDER BY a.created_at ASC
      `
      const groups = groupAgents(rows as AgentRow[])
      return json({ groups, total: groups.length })
    } catch (e: any) {
      console.error('[duplicates GET]', e)
      return json({ error: e?.message || 'failed' }, 500)
    }
  }

  // ---------- POST: слияние ----------
  if (req.method === 'POST') {
    let body: { keepId?: string; mergeIds?: string[] }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }

    const keepId = String(body?.keepId || '').trim()
    const mergeIds = Array.isArray(body?.mergeIds)
      ? body!.mergeIds!.map((x) => String(x).trim()).filter((x) => x && x !== keepId)
      : []
    if (!keepId || mergeIds.length === 0) {
      return json({ error: 'keepId and mergeIds[] are required' }, 400)
    }

    try {
      const [keepRow] = await sql`
        SELECT id, name, telegram_id, email, username FROM support_agents
        WHERE id = ${keepId} AND org_id = ${orgId} LIMIT 1
      `
      if (!keepRow) return json({ error: 'keep_agent_not_found' }, 404)

      const mergeRows = await sql`
        SELECT id, name, telegram_id, email, username FROM support_agents
        WHERE id = ANY(${mergeIds}) AND org_id = ${orgId}
      `
      if (mergeRows.length === 0) return json({ error: 'merge_agents_not_found' }, 404)
      const realMergeIds = mergeRows.map((r: any) => r.id)

      // 1) Перевешиваем кейсы
      const reassignedCases = await sql`
        UPDATE support_cases
        SET assigned_to = ${keepId}, updated_at = NOW()
        WHERE org_id = ${orgId} AND assigned_to::text = ANY(${realMergeIds})
        RETURNING id
      `

      // 2) Перевешиваем коммитменты (если поле есть)
      let reassignedCommitments: any[] = []
      try {
        reassignedCommitments = await sql`
          UPDATE support_commitments
          SET promised_by = ${keepId}
          WHERE org_id = ${orgId} AND promised_by::text = ANY(${realMergeIds})
          RETURNING id
        `
      } catch { /* колонка может отсутствовать */ }

      // 3) Если у keep пусто, забираем недостающие поля из дубликатов
      const keepTg = keepRow.telegram_id
      const keepEmail = keepRow.email
      const keepUsername = keepRow.username

      const fillTg = !keepTg ? mergeRows.find((r: any) => r.telegram_id)?.telegram_id : null
      const fillEmail = !keepEmail ? mergeRows.find((r: any) => r.email)?.email : null
      const fillUsername = !keepUsername ? mergeRows.find((r: any) => r.username)?.username : null

      if (fillTg || fillEmail || fillUsername) {
        await sql`
          UPDATE support_agents
          SET
            telegram_id = COALESCE(telegram_id, ${fillTg || null}),
            email = COALESCE(email, ${fillEmail || null}),
            username = COALESCE(username, ${fillUsername || null}),
            updated_at = NOW()
          WHERE id = ${keepId} AND org_id = ${orgId}
        `
      }

      // 4) Удаляем сессии дубликатов (FK)
      try {
        await sql`DELETE FROM support_agent_sessions WHERE agent_id::text = ANY(${realMergeIds})`
      } catch {}

      // 5) Удаляем самих дубликатов
      const deleted = await sql`
        DELETE FROM support_agents
        WHERE id = ANY(${realMergeIds}) AND org_id = ${orgId}
        RETURNING id
      `

      return json({
        ok: true,
        keepId,
        mergedIds: realMergeIds,
        reassignedCases: reassignedCases.length,
        reassignedCommitments: reassignedCommitments.length,
        deletedAgents: deleted.length,
      })
    } catch (e: any) {
      console.error('[duplicates POST]', e)
      return json({ error: 'merge_failed', message: e?.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
