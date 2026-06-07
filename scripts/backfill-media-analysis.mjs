// Backfill разбора медиа в support_messages.
// Шаг 1 (бесплатно): text_content ← COALESCE(text_content, ai_summary, transcript)
//                    для уже разобранных медиа, у которых text_content пуст.
// Шаг 2 (OpenAI):    прогнать неразобранные медиа через Vision/Whisper.
//                    Telegram media хранится как tg://type/file_id → резолвим
//                    скачиваемый URL через getFile (часть старых file_id могла
//                    протухнуть — такие пропускаем, скрипт идемпотентен/возобновляем).
//
// Запуск: node scripts/backfill-media-analysis.mjs
//   --dry            только показать, что будет сделано, без записи
//   --skip-free      не делать шаг 1
//   --skip-analyze   не делать шаг 2
//   --limit=N        ограничить число медиа на разбор (для пробного прогона)
//   --concurrency=N  параллелизм запросов к OpenAI (по умолчанию 6)
//
// Креды: process.env (CI) или .env.local. Нужны POSTGRES_URL/DATABASE_URL,
//        OPENAI_API_KEY, TELEGRAM_BOT_TOKEN.
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'

const env = { ...process.env }
const ENVPATH = new URL('../.env.local', import.meta.url)
if (existsSync(ENVPATH)) for (const line of readFileSync(ENVPATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valOf = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d }
const DRY = has('--dry')
const SKIP_FREE = has('--skip-free')
const SKIP_ANALYZE = has('--skip-analyze')
const SKIP_TG = has('--skip-tg') // пропускать tg:// (legacy file_id ретро-бота — не резолвятся)
const LIMIT = parseInt(valOf('limit', '0')) || 0
const CONCURRENCY = parseInt(valOf('concurrency', '6')) || 6

const sql = neon(env.POSTGRES_URL || env.NEON_URL || env.DATABASE_URL)
const OPENAI = env.OPENAI_API_KEY

// Telegram bot token: админский (support_platform_settings.platform_bot_token) →
// per-org support_settings → env. NB: file_id привязан к боту — legacy-медиа из
// импорта другого бота не резолвятся ни одним токеном (см. telegram_media_pipeline).
async function resolveBotToken() {
  const cliTok = valOf('token', '')
  if (cliTok) return cliTok
  try { const [r] = await sql`SELECT value FROM support_platform_settings WHERE key='platform_bot_token' LIMIT 1`; if (r?.value) return r.value } catch {}
  try { const [r] = await sql`SELECT value FROM support_settings WHERE key='telegram_bot_token' AND value<>'' LIMIT 1`; if (r?.value) return r.value } catch {}
  return env.TELEGRAM_BOT_TOKEN || null
}
let BOT_TOKEN = null

const AUDIO_TYPES = new Set(['voice', 'audio', 'video', 'video_note'])
const isPhoto = (ct, mime) => ct === 'photo' || (ct === 'document' && (mime || '').startsWith('image/'))
const isAudio = (ct) => AUDIO_TYPES.has(ct)

// --- resolve a downloadable URL from a stored media_url ---
function tgFileId(url) {
  if (!url || !url.startsWith('tg://')) return null
  const parts = url.replace('tg://', '').split('/')
  return parts.length >= 2 ? parts.slice(1).join('/') : (parts[0] || null)
}
async function resolveDownloadUrl(mediaUrl) {
  if (!mediaUrl) return null
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) return mediaUrl
  const fid = tgFileId(mediaUrl)
  if (!fid || !BOT_TOKEN) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fid}`)
    const data = await res.json()
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`
    }
  } catch {}
  return null
}

