// Пересчёт таксономии обращений + статусов каналов → сид в БД.
// Запускается по расписанию (GitHub Actions) или вручную: node scripts/recompute-taxonomy.mjs
// Креды: process.env (CI) или .env.local (локально). Нужны POSTGRES_URL + OPENAI_API_KEY.
import { readFileSync, existsSync } from 'fs'
import { neon } from '@neondatabase/serverless'

const env = { ...process.env }
const ENVPATH = new URL('../.env.local', import.meta.url)
if (existsSync(ENVPATH)) for (const line of readFileSync(ENVPATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sql = neon(env.POSTGRES_URL || env.NEON_URL || env.DATABASE_URL)
const OPENAI = env.OPENAI_API_KEY
const ORG = env.RECOMPUTE_ORG || 'org_delever'
const WINDOW = 60
const now = new Date().toISOString()
if (!OPENAI) { console.error('OPENAI_API_KEY required'); process.exit(1) }

const TAX = {
  orders: ['не_пробился_в_кассу','не_отображается','неверный_статус','дубль_заказа','чек_не_вышел','отмена','тестовый_заказ','оплата','доставка_курьер','предзаказ','цена_сумма_неверна','не_конкретизировано'],
  menu: ['добавить_позицию','обновить_меню','изменить_цену','удалить_позицию','модификаторы','отображение_позиций','выгрузка_синхронизация','стоп_лист','не_конкретизировано'],
  integration: ['подключение_агрегатора','iiko','api_доступ','плагин_установка_обновление','вебхуки','статус_интеграции','не_конкретизировано'],
  billing: ['абонплата','способ_оплаты','чек_счет','возврат','расчет_доставки','скидки','не_конкретизировано'],
  tech_error: ['приложение_ошибка','сайт_не_работает','телефония','печать_принтер','киоск','сервер_api','интернет_связь','не_конкретизировано'],
  account: ['вход_логин_пароль','доступ_права','филиалы','восстановление','не_конкретизировано'],
  promo: ['промокод','скидка','акция_настройка','не_конкретизировано'],
  courier: ['назначение','статус','оплата_курьеру','не_конкретизировано'],
  onboarding: ['запуск','настройка','обучение','не_конкретизировано'],
  reports: ['не_конкретизировано','отчет_запрос','ошибка_в_отчете'],
  fiscal: ['фискальный_чек','фискализация','не_конкретизировано'],
  delivery: ['зона','стоимость','не_конкретизировано'],
  other: ['график_работы','уведомления','прочее'],
}
const taxText = Object.entries(TAX).map(([d, s]) => `${d}: ${s.join(', ')}`).join('\n')
const MINE_SYS = `Ты аналитик поддержки Delever. Дано окно переписки (клиент↔поддержка). Извлеки ОТДЕЛЬНЫЕ содержательные проблемы/запросы КЛИЕНТА. Смотри на ОТВЕТЫ ПОДДЕРЖКИ — определяй реальную суть, а не только слова клиента. Выбирай domain и subtype СТРОГО из справочника. "не_конкретизировано"/"прочее" — только если конкретики нет.\nСправочник:\n${taxText}\nJSON: {"issues":[{"domain":"...","subtype":"...","automatable":true|false}]}. Нет проблем — {"issues":[]}.`
const CHAT_SYS = `Ты аналитик поддержки. Определи РЕАЛЬНЫЙ статус чата. JSON: {"real_status":"resolved|awaiting_team|awaiting_client|stalled|abandoned|informational","needs_human_action":true|false}. "спасибо/ок" без вопроса=resolved. Вопрос без ответа команды=awaiting_team. Только JSON.`
const MLBL = { photo: 'ФОТО', voice: 'ГОЛОС', video: 'ВИДЕО', video_note: 'ВИДЕО', audio: 'АУДИО', document: 'ДОК' }
function msgText(m) {
  if (m.text_content && m.text_content.trim()) return m.text_content.replace(/\s+/g, ' ').slice(0, 220)
  const media = m.ai_summary || m.transcript
  if (media) return `[${MLBL[m.content_type] || 'МЕДИА'}: ${String(media).replace(/\s+/g, ' ').slice(0, 220)}]`
  return `[${m.content_type || 'media'}]`
}
async function llm(sys, user) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(45000),
      })
      if (r.ok) { return JSON.parse((await r.json()).choices[0].message.content) }
      if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1500 * (a + 1))); continue }
      return null
    } catch { await new Promise(x => setTimeout(x, 1000)) }
  }
  return null
}
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }; await Promise.all(Array.from({ length: n }, run)) }

