import { salesId } from './sales-schema.js'

/**
 * Учёт работы: фантомные задачи из контекста + подтверждение одним тапом.
 *
 * Выработку нельзя честно считать по активности в переписке: тот, кто час
 * решал вопрос по телефону, выглядит бездельником, а тот, кто написал десять
 * коротких реплик, — героем. Единица учёта здесь другая: задача, рождённая
 * системой из контекста (сотрудник её не заводит) и подтверждённая самим
 * сотрудником вечером, одним нажатием в боте.
 *
 * Принципиально: механика живёт сразу в бою, не в shadow. Прошлое поведение
 * команды используется как стартовые данные: задачи рождаются задним числом
 * из истории кейсов, владелец определяется по тому, кто фактически живёт в
 * канале, — так в день включения уже есть цифры, а не пустой экран.
 *
 * Жизненный цикл:
 *   phantom → in_progress → awaiting_confirm → confirmed
 *                                            ↘ closed_unconfirmed (не ответили 48ч)
 *   confirmed → in_progress (клиент вернулся ≤48ч — «переоткрыта», счётчик растёт)
 *   любое → not_a_task (сотрудник сказал «это не задача»)
 */

const VERSION_KEY = 'work_items_schema'
const SCHEMA_VERSION = '2026-08-22.1'
let ensured = false

