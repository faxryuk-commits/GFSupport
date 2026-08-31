import { getSQL, json, ensureOnce } from '../_lib/db.js'
import { ensureSalesSchema } from '../_lib/sales-schema.js'
import { getBotToken, tgSend, leadCard, leadKeyboard, notifyCallDone } from '../_lib/sales-bot.js'
import { draftNurtureMessage, logAssistant, NURTURE_STEPS, MAX_STEPS } from '../_lib/sales-assistant.js'
import { assertCron } from '../_lib/cron-auth.js'
import { sendNotification } from '../_lib/notifications.js'
import { tokenForPage } from '../_lib/meta-config.js'
import { runQualifier } from '../_lib/sales-qualifier.js'
import { readPbxConfig, pbxHistory, pbxUsers } from '../_lib/pbx.js'
import { acceptLead } from '../_lib/sales-intake.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Cron: фоновая часть движка продаж. Раз в минуту, один идемпотентный проход.
 *
 * 1. Просроченный SLA первого касания → лид уходит другому свободному сейлзу.
 * 2. Просроченные задачи и каденции → напоминание владельцу (одно на задачу).
 * 3. Сделка дольше норматива этапа → пометка «застряла».
 * 4. Сделка без следующего шага дольше 48 часов → пометка «брошена».
 * 5. Наступил срок реактивации → сделка возвращается в очередь владельцу.
 *
 * Отдельной таблицы таймеров нет: состояние выводится из данных, поэтому
 * повторный проход ничего не дублирует. Признак «уже напомнили» — колонки
 * reminded_at у задачи и stalled_at у сделки.
 *
 * Защита: Vercel cron (user-agent) или CRON_SECRET.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const ABANDON_HOURS = 48

