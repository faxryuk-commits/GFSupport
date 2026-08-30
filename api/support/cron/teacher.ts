import { getSQL, json } from '../lib/db.js'
import { assertCron, cronSecured } from '../lib/cron-auth.js'
import { ensureReplyExamplesSchema, addExample } from '../lib/reply-examples.js'
import { logEvent } from '../lib/system-journal.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Учитель — немедленная половина самообучения.
 *
 * Раз в полчаса собирает свежие ответы команды, находит для каждого вопрос
 * клиента, к которому он относился, и кладёт пару в базу примеров. Следующий
 * похожий вопрос уже увидит этот ответ в черновике — без всякого дообучения.
 *
 * Фильтры выучены на чистке исторических троек:
 * - рассылка руками во все каналы — не ответ (один текст в ≥3 каналах за проход);
 * - ссылки вместо ответа — не учат;
 * - ответ через 2+ часа — скорее новый разговор, чем ответ на этот вопрос.
 */
const ORG = process.env.SALES_ORG || 'org_delever'
const CURSOR = 'teacher_cursor'

function langOf(t: string): string {
  const cyr = (t.match(/[а-яё]/gi) || []).length
  const lat = (t.match(/[a-z]/gi) || []).length
  if (cyr + lat < 4) return 'other'
  return cyr >= lat ? 'ru' : 'uz'
}

/** Детерминированный id без node:crypto — edge-runtime дружит не со всем. */
function exampleId(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193)
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0x85ebca6b)
  }
  return 'rex_' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  const started = Date.now()
  try {
    await ensureReplyExamplesSchema(sql)
    const [cur] = await sql`SELECT value FROM support_platform_settings WHERE key = ${CURSOR}`
    const since = cur?.value || new Date(Date.now() - 3600_000).toISOString()

    // Ответ команды + ближайший вопрос клиента перед ним
    const pairs = await sql`
      SELECT r.id, r.text_content AS reply, r.sender_name, r.created_at, ch.name AS channel,
        c.text_content AS client_text, c.created_at AS client_at
      FROM support_messages r
      JOIN support_channels ch ON ch.id = r.channel_id AND ch.org_id = ${ORG} AND ch.type <> 'feed'
      LEFT JOIN LATERAL (
        SELECT m.text_content, m.created_at FROM support_messages m
        WHERE m.channel_id = r.channel_id AND m.is_from_client = true
          AND m.created_at < r.created_at
          AND m.created_at > r.created_at - INTERVAL '2 hours'
          AND m.text_content IS NOT NULL AND LENGTH(m.text_content) >= 8
        ORDER BY m.created_at DESC LIMIT 1
      ) c ON true
      WHERE r.sender_role = 'support' AND r.created_at > ${since}::timestamptz
        AND r.text_content IS NOT NULL AND LENGTH(r.text_content) >= 8
      ORDER BY r.created_at LIMIT 300
    ` as any[]

    const out = { picked: pairs.length, added: 0, broadcast: 0, noQuestion: 0, links: 0 }
    if (!pairs.length) return json({ ok: true, secured: cronSecured(), ms: Date.now() - started, ...out })

    // Рассылка: один и тот же текст в нескольких каналах за один проход
    const freq = new Map<string, Set<string>>()
    for (const p of pairs) {
      const k = String(p.reply).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
      const e = freq.get(k) || new Set(); e.add(p.channel); freq.set(k, e)
    }

    for (const p of pairs) {
      if (!p.client_text) { out.noQuestion++; continue }
      if (/https?:\/\//.test(p.reply)) { out.links++; continue }
      const k = String(p.reply).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
      if ((freq.get(k)?.size || 0) >= 3) { out.broadcast++; continue }
      const ok = await addExample(sql, ORG, {
        id: exampleId(p.id + '|' + p.created_at),
        clientText: p.client_text,
        humanReply: p.reply,
        sender: p.sender_name,
        lang: langOf(p.client_text),
        channel: p.channel,
        saidAt: p.created_at,
      })
      if (ok) out.added++
    }

    if (out.added > 0) {
      await logEvent(sql, 'Учитель', 'новые примеры',
        `база пополнена: +${out.added} пар «вопрос → ответ команды»`
        + (out.broadcast ? `, отсеяно рассылок: ${out.broadcast}` : ''))
    }
    const maxAt = pairs[pairs.length - 1].created_at
    await sql`
      INSERT INTO support_platform_settings (key, value, updated_at)
      VALUES (${CURSOR}, ${new Date(maxAt).toISOString()}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `
    return json({ ok: true, secured: cronSecured(), ms: Date.now() - started, ...out })
  } catch (e: any) {
    console.error('[teacher] failed:', e)
    return json({ ok: false, error: e?.message || 'failed' }, 200)
  }
}