// --- OpenAI calls (mirror webhook logic) ---
async function transcribeAudio(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const form = new FormData()
    form.append('file', blob, 'audio.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'ru')
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI}` }, body: form,
    })
    if (!r.ok) return null
    const data = await r.json()
    return data.text?.trim() || null
  } catch { return null }
}
async function analyzePhoto(url) {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Опиши содержание этого изображения в 1-2 предложениях на русском. Если это скриншот ошибки или интерфейса — опиши что видно. Если текст — перепиши его.' },
          { type: 'image_url', image_url: { url, detail: 'low' } },
        ] }],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return null
    const data = await r.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch { return null }
}

// --- simple concurrency pool ---
async function pool(items, n, worker) {
  const results = []
  let i = 0
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  if (!OPENAI && !SKIP_ANALYZE) { console.error('OPENAI_API_KEY required for analysis'); process.exit(1) }
  BOT_TOKEN = await resolveBotToken()
  console.log(`[backfill] dry=${DRY} skipFree=${SKIP_FREE} skipAnalyze=${SKIP_ANALYZE} skipTg=${SKIP_TG} limit=${LIMIT || '∞'} concurrency=${CONCURRENCY} botToken=${BOT_TOKEN ? 'id '+BOT_TOKEN.split(':')[0] : 'NONE'}`)

  // ===== Шаг 1: бесплатный backfill text_content из уже готовых summary/transcript =====
  if (!SKIP_FREE) {
    const [{ n: candidates }] = await sql`
      SELECT COUNT(*)::int AS n FROM support_messages
      WHERE (text_content IS NULL OR text_content = '')
        AND (NULLIF(ai_summary,'') IS NOT NULL OR NULLIF(transcript,'') IS NOT NULL)`
    console.log(`[free] кандидатов (разобрано, но text_content пуст): ${candidates}`)
    if (!DRY && candidates > 0) {
      const updated = await sql`
        UPDATE support_messages
        SET text_content = COALESCE(NULLIF(ai_summary,''), NULLIF(transcript,''))
        WHERE (text_content IS NULL OR text_content = '')
          AND (NULLIF(ai_summary,'') IS NOT NULL OR NULLIF(transcript,'') IS NOT NULL)
        RETURNING id`
      console.log(`[free] ✅ обновлено строк: ${updated.length}`)
    }
  }

  // ===== Шаг 2: разбор неразобранных медиа через OpenAI =====
  if (!SKIP_ANALYZE) {
    const rows = await sql`
      SELECT id, org_id, content_type, media_url, mime_type
      FROM support_messages
      WHERE content_type IN ('photo','voice','audio','video','video_note','document')
        AND (text_content IS NULL OR text_content = '')
        AND (ai_summary IS NULL OR ai_summary = '')
        AND (transcript IS NULL OR transcript = '')
        AND media_url IS NOT NULL
        ${SKIP_TG ? sql`AND media_url NOT LIKE 'tg://%' AND media_url NOT LIKE '%api.telegram.org/file%'` : sql``}
      ORDER BY created_at DESC
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`
    // только медиа, которые мы умеем разбирать
    const todo = rows.filter((r) => isPhoto(r.content_type, r.mime_type) || isAudio(r.content_type))
    console.log(`[analyze] к разбору: ${todo.length} (photo/voice/video/...) из ${rows.length} выбранных`)

    if (DRY) {
      const byType = {}
      for (const r of todo) byType[r.content_type] = (byType[r.content_type] || 0) + 1
      console.log('[analyze] dry-run, по типам:', byType)
      return
    }

    let ok = 0, unresolved = 0, failed = 0, done = 0
    await pool(todo, CONCURRENCY, async (r) => {
      const url = await resolveDownloadUrl(r.media_url)
      done++
      if (!url) { unresolved++; if (done % 50 === 0) tick(); return }
      let transcript = null, summary = null
      if (isAudio(r.content_type)) transcript = await transcribeAudio(url)
      else if (isPhoto(r.content_type, r.mime_type)) summary = await analyzePhoto(url)
      if (!transcript && !summary) { failed++; if (done % 50 === 0) tick(); return }
      await sql`
        UPDATE support_messages SET
          transcript = COALESCE(${transcript}, transcript),
          ai_summary = COALESCE(${summary}, ai_summary),
          text_content = COALESCE(text_content, ${transcript || summary})
        WHERE id = ${r.id} AND org_id = ${r.org_id}`.catch(() => {})
      ok++
      if (done % 50 === 0) tick()
    })
    function tick() { console.log(`[analyze] прогресс ${done}/${todo.length} — ok=${ok} unresolved=${unresolved} failed=${failed}`) }
    console.log(`[analyze] ✅ готово: разобрано=${ok}, не_резолвится(протух file_id)=${unresolved}, разбор_не_удался=${failed}, всего=${todo.length}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
