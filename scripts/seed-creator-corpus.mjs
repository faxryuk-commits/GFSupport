#!/usr/bin/env node
/**
 * Сид корпуса стиля для «Креатора»: посты канала @deleverme → creator_corpus.
 *
 * Историю канала Bot API не отдаёт (бот-админ видит только новые посты),
 * поэтому источник — веб-превью t.me/s/deleverme с пагинацией ?before=.
 * Запускается локально, повторный прогон безопасен (upsert по id поста).
 *
 *   node scripts/seed-creator-corpus.mjs          # собрать из t.me и залить
 *   node scripts/seed-creator-corpus.mjs file.json # залить из готового JSON
 */
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const url = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!url) { console.error('нет DATABASE_URL (vercel env pull .env.local)'); process.exit(1) }
const sql = neon(url)

function langOf(t) {
  const uz = (t.toLowerCase().match(/[ўқғҳ]|\b(va|uchun|bilan|bo'l|qil)\b/g) || []).length
  return uz > 2 ? 'uz' : 'ru'
}

async function collect() {
  const posts = new Map()
  let before = null
  for (let i = 0; i < 60; i++) {
    const u = 'https://t.me/s/deleverme' + (before ? `?before=${before}` : '')
    const t = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text())
    const blocks = [...t.matchAll(/data-post="deleverme\/(\d+)"([\s\S]*?)(?=data-post="deleverme\/|tgme_widget_message_history_end|$)/g)]
    if (!blocks.length) break
    const ids = []
    for (const [, pid, bodyHtml] of blocks) {
      const id = Number(pid)
      ids.push(id)
      const m = bodyHtml.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      let text = ''
      if (m) {
        text = m[1].replace(/<br\/?>/g, '\n').replace(/<[^>]+>/g, '')
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim()
      }
      const d = bodyHtml.match(/datetime="([^"]+)"/)
      const v = bodyHtml.match(/tgme_widget_message_views">([^<]+)</)
      posts.set(id, { id, date: d?.[1] || null, views: v?.[1] || null, text })
    }
    const min = Math.min(...ids)
    if (before !== null && min >= before) break
    before = min
    await new Promise(r => setTimeout(r, 700))
  }
  return [...posts.values()]
}

// Таблица создаётся и обработчиком, но сид может бежать до первого запроса
await sql`
  CREATE TABLE IF NOT EXISTS creator_corpus (
    id bigint PRIMARY KEY,
    posted_at timestamptz,
    views text,
    lang text,
    text text NOT NULL
  )`

const fromFile = process.argv[2]
const posts = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : await collect()
const rows = posts.filter(p => p.text && p.text.length > 100)
console.log(`постов всего: ${posts.length}, с текстом: ${rows.length}`)

// Пачками, не по одному: дорога до базы ~190 мс за заход
const BATCH = 50
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH)
  await sql.transaction(chunk.map(p => sql`
    INSERT INTO creator_corpus (id, posted_at, views, lang, text)
    VALUES (${p.id}, ${p.date}, ${p.views}, ${langOf(p.text)}, ${p.text})
    ON CONFLICT (id) DO UPDATE SET views = EXCLUDED.views, text = EXCLUDED.text`))
  console.log(`  залито ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
}
const [{ n }] = await sql`SELECT count(*)::int AS n FROM creator_corpus`
console.log(`в creator_corpus: ${n}`)
