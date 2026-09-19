import { getSQL, json, ensureOnce, getOrgBotToken } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { computeBrandSignals, type DeclineSignal, type LaunchSignal } from '../_lib/brand-signals.js'
import { salesId } from '../_lib/sales-schema.js'
import { sendNotification } from '../_lib/notifications.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = 'org_delever'

/**
 * Утренний крон сигналов (09:00 Ташкента): по каждому свежему сигналу —
 * задача ответственному (видна в «Моё» и «Задачах»), уведомление в
 * колокольчик, и одна сводка в телеграм-группу «Delever team» с
 * упоминаниями. Дедуп: спад — раз в 7 дней, запуск — раз в 3 дня,
 * журнал в brand_signal_log.
 *
 * Группа подключается командой /signals_here от сотрудника в группе,
 * куда добавлен платформенный бот; без группы сводка идёт владельцу.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied
  const sql = getSQL()

  await ensureOnce('brand_signal_log', async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS brand_signal_log (
        account_id text NOT NULL,
        kind text NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, kind)
      )`
  })

  const res = await computeBrandSignals(sql)
  if (res.ok === false) return json({ ok: false, error: res.error }, 200)

  const log = await sql`SELECT account_id, kind, sent_at FROM brand_signal_log`
  const lastSent: Record<string, number> = {}
  for (const r of log as any[]) lastSent[`${r.account_id}|${r.kind}`] = new Date(r.sent_at).getTime()
  const daysAgo = (k: string) => (Date.now() - (lastSent[k] || 0)) / 86400e3

  const freshDeclines = res.declines.filter(d => daysAgo(`${d.accountId}|decline`) >= 7)
  const freshLaunches = res.launches.filter(l => l.level === 'red' && daysAgo(`${l.accountId}|launch`) >= 3)
  if (!freshDeclines.length && !freshLaunches.length) {
    return json({ ok: true, quiet: true, declines: res.declines.length, launches: res.launches.length })
  }

  // Ташкентский вечер сегодняшнего дня — срок задачи
  const due = new Date()
  due.setUTCHours(13, 0, 0, 0) // 18:00 Ташкента

  const agents = await sql`
    SELECT id, name, telegram_id FROM support_agents WHERE COALESCE(is_active, true)`
  const agentById: Record<string, any> = {}
  for (const a of agents as any[]) agentById[a.id] = a

  const makeTask = async (accountId: string, ownerAgentId: string | null, title: string) => {
    await sql`
      INSERT INTO sales_tasks (id, org_id, account_id, kind, title, due_at, assignee_agent_id, auto, created_by_agent_id)
      VALUES (${salesId('task')}, ${ORG}, ${accountId}, 'signal', ${title.slice(0, 490)},
              ${due.toISOString()}, ${ownerAgentId}, true, 'brand_signals')`
  }
  const notify = async (ownerAgentId: string | null, title: string, body: string, accountId: string) => {
    try {
      await sendNotification({
        orgId: ORG, type: 'assignment', priority: 'high',
        title, body, link: `/sales/accounts/${accountId}`,
        ...(ownerAgentId ? { targetAgentIds: [ownerAgentId] } : { targetRoles: ['admin'] }),
      })
    } catch { /* колокольчик — не контракт */ }
  }

  const mention = (agentId: string | null) => {
    const a = agentId ? agentById[agentId] : null
    if (!a) return ''
    return a.telegram_id ? ` — [${a.name}](tg://user?id=${a.telegram_id})` : ` — ${a.name}`
  }

  const lines: string[] = []
  for (const d of freshDeclines) {
    const title = `Спад заказов у «${d.name}»: −${d.dropPct}% к норме (${d.weeklyNow}/нед против ${d.weeklyNorm})`
    await makeTask(d.accountId, d.ownerAgentId, `${title} — позвонить и разобраться`)
    await notify(d.ownerAgentId, 'Спад заказов у клиента', title, d.accountId)
    await sql`
      INSERT INTO brand_signal_log (account_id, kind) VALUES (${d.accountId}, 'decline')
      ON CONFLICT (account_id, kind) DO UPDATE SET sent_at = now()`
    lines.push(`📉 *${d.name}*: −${d.dropPct}% к норме (${d.weeklyNow}/нед, норма ${d.weeklyNorm})${mention(d.ownerAgentId)}`)
  }
  for (const l of freshLaunches) {
    const title = `Запуск «${l.name}» буксует: ${l.done30} заказов/30д, отмены ${l.cancelPct}%, день ${l.ageDays}`
    await makeTask(l.accountId, l.ownerAgentId, `${title} — дожать активацию, пока идёт оплаченный период`)
    await notify(l.ownerAgentId, 'Запуск клиента под угрозой', title, l.accountId)
    await sql`
      INSERT INTO brand_signal_log (account_id, kind) VALUES (${l.accountId}, 'launch')
      ON CONFLICT (account_id, kind) DO UPDATE SET sent_at = now()`
    lines.push(`🚧 *${l.name}*: ${l.done30} заказов/30д, отмены ${l.cancelPct}%, день ${l.ageDays}${mention(l.ownerAgentId)}`)
  }

  // Одна утренняя сводка в группу (или владельцу, пока группа не подключена).
  // Группу слушает ПЛАТФОРМЕННЫЙ бот (/signals_here ловит он) — им и шлём;
  // личка владельца — орг-ботом, как остальные его уведомления.
  try {
    const [g] = await sql`
      SELECT value FROM support_settings WHERE org_id = ${ORG} AND key = 'signals_group_chat_id' LIMIT 1`
    const groupChat = (g as any)?.value || null
    let token: string | null = null
    let chatId: string | null = null
    if (groupChat) {
      const [p] = await sql`SELECT value FROM support_platform_settings WHERE key = 'platform_bot_token'`
      token = (p as any)?.value || null
      chatId = groupChat
    } else {
      token = await getOrgBotToken(ORG)
      const [owner] = await sql`SELECT telegram_id FROM support_agents WHERE id = 'agent_1772526727220_akc3'`
      chatId = (owner as any)?.telegram_id || null
    }
    if (token && chatId) {
      {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            parse_mode: 'Markdown',
            text: `🔔 Сигналы по клиентам (данные Delever, ${new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10)}):\n\n${lines.join('\n')}\n\nЗадачи созданы ответственным — смотрите «Моё» и страницу «Сигналы».`,
          }),
        })
      }
    }
  } catch { /* сводка — не контракт: задачи и колокольчик уже созданы */ }

  return json({ ok: true, declines: freshDeclines.length, launches: freshLaunches.length })
}