const channels = await sql`SELECT id, name, source, awaiting_reply, last_client_message_at FROM support_channels WHERE last_message_at IS NOT NULL`
console.log(`channels: ${channels.length}`)

// ---- TAXONOMY MINE ----
const winTasks = []
const chMsgs = {}
for (const ch of channels) {
  const msgs = await sql`SELECT is_from_client, content_type, text_content, ai_summary, transcript FROM support_messages WHERE channel_id=${ch.id} ORDER BY created_at ASC`
  chMsgs[ch.id] = msgs
  for (let i = 0; i < msgs.length; i += WINDOW) {
    const tr = msgs.slice(i, i + WINDOW).map(m => `${m.is_from_client ? 'КЛИЕНТ' : 'ПОДДЕРЖКА'}: ${msgText(m)}`).join('\n')
    winTasks.push({ name: ch.name, tr })
  }
}
const agg = {}; let total = 0
await pool(winTasks, 8, async (t) => {
  const r = await llm(MINE_SYS, `Канал: ${t.name}\n\n${t.tr}`)
  for (const is of (r?.issues || [])) {
    const d = TAX[is.domain] ? is.domain : 'other'
    const sub = (TAX[d].includes(is.subtype)) ? is.subtype : TAX[d][TAX[d].length - 1]
    ;(agg[d] ??= {}); (agg[d][sub] ??= { n: 0, auto: 0 }); agg[d][sub].n++; agg[d][sub].auto += is.automatable ? 1 : 0; total++
  }
})
console.log(`mined ${total} issues`)

// ---- PER-CHAT STATUS ----
const statusCount = {}; let needsReliable = 0, waGap = 0
await pool(channels, 8, async (ch) => {
  const msgs = (chMsgs[ch.id] || []).slice(-30)
  if (!msgs.length) return
  const tr = msgs.map(m => `${m.is_from_client ? 'КЛИЕНТ' : 'ПОДДЕРЖКА'}: ${msgText(m)}`).join('\n')
  const r = await llm(CHAT_SYS, `Канал: ${ch.name}\n${tr}`)
  const stt = r?.real_status || 'unknown'
  statusCount[stt] = (statusCount[stt] || 0) + 1
  const hrs = ch.last_client_message_at ? (Date.now() - new Date(ch.last_client_message_at).getTime()) / 3.6e6 : 0
  const fresh = ch.source === 'telegram' || hrs <= 60
  if (r?.needs_human_action && fresh) needsReliable++
  if (ch.source === 'whatsapp' && hrs > 60) waGap++
})

// ---- SEED ----
await sql`CREATE TABLE IF NOT EXISTS support_issue_taxonomy (id SERIAL PRIMARY KEY, org_id VARCHAR(50) DEFAULT 'org_delever', domain VARCHAR(50) NOT NULL, subtype VARCHAR(80) NOT NULL, issues INT NOT NULL, automatable_pct INT NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW())`
await sql`CREATE TABLE IF NOT EXISTS support_analytics_snapshot (org_id VARCHAR(50) PRIMARY KEY, data JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW())`
await sql`DELETE FROM support_issue_taxonomy WHERE org_id = ${ORG}`
let rown = 0
for (const [domain, subs] of Object.entries(agg)) for (const [subtype, v] of Object.entries(subs)) {
  await sql`INSERT INTO support_issue_taxonomy (org_id, domain, subtype, issues, automatable_pct, computed_at) VALUES (${ORG}, ${domain}, ${subtype}, ${v.n}, ${Math.round(100 * v.auto / v.n)}, ${now})`; rown++
}
const snapshot = { totalIssues: total, channels: channels.length, statuses: Object.entries(statusCount).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count), needsReliable, waGap }
await sql`INSERT INTO support_analytics_snapshot (org_id, data, computed_at) VALUES (${ORG}, ${JSON.stringify(snapshot)}::jsonb, ${now}) ON CONFLICT (org_id) DO UPDATE SET data = EXCLUDED.data, computed_at = EXCLUDED.computed_at`
console.log(`seeded ${rown} rows + snapshot (needs ${needsReliable}, waGap ${waGap})`)