export async function ensureWorkSchema(sql: any): Promise<void> {
  if (ensured) return
  const [row] = await sql`
    SELECT value FROM support_platform_settings WHERE key = ${VERSION_KEY}
  ` as any[]
  if (row?.value === SCHEMA_VERSION) { ensured = true; return }

  await sql`
    CREATE TABLE IF NOT EXISTS work_items (
      id VARCHAR(64) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL,
      case_id VARCHAR(64),
      channel_id VARCHAR(50),
      parent_id VARCHAR(64),
      source VARCHAR(20) NOT NULL DEFAULT 'case',
      title TEXT,
      topic VARCHAR(40),
      client_name VARCHAR(200),
      status VARCHAR(24) NOT NULL DEFAULT 'phantom',
      owner_agent_id VARCHAR(50),
      owner_name VARCHAR(120),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_touch_at TIMESTAMPTZ,
      last_activity_at TIMESTAMPTZ,
      await_since TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      confirmed_by VARCHAR(50),
      closed_at TIMESTAMPTZ,
      active_minutes INT,
      offchat_minutes INT,
      more_work BOOLEAN,
      reopened_count INT NOT NULL DEFAULT 0,
      ask_stage VARCHAR(12),
      tg_chat_id BIGINT,
      tg_message_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_work_items_case
            ON work_items(org_id, case_id) WHERE case_id IS NOT NULL`
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(org_id, status, updated_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_work_items_owner ON work_items(org_id, owner_agent_id, confirmed_at)`

  await sql`
    INSERT INTO support_platform_settings (key, value, updated_at)
    VALUES (${VERSION_KEY}, ${SCHEMA_VERSION}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
  ensured = true
}

/**
 * Один проход учёта: рождение → владелец → тайминги → сигнал завершения →
 * переоткрытие → закрытие без ответа. Все шаги батчами: цена похода в базу
 * выше цены самого запроса, а проход живёт в edge-функции с бюджетом 25 с.
 */
export async function workTick(sql: any, orgId: string, windowHours = 48) {
  const out = { born: 0, owned: 0, awaiting: 0, reopened: 0, expired: 0 }

  // ── 1. Рождение из кейсов. Id детерминированный: повторный проход по тем же
  // кейсам не плодит дублей даже без уникального индекса
  const born = await sql`
    INSERT INTO work_items (id, org_id, case_id, channel_id, source, title, topic, client_name, status, started_at)
    SELECT 'wk_' || substr(md5(c.id || ':v1'), 1, 20), c.org_id, c.id, c.channel_id, 'case',
           LEFT(regexp_replace(COALESCE(c.title, ''), '\s+', ' ', 'g'), 300),
           c.topic, ch.name, 'phantom', c.created_at
    FROM support_cases c
    LEFT JOIN support_channels ch ON ch.id = c.channel_id
    WHERE c.org_id = ${orgId}
      AND c.created_at > NOW() - make_interval(hours => ${windowHours})
      AND COALESCE(c.is_shadow, false) = false
    ON CONFLICT (org_id, case_id) WHERE case_id IS NOT NULL DO NOTHING
    RETURNING id
  ` as any[]
  out.born = born.length

  // ── 2а. Владелец из кейса, если он назначен явно
  await sql`
    UPDATE work_items wi
    SET status = 'in_progress', owner_agent_id = c.assigned_to, owner_name = a.name, updated_at = NOW()
    FROM support_cases c
    LEFT JOIN support_agents a ON a.id = c.assigned_to
    WHERE wi.org_id = ${orgId} AND wi.case_id = c.id AND wi.status = 'phantom'
      AND c.assigned_to IS NOT NULL
  `
  // ── 2б. Иначе — поведенческая атрибуция: владелец канала тот, кто чаще всех
  // отвечал в нём за месяц. Это и есть использование накопленного опыта:
  // система знает, кто где живёт, ещё до первого вопроса
  const owned = await sql`
    UPDATE work_items wi
    SET status = 'in_progress', owner_agent_id = b.agent_id, owner_name = b.sender_name, updated_at = NOW()
    FROM (
      SELECT t.channel_id, t.sender_name, a.id AS agent_id
      FROM (
        SELECT m.channel_id, m.sender_name,
               ROW_NUMBER() OVER (PARTITION BY m.channel_id ORDER BY COUNT(*) DESC) AS rn
        FROM support_messages m
        WHERE m.is_from_client = false AND m.sender_name IS NOT NULL AND m.sender_name <> ''
          AND m.created_at > NOW() - INTERVAL '30 days'
        GROUP BY m.channel_id, m.sender_name
      ) t
      LEFT JOIN support_agents a ON a.org_id = ${orgId} AND a.name = t.sender_name AND a.is_active = true
      WHERE t.rn = 1
    ) b
    WHERE wi.org_id = ${orgId} AND wi.status = 'phantom' AND wi.channel_id = b.channel_id
      AND EXISTS (
        SELECT 1 FROM support_messages m
        WHERE m.channel_id = wi.channel_id AND m.is_from_client = false
          AND m.created_at >= wi.started_at
      )
    RETURNING wi.id
  ` as any[]
  out.owned = owned.length

  // ── 3. Тайминги: первое касание, последняя активность, активные минуты.
  // Активное время — окна по 10 минут, где команда писала в канал: грубая, но
  // честная мера «сколько внимания съела задача», не завышаемая простоем
  await sql`
    UPDATE work_items wi
    SET first_touch_at = s.first_team, last_activity_at = s.last_any,
        active_minutes = s.buckets * 10, updated_at = NOW()
    FROM (
      -- Окно считается от старта задачи до решения кейса (плюс час на
      -- «спасибо-пожалуйста»), а не до «сейчас»: иначе задача из июня в живом
      -- групповом чате копила бы чужие сообщения два месяца
      SELECT wi2.id,
             MIN(m.created_at) FILTER (WHERE m.is_from_client = false) AS first_team,
             MAX(m.created_at) AS last_any,
             COUNT(DISTINCT date_trunc('hour', m.created_at)
               + make_interval(mins => (EXTRACT(minute FROM m.created_at)::int / 10) * 10))
               FILTER (WHERE m.is_from_client = false) AS buckets
      FROM work_items wi2
      LEFT JOIN support_cases c ON c.id = wi2.case_id
      JOIN support_messages m ON m.channel_id = wi2.channel_id
        AND m.created_at >= wi2.started_at
        AND m.created_at <= LEAST(NOW(), COALESCE(c.resolved_at + INTERVAL '1 hour', NOW()))
      WHERE wi2.org_id = ${orgId} AND wi2.status IN ('in_progress', 'awaiting_confirm')
      GROUP BY wi2.id
    ) s
    WHERE wi.id = s.id
  `

  // ── 4. Сигнал завершения: кейс решён, либо команда ответила последней и в
  // канале 4 часа тишины. Дальше слово за сотрудником
  const awaiting = await sql`
    UPDATE work_items wi
    SET status = 'awaiting_confirm', await_since = NOW(), updated_at = NOW()
    FROM support_cases c
    LEFT JOIN support_channels ch ON ch.id = c.channel_id
    WHERE wi.org_id = ${orgId} AND wi.case_id = c.id AND wi.status = 'in_progress'
      AND (
        c.resolved_at IS NOT NULL
        OR (ch.awaiting_reply = false AND ch.last_message_at < NOW() - INTERVAL '4 hours')
      )
    RETURNING wi.id
  ` as any[]
  out.awaiting = awaiting.length

  // ── 5. Переоткрытие: «завершена», после которой клиент вернулся в течение
  // 48 часов. Счётчик публичный — это встроенный противовес досрочным закрытиям
  const reopened = await sql`
    UPDATE work_items wi
    SET status = 'in_progress', reopened_count = reopened_count + 1,
        confirmed_at = NULL, ask_stage = NULL, tg_chat_id = NULL, tg_message_id = NULL,
        await_since = NULL, updated_at = NOW()
    WHERE wi.org_id = ${orgId} AND wi.status = 'confirmed'
      AND wi.confirmed_at > NOW() - INTERVAL '48 hours'
      AND EXISTS (
        SELECT 1 FROM support_messages m
        WHERE m.channel_id = wi.channel_id AND m.is_from_client = true
          AND m.created_at > wi.confirmed_at
      )
    RETURNING wi.id
  ` as any[]
  out.reopened = reopened.length

  // ── 6. Не ответили за 48 часов — закрываем без подтверждения. Такие задачи
  // видны в потоке, но в выработку не идут: неподтверждённое не считается
  const expired = await sql`
    UPDATE work_items
    SET status = 'closed_unconfirmed', closed_at = NOW(), updated_at = NOW()
    WHERE org_id = ${orgId} AND status = 'awaiting_confirm'
      AND await_since < NOW() - INTERVAL '48 hours'
    RETURNING id
  ` as any[]
  out.expired = expired.length

  return out
}

// ─── Телеграм ────────────────────────────────────────────────────────────────

async function botToken(sql: any): Promise<string | null> {
  try {
    const [row] = await sql`
      SELECT value FROM support_platform_settings WHERE key = 'platform_bot_token'
    ` as any[]
    return row?.value || process.env.PLATFORM_BOT_TOKEN || null
  } catch {
    return process.env.PLATFORM_BOT_TOKEN || null
  }
}

type Keyboard = Array<Array<{ text: string; callback_data: string }>>

async function tg(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.ok ? res.json() : null
}

const fmtTime = (v: string | Date | null) => v
  ? new Date(v).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
  : '—'

function itemText(it: any): string {
  const lines = [
    `<b>${it.client_name || 'Клиент'}</b>`,
    it.title ? `${String(it.title).slice(0, 160)}` : '',
    `<i>начата ${fmtTime(it.started_at)} · активность до ${fmtTime(it.last_activity_at)}`
      + (it.active_minutes ? ` · ~${it.active_minutes} мин в чате` : '') + '</i>',
  ]
  return lines.filter(Boolean).join('\n')
}

const KB_DONE: (id: string) => Keyboard = id => [
  [{ text: '✓ Завершена', callback_data: `wi:done:${id}` },
   { text: 'Ещё в работе', callback_data: `wi:wip:${id}` }],
  [{ text: 'Не моя', callback_data: `wi:notmine:${id}` },
   { text: 'Это не задача', callback_data: `wi:nottask:${id}` }],
]

/**
 * Вечерний дайджест: до 5 вопросов на человека, только тем, у кого привязан
 * Telegram. Больше пяти — остальное дожидается завтра или закрывается по
 * тишине: лимит важнее полноты, иначе бот превратится в спам и умрёт.
 */
export async function workDigest(sql: any, orgId: string, dry = false) {
  const out = { owners: 0, sent: 0, noTelegram: 0, plan: [] as Array<{ owner: string; items: number }> }
  const token = await botToken(sql)
  if (!token && !dry) return { ...out, error: 'нет токена бота' }

  const rows = await sql`
    SELECT wi.*, a.telegram_id
    FROM work_items wi
    LEFT JOIN support_agents a ON a.id = wi.owner_agent_id
    WHERE wi.org_id = ${orgId} AND wi.status = 'awaiting_confirm' AND wi.tg_message_id IS NULL
    ORDER BY wi.owner_agent_id, wi.await_since
  ` as any[]

  const byOwner = new Map<string, any[]>()
  for (const r of rows) {
    if (!r.owner_agent_id) continue
    const list = byOwner.get(r.owner_agent_id) || []
    if (list.length < 5) list.push(r)
    byOwner.set(r.owner_agent_id, list)
  }

  for (const [, items] of byOwner) {
    const tgId = items[0].telegram_id
    out.owners++
    if (!tgId) { out.noTelegram++; continue }
    out.plan.push({ owner: items[0].owner_name || items[0].owner_agent_id, items: items.length })
    if (dry) continue

    await tg(token!, 'sendMessage', {
      chat_id: tgId, parse_mode: 'HTML',
      text: `Вечерняя сверка: похоже, ${items.length === 1 ? 'закрыта задача' : `закрыто задач: ${items.length}`}. `
        + 'Подтвердите одним нажатием — это единственное, что механика просит руками.',
    })
    for (const [i, it] of items.entries()) {
      const res: any = await tg(token!, 'sendMessage', {
        chat_id: tgId, parse_mode: 'HTML',
        text: `<b>${i + 1}/${items.length}</b> · ${itemText(it)}`,
        reply_markup: { inline_keyboard: KB_DONE(it.id) },
      })
      const msgId = res?.result?.message_id
      if (msgId) {
        await sql`
          UPDATE work_items SET tg_chat_id = ${tgId}, tg_message_id = ${msgId},
                 ask_stage = 'done', updated_at = NOW()
          WHERE id = ${it.id}
        `
        out.sent++
      }
    }
  }
  return out
}

// ─── Кнопки: цепочка из трёх вопросов ───────────────────────────────────────

const KB_MORE: (id: string) => Keyboard = id => [
  [{ text: 'Нет', callback_data: `wi:more0:${id}` },
   { text: 'Да, есть ещё', callback_data: `wi:more1:${id}` }],
]
const KB_OFF: (id: string) => Keyboard = id => [
  [{ text: 'Нет', callback_data: `wi:off0:${id}` },
   { text: '~30 мин', callback_data: `wi:off30:${id}` }],
  [{ text: '~1 час', callback_data: `wi:off60:${id}` },
   { text: '2 часа и больше', callback_data: `wi:off120:${id}` }],
]

/** Обработка нажатий wi:*. Возвращает true, если колбэк наш. */
export async function handleWorkCallback(sql: any, update: any): Promise<boolean> {
  const cb = update.callback_query
  if (!cb?.data || !String(cb.data).startsWith('wi:')) return false

  const [, action, id] = String(cb.data).split(':')
  const token = await botToken(sql)
  const answer = (text: string) => token
    ? tg(token, 'answerCallbackQuery', { callback_query_id: cb.id, text })
    : Promise.resolve(null)
  const edit = (text: string, keyboard?: Keyboard) => token
    ? tg(token, 'editMessageText', {
        chat_id: cb.message?.chat?.id, message_id: cb.message?.message_id,
        text, parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      })
    : Promise.resolve(null)

  const [item] = await sql`SELECT * FROM work_items WHERE id = ${id} LIMIT 1` as any[]
  if (!item) { await answer('Задача не найдена — возможно, уже переоткрыта'); return true }

  const [agent] = await sql`
    SELECT id, name FROM support_agents WHERE telegram_id = ${String(cb.from?.id || '')} LIMIT 1
  ` as any[]

  switch (action) {
    case 'done':
      await sql`UPDATE work_items SET ask_stage = 'more', updated_at = NOW() WHERE id = ${id}`
      await answer('Принято')
      await edit(`${itemText(item)}\n\nЕсть ли у этого клиента ещё работа, которая потребует времени?`, KB_MORE(id))
      return true

    case 'wip':
      await sql`
        UPDATE work_items SET status = 'in_progress', await_since = NULL,
               ask_stage = NULL, tg_chat_id = NULL, tg_message_id = NULL, updated_at = NOW()
        WHERE id = ${id}
      `
      await answer('Оставил в работе')
      await edit(`↩︎ Ещё в работе: ${itemText(item)}`)
      return true

    case 'notmine':
      // Владельца не угадали — снимаем и даём атрибуции пересчитаться по
      // следующему реальному ответу в канале, а не спорим с человеком
      await sql`
        UPDATE work_items SET status = 'in_progress', owner_agent_id = NULL, owner_name = NULL,
               await_since = NULL, ask_stage = NULL, tg_chat_id = NULL, tg_message_id = NULL, updated_at = NOW()
        WHERE id = ${id}
      `
      await answer('Снял с вас')
      await edit(`Снято: владелец уточнится по следующему ответу в чате.\n${itemText(item)}`)
      return true

    case 'nottask':
      await sql`
        UPDATE work_items SET status = 'not_a_task', closed_at = NOW(), ask_stage = NULL, updated_at = NOW()
        WHERE id = ${id}
      `
      await answer('Понял, в учёт не идёт')
      await edit(`✕ Не задача: ${String(item.title || '').slice(0, 120)}`)
      return true

    case 'more0':
    case 'more1': {
      const more = action === 'more1'
      await sql`UPDATE work_items SET more_work = ${more}, ask_stage = 'offchat', updated_at = NOW() WHERE id = ${id}`
      if (more) {
        // Скрытый спрос — самое ценное в механике: работа, которой нет ни в
        // одном тикете. Рождаем задачу-продолжение тут же
        await sql`
          INSERT INTO work_items (id, org_id, channel_id, parent_id, source, title, client_name, status, started_at)
          VALUES (${salesId('wk')}, ${item.org_id}, ${item.channel_id}, ${item.id}, 'followup',
                  ${`Продолжение работ — со слов ${agent?.name || 'сотрудника'}`},
                  ${item.client_name}, 'in_progress', NOW())
        `
      }
      await answer(more ? 'Записал продолжение' : 'Ок')
      await edit(`${itemText(item)}\n\nБыла ли по задаче работа вне чата — звонок, выезд, настройка в админке?`, KB_OFF(id))
      return true
    }

    case 'off0':
    case 'off30':
    case 'off60':
    case 'off120': {
      const mins = Number(action.replace('off', '')) || 0
      await sql`
        UPDATE work_items SET status = 'confirmed', confirmed_at = NOW(),
               confirmed_by = ${agent?.id || null}, offchat_minutes = ${mins},
               ask_stage = NULL, closed_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `
      await answer('Учтено ✓')
      const total = (item.active_minutes || 0) + mins
      await edit(`✅ Учтено: <b>${item.client_name || ''}</b> — ${String(item.title || '').slice(0, 120)}\n`
        + `<i>~${item.active_minutes || 0} мин в чате${mins ? ` + ${mins} мин вне` : ''} · итого ~${total} мин</i>`)
      return true
    }
  }
  await answer('Неизвестное действие')
  return true
}