export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  const sql = getSQL()
  await ensureSalesSchema(sql, ORG)

  // Колонки появляются здесь, а не в схеме модуля: они нужны только крону.
  // reminded_at — чтобы не слать одно напоминание каждую минуту;
  // sla_handoff_at и sla_handoffs — служебный график карусели, чтобы не
  // трогать sla_due_at: это видимый людям срок, и двигать его — врать
  await ensureOnce('sales-tick-cols', async () => {
    await sql`ALTER TABLE sales_tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`
    await sql`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS sla_handoff_at TIMESTAMPTZ`
    await sql`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS sla_handoffs INT DEFAULT 0`
    await sql`ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS pbx_ext VARCHAR(20)`
  })

  const token = await getBotToken(sql)
  const out: Record<string, number> = { reassigned: 0, reminded: 0, stalled: 0, abandoned: 0, reactivated: 0 }

  // ─── 1. Просроченный SLA первого касания ────────────────────────────────────
  // Два предохранителя, без которых карусель превращалась во враньё:
  // передач не больше двух (дальше дело не в занятости, а гонять лид по кругу
  // с уведомлениями — спам), и ночью карусель спит — передать лид спящему
  // и через 15 минут забрать обратно было бы работой ради работы
  const tashkentHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent', hour: 'numeric', hour12: false,
  }).format(new Date()))
  const workHours = tashkentHour >= 9 && tashkentHour < 21

  const overdue = workHours ? await sql`
    SELECT l.*, s.label AS source_label
    FROM sales_leads l
    LEFT JOIN sales_sources s ON s.id = l.source_id
    WHERE l.org_id = ${ORG} AND l.status = 'assigned'
      AND l.first_touch_at IS NULL AND l.archived_at IS NULL
      AND l.sla_due_at < NOW()
      AND COALESCE(l.sla_handoff_at, l.sla_due_at) < NOW()
      AND COALESCE(l.sla_handoffs, 0) < 2
    ORDER BY l.sla_due_at ASC LIMIT 20
  ` : []
  for (const lead of overdue) {
    // Свободнее всех = меньше всего висящих лидов; текущего владельца исключаем
    const [next] = await sql`
      SELECT a.id, a.telegram_id
      FROM support_agents a
      LEFT JOIN sales_leads l
        ON l.assigned_agent_id = a.id AND l.first_touch_at IS NULL AND l.status = 'assigned'
      WHERE a.telegram_id IS NOT NULL AND a.merged_into IS NULL
        AND a.id <> ${lead.assigned_agent_id}
        AND (a.org_id = ${ORG} OR a.org_id IS NULL)
        AND (LOWER(COALESCE(a.role, '')) IN ('sales', 'sales_rep', 'ae', 'sdr', 'sales_lead', 'kam', 'cco')
             -- отдел у команды записан латиницей: фильтр только по «прода»
             -- не находил никого, и карусель ни разу не сработала
             OR LOWER(COALESCE(a.department, '')) IN ('sales', 'sale')
             OR LOWER(COALESCE(a.department, '')) LIKE '%прода%')
      GROUP BY a.id
      ORDER BY COUNT(l.id) ASC, a.id ASC
      LIMIT 1
    `
    if (!next) {
      // Некому передать — вернёмся через час. Видимый срок не трогаем:
      // раньше он продлевался на 15 минут каждый проход, и лиды
      // двухнедельной давности вечно показывали «через 5 мин»
      await sql`UPDATE sales_leads SET sla_handoff_at = NOW() + INTERVAL '1 hour' WHERE id = ${lead.id}`
      continue
    }
    // Новому владельцу — новые 15 минут: здесь сдвиг срока не враньё,
    // а настоящая переустановка норматива
    await sql`
      UPDATE sales_leads
      SET assigned_agent_id = ${next.id}, assigned_at = NOW(),
          sla_due_at = NOW() + INTERVAL '15 minutes',
          sla_handoff_at = NULL, sla_handoffs = COALESCE(sla_handoffs, 0) + 1
      WHERE id = ${lead.id}
    `
    out.reassigned++
    if (token && next.telegram_id) {
      await tgSend(token, next.telegram_id,
        `♻️ <b>Лид передан вам</b> — предыдущий сейлз не связался за 15 минут.\n\n` +
        leadCard(lead, lead.source_label || 'источник не указан'),
        leadKeyboard(lead.id))
    }
  }

  // ─── 1б. Неотвеченные сообщения клиентов: повторный заход квалификатора ────
  //
  // Квалификатор срабатывает на входящем, но молчит, пока в диалоге недавно
  // писал живой сотрудник. Без досмотра это дыра: если сотрудник так и не
  // ответил, сообщение клиента висело без ответа вечно — вернуться было
  // некому. Досмотр находит диалоги, где последнее слово за клиентом, тишина
  // человека истекла, а квалификатор ещё не отработал, — и зовёт его снова.
  // Свои проверки (лимиты, режим, живой человек) он делает сам.
  try {
    const unanswered = await sql`
      SELECT l.id AS lead_id, c.id AS channel_id, m.text_content
      FROM sales_leads l
      JOIN sales_accounts a ON a.id = l.account_id
      JOIN support_channels c ON c.id = a.channel_id
      JOIN LATERAL (
        SELECT text_content, created_at, is_from_client FROM support_messages
        WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE l.org_id = ${ORG} AND l.archived_at IS NULL
        AND l.status IN ('new', 'assigned', 'nurture')
        AND m.is_from_client = true
        -- вебхук-ветке даём отработать самой; старше суток не трогаем —
        -- окно ответа Meta всё равно закрыто, а воскрешать древность незачем.
        -- Минута, не больше: каждый новый пинг клиента сдвигает этот таймер,
        -- и с тремя минутами частые «ау, что молчишь» замораживали диалог
        AND m.created_at < NOW() - INTERVAL '60 seconds'
        AND m.created_at > NOW() - INTERVAL '20 hours'
        -- тишина человека истекла: за два часа исходящих от людей не было
        AND NOT EXISTS (
          SELECT 1 FROM support_messages h
          WHERE h.channel_id = c.id AND h.is_from_client = false
            AND COALESCE(h.sender_name, '') <> 'Агент'
            AND h.created_at > NOW() - INTERVAL '2 hours'
        )
        -- квалификатор после этого сообщения ещё не высказывался
        AND NOT EXISTS (
          SELECT 1 FROM sales_assistant_log sl
          WHERE sl.org_id = ${ORG} AND sl.lead_id = l.id
            AND sl.action IN ('qualify_sent', 'qualify_draft', 'qualify_handover', 'qualify_failed', 'qualify_silent')
            AND sl.created_at > m.created_at
        )
      LIMIT 5
    ` as any[]
    for (const u of unanswered) {
      await runQualifier(sql, ORG, {
        leadId: u.lead_id, channelId: u.channel_id,
        inboundText: String(u.text_content || '').slice(0, 500),
      })
    }
  } catch { /* досмотр не должен ронять остальной проход */ }

  // ─── 1в. Звонки из OnlinePBX ────────────────────────────────────────────────
  //
  // История АТС ложится касаниями на лида: видно, кто и когда звонил, дозвон
  // проставляет первое касание — норматив «15 минут» наконец меряется и
  // звонками. Раз в пять минут по курсору; дедупликация по uuid звонка в
  // поле identity касания.
  try {
    const cfg = await readPbxConfig(sql, ORG)
    if (cfg) {
      const CUR = 'pbx_sync_cursor'
      const [cur] = await sql`
        SELECT value FROM support_platform_settings WHERE key = ${CUR} LIMIT 1
      ` as any[]
      const lastSync = Number(cur?.value || 0)
      const nowSec = Math.floor(Date.now() / 1000)
      if (nowSec - lastSync >= 300) {
        // Первый запуск: сутки назад, не глубже — древность уже прожита в Amo
        const from = lastSync > 0 ? lastSync - 60 : nowSec - 24 * 3600
        const calls = await pbxHistory(cfg, from, nowSec)
        let saved = 0
        // Карта «добавочный → мобильный переадресации» грузится лениво: ответ
        // записан на «внутр. 101», но трубку снял мобильный из переадресации —
        // только через неё добавочный превращается в имя сотрудника
        let extForward: Map<string, string> | null = null
        for (const c of calls) {
          const norm = c.clientNumber.replace(/\D/g, '').slice(-9)
          if (!norm || norm.length < 7) continue
          // Кому звонили: лид по нормализованному телефону, свежий важнее
          let [lead] = await sql`
            SELECT id, name, account_id, first_touch_at, status FROM sales_leads
            WHERE org_id = ${ORG} AND archived_at IS NULL
              AND phone_norm LIKE ${'%' + norm}
            ORDER BY created_at DESC LIMIT 1
          ` as any[]
          // Входящий с неизвестного номера — это обращение, а не шум:
          // человек сам позвонил. Заводим лида с источником «Входящий
          // звонок» — он падает в общую очередь, и сейлз перезвонит
          if (!lead && c.direction === 'in') {
            const res = await acceptLead(sql, ORG, {
              source: 'call',
              external_id: `pbx_${norm}`,
              name: `Звонок ${c.clientNumber}`,
              phone: c.clientNumber,
              lead_kind: 'call',
              raw: { pbx_uuid: c.uuid, ext: c.ext },
            }).catch(() => null as any)
            if (res?.ok && res.lead_id) {
              const [fresh] = await sql`
                SELECT id, name, account_id, first_touch_at, status FROM sales_leads
                WHERE id = ${res.lead_id} LIMIT 1
              ` as any[]
              lead = fresh
            }
          }
          const [dup] = await sql`
            SELECT id FROM sales_touchpoints
            WHERE org_id = ${ORG} AND kind = 'call' AND identity = ${c.uuid} LIMIT 1
          ` as any[]
          if (dup) continue
          const title = c.direction === 'in'
            ? (c.talkSec > 0 ? `Входящий звонок · ${c.talkSec} сек` : 'Входящий звонок · не ответили')
            : (c.talkSec > 0 ? `Исходящий звонок · ${c.talkSec} сек` : 'Исходящий звонок · недозвон')
          // Кто на нашей стороне: короткий добавочный — по pbx_ext;
          // внешний номер (переадресация входящего ночью, мобильная первая
          // нога исходящего) — по телефону из профиля. Сотрудник нужен дважды:
          // подпись в касании и пинг в бот после разговора
          let me: any = null
          if (c.ext) {
            ;[me] = await sql`
              SELECT id, name, telegram_id FROM support_agents
              WHERE regexp_replace(COALESCE(pbx_ext, ''), ${'\\D'}, '', 'g') = ${c.ext}
                AND merged_into IS NULL
              LIMIT 1
            `.catch(() => [] as any[]) as any[]
          } else if (c.agentExternal) {
            const own = c.agentExternal.replace(/\D/g, '').slice(-9)
            ;[me] = await sql`
              SELECT id, name, telegram_id FROM support_agents
              WHERE (regexp_replace(COALESCE(phone, ''), ${'\\D'}, '', 'g') LIKE ${'%' + own}
                     OR regexp_replace(COALESCE(pbx_ext, ''), ${'\\D'}, '', 'g') LIKE ${'%' + own})
                AND merged_into IS NULL
              LIMIT 1
            `.catch(() => [] as any[]) as any[]
          }
          // Добавочный никому не принадлежит напрямую — но у него есть
          // переадресация на мобильный, а мобильный есть в профиле
          if (c.ext && !me) {
            if (!extForward) {
              extForward = new Map()
              const us = await pbxUsers(cfg).catch(() => [] as any[])
              for (const u of us) {
                const d = String(u.forward || '').replace(/\D/g, '').slice(-9)
                if (d.length >= 7) extForward.set(u.num, d)
              }
            }
            const fwd = extForward.get(c.ext)
            if (fwd) {
              ;[me] = await sql`
                SELECT id, name, telegram_id FROM support_agents
                WHERE regexp_replace(COALESCE(phone, ''), ${'\\D'}, '', 'g') LIKE ${'%' + fwd}
                  AND merged_into IS NULL
                LIMIT 1
              `.catch(() => [] as any[]) as any[]
            }
          }
          const side = c.ext
            ? ` · внутр. ${c.ext}${me?.name ? ` · ${me.name}` : ''}`
            : (me?.name ? ` · моб. ${me.name}` : '')
          await sql`
            INSERT INTO sales_touchpoints (id, org_id, account_id, lead_id, kind, channel,
                                           title, detail, identity, happened_at)
            VALUES (${`stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`}, ${ORG},
                    ${lead?.account_id || null}, ${lead?.id || null}, 'call', 'phone',
                    ${title}, ${c.clientNumber + side},
                    ${c.uuid}, ${new Date(c.startStamp * 1000).toISOString()})
          `
          saved++
          // Состоявшийся разговор — настоящее первое касание
          if (lead && !lead.first_touch_at && c.talkSec > 0) {
            await sql`
              UPDATE sales_leads SET first_touch_at = NOW(), updated_at = NOW()
              WHERE id = ${lead.id} AND org_id = ${ORG} AND first_touch_at IS NULL
            `
          }
          // Пинг по горячим следам: разговор состоялся — тому, кто говорил,
          // прилетает в бот ссылка на карточку или кнопка «создать лида».
          // Только состоявшиеся: пинговать каждый недозвон — приучить к спаму
          if (c.talkSec > 0 && me?.telegram_id) {
            await notifyCallDone(sql, {
              telegramId: String(me.telegram_id),
              direction: c.direction,
              clientNumber: c.clientNumber,
              talkSec: c.talkSec,
              lead: lead ? { id: lead.id, name: lead.name ?? null } : null,
            }).catch(() => {})
          }
        }
        await sql`
          INSERT INTO support_platform_settings (key, value, updated_at)
          VALUES (${CUR}, ${String(nowSec)}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${String(nowSec)}, updated_at = NOW()
        `
        if (saved) out.calls = saved
      }
    }
  } catch (e) {
    // Телефония не должна ронять остальной проход; причину — в лог функции
    console.error('[sales-tick] pbx sync:', e)
  }

  // ─── 2. Просроченные задачи и каденции ──────────────────────────────────────
  // Раньше выборка требовала привязанного телеграма, и у сотрудника без бота
  // просроченная задача не всплывала нигде — а отметка «напомнили» ему не
  // ставилась, поэтому он попадал в выборку каждую минуту без толку
  const tasks = await sql`
    SELECT t.id, t.title, t.due_at, t.assignee_agent_id, d.title AS deal_title, a.telegram_id
    FROM sales_tasks t
    LEFT JOIN sales_deals d ON d.id = t.deal_id
    LEFT JOIN support_agents a ON a.id = t.assignee_agent_id
    WHERE t.org_id = ${ORG} AND t.done_at IS NULL
      AND t.due_at < NOW() AND t.reminded_at IS NULL
      AND t.assignee_agent_id IS NOT NULL
    ORDER BY t.due_at ASC LIMIT 30
  `
  for (const t of tasks) {
    await sendNotification({
      orgId: ORG, type: 'sla_breach', priority: 'medium',
      title: 'Просрочена задача',
      body: `${t.deal_title ? `${t.deal_title}: ` : ''}${t.title}`,
      link: t.deal_id ? `/sales/deals/${t.deal_id}` : '/me',
      targetAgentIds: [t.assignee_agent_id],
    }).catch(() => {})
    if (token && t.telegram_id) {
      await tgSend(token, t.telegram_id,
        `⏰ <b>Просрочена задача</b>\n${t.deal_title ? `${t.deal_title}\n` : ''}${t.title}`,
        [[{ text: '✅ Выполнено', callback_data: `sl:done:${t.id}` }]])
    }
    await sql`UPDATE sales_tasks SET reminded_at = NOW() WHERE id = ${t.id}`
    out.reminded++
  }

  // ─── 3. Сделка дольше норматива этапа ───────────────────────────────────────
  const stalled = await sql`
    UPDATE sales_deals d SET stalled_at = NOW()
    FROM sales_stages s
    WHERE s.id = d.stage_id AND d.org_id = ${ORG}
      AND d.won_at IS NULL AND d.lost_at IS NULL AND d.stalled_at IS NULL
      AND s.sla_hours IS NOT NULL
      AND d.stage_since < NOW() - (s.sla_hours * INTERVAL '1 hour')
    RETURNING d.id
  `
  out.stalled = stalled.length

  // ─── 4. Сделка без следующего шага дольше 48 часов ──────────────────────────
  const abandoned = await sql`
    UPDATE sales_deals SET stalled_at = COALESCE(stalled_at, NOW())
    WHERE org_id = ${ORG} AND won_at IS NULL AND lost_at IS NULL
      AND next_step_at IS NULL AND stalled_at IS NULL
      AND stage_since < NOW() - (${ABANDON_HOURS}::int * INTERVAL '1 hour')
    RETURNING id
  `
  out.abandoned = abandoned.length

  // ─── 4b. Прогрев: ассистент пишет тем, до кого не дошли руки ────────────────
  // Это единственное место, где система общается с клиентом сама. Работает
  // узко: только лиды со статусом nurture, не чаще расписания, максимум четыре
  // касания, и любой ответ клиента немедленно возвращает лид человеку.
  const nurtured: string[] = []
  try {
    const due = await sql`
      SELECT l.id, l.name, l.phone, l.city, l.text, l.raw, l.nurture_step, l.assigned_agent_id,
             l.account_id, a.channel_id,
             -- Писать нужно в Telegram-чат, а не в наш внутренний id канала:
             -- это разные вещи, и с внутренним отправка молча не доходит
             ch.telegram_chat_id,
             -- Директ и Messenger: адрес собеседника и страница, от имени
             -- которой отвечаем
             ch.source AS channel_source, ch.external_chat_id, ch.meta_page_id,
             -- Окно ответа у Meta — сутки с последнего сообщения клиента.
             -- За ним прогрев отправить нельзя: это не продолжение живого
             -- разговора, а инициатива с нашей стороны
             (SELECT MAX(m.created_at) FROM support_messages m
               WHERE m.channel_id = ch.id AND m.is_from_client = true) AS last_client_at
      FROM sales_leads l
      LEFT JOIN sales_accounts a ON a.id = l.account_id
      LEFT JOIN support_channels ch ON ch.id = a.channel_id
      WHERE l.org_id = ${ORG} AND l.status = 'nurture' AND l.archived_at IS NULL
        AND COALESCE(l.nurture_step, 0) < ${MAX_STEPS}
        AND (l.nurture_next_at IS NULL OR l.nurture_next_at <= NOW())
      ORDER BY l.created_at
      LIMIT 10
    ` as any[]

    for (const lead of due) {
      const step = Number(lead.nurture_step || 0)
      const draft = await draftNurtureMessage(lead, step)
      if (!draft) {
        await logAssistant(sql, ORG, {
          leadId: lead.id, action: 'draft_failed', step,
          status: 'error', error: 'ключ OpenAI не настроен или модель не ответила',
        })
        continue
      }

      // Куда писать: канал клиента, если он привязан. Своего канала у
      // ассистента нет — выдумывать доставку сообщений он не должен
      const nextAt = new Date(Date.now() + (NURTURE_STEPS[Math.min(step + 1, MAX_STEPS - 1)].day
        - NURTURE_STEPS[Math.min(step, MAX_STEPS - 1)].day || 3) * 86400000)

      // Отправляем ботом, который сидит в этих чатах: платформенный бот
      // (@gfsupport_robot) в клиентские группы не добавлен и написать туда не может
      const chatToken = process.env.TELEGRAM_BOT_TOKEN || token
      const metaOk = ['instagram', 'messenger'].includes(String(lead.channel_source || ''))
        && Boolean(lead.external_chat_id) && Boolean(lead.last_client_at)
        && Date.now() - new Date(lead.last_client_at).getTime() < 23 * 3600 * 1000

      if (metaOk) {
        const igToken = await tokenForPage(ORG, lead.meta_page_id || null)
        let sent = false
        if (igToken) {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/me/messages?access_token=${igToken}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: lead.external_chat_id },
                message: { text: draft.text },
                messaging_type: 'RESPONSE',
              }),
            })
          sent = r.ok
        }
        await logAssistant(sql, ORG, {
          leadId: lead.id, accountId: lead.account_id,
          action: sent ? 'nurture_sent' : 'nurture_failed',
          channel: lead.channel_source, step, message: draft.text,
          status: sent ? 'sent' : 'error',
          error: sent ? undefined : 'Meta не приняла сообщение',
        })
        if (!sent) continue
      } else if (lead.telegram_chat_id && chatToken) {
        try {
          await tgSend(chatToken, lead.telegram_chat_id, draft.text)
          await logAssistant(sql, ORG, {
            leadId: lead.id, accountId: lead.account_id, action: 'nurture_sent',
            channel: 'telegram', step, message: draft.text, status: 'sent',
          })
        } catch (e: any) {
          await logAssistant(sql, ORG, {
            leadId: lead.id, action: 'nurture_failed', step, message: draft.text,
            status: 'error', error: String(e?.message || e),
          })
          continue
        }
      } else {
        // Отправить нечем — не молчим: текст готов, отправит человек. Черновик
        // в журнале честнее, чем вид работающей автоматики.
        //
        // Причину пишем точную: «канал не привязан» на диалоге из директа
        // было прямой неправдой и отправляло искать несуществующую поломку
        const isMeta = ['instagram', 'messenger'].includes(String(lead.channel_source || ''))
        const reason = isMeta && lead.last_client_at
          ? 'окно ответа Meta закрыто — прошло больше суток с сообщения клиента, '
            + 'отправьте вручную или дождитесь ответа'
          : isMeta
            ? 'клиент ещё ничего не писал в этом диалоге — Meta не пропустит сообщение первым'
            : lead.channel_id
              ? 'канал клиента не поддерживает отправку — отправьте вручную'
              : 'канал клиента не привязан — отправьте вручную'
        await logAssistant(sql, ORG, {
          leadId: lead.id, accountId: lead.account_id, action: 'nurture_draft',
          step, message: draft.text, status: 'draft', error: reason,
        })
      }

      await sql`
        UPDATE sales_leads
        SET nurture_step = ${step + 1}, nurture_next_at = ${nextAt.toISOString()}, updated_at = NOW()
        WHERE id = ${lead.id} AND org_id = ${ORG}
      `
      nurtured.push(lead.id)
    }
  } catch (e) {
    // Прогрев не должен ронять остальной тик: SLA и задачи важнее
    console.error('nurture error', e)
  }

  // ─── 5. Реактивация: срок по причине отказа наступил ────────────────────────
  const revive = await sql`
    SELECT d.id, d.title, d.owner_agent_id, a.telegram_id, r.label AS reason
    FROM sales_deals d
    LEFT JOIN support_agents a ON a.id = d.owner_agent_id
    LEFT JOIN sales_lost_reasons r ON r.id = d.lost_reason_id
    WHERE d.org_id = ${ORG} AND d.reactivate_at IS NOT NULL AND d.reactivate_at < NOW()
    ORDER BY d.reactivate_at ASC LIMIT 20
  `
  for (const d of revive) {
    await sql`
      INSERT INTO sales_tasks (id, org_id, deal_id, kind, title, due_at, assignee_agent_id, auto)
      VALUES (${'stk_' + d.id.slice(-8) + '_rev'}, ${ORG}, ${d.id}, 'followup',
              ${`Реактивация: ${d.title || 'сделка'} — причина «${d.reason || 'не указана'}» устарела`},
              NOW(), ${d.owner_agent_id}, true)
      ON CONFLICT (id) DO NOTHING
    `
    // Снимаем срок, чтобы задача не создавалась повторно каждую минуту
    await sql`UPDATE sales_deals SET reactivate_at = NULL WHERE id = ${d.id}`
    out.reactivated++
    if (token && d.telegram_id) {
      await tgSend(token, d.telegram_id,
        `⚡ <b>Вернулась из реактивации</b>\n${d.title}\nПричина отказа «${d.reason}» могла устареть — стоит новое касание.`)
    }
  }

  return json({ ok: true, ...out })
}
