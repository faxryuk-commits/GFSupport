import { getSQL, json, corsHeaders } from '../lib/db.js'
import { extractAgentContext } from '../lib/auth.js'

export const config = { runtime: 'edge' }

const DEMO_PREFIX = 'demo_'

function demoId(type: string, n: number) {
  return `${DEMO_PREFIX}${type}_${n}`
}

const now = new Date()
function ago(minutes: number) {
  return new Date(now.getTime() - minutes * 60000).toISOString()
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })

  const sql = getSQL()
  const ctx = await extractAgentContext(req)
  if (!ctx?.orgId) return json({ error: 'Unauthorized' }, 401)

  const orgId = ctx.orgId

  if (req.method === 'POST') {
    try {
      const [existing] = await sql`
        SELECT id FROM support_channels WHERE org_id = ${orgId} AND id LIKE ${DEMO_PREFIX + '%'} LIMIT 1
      `
      if (existing) return json({ error: 'Демо-данные уже созданы', hasDemo: true }, 409)

      const channels = [
        { id: demoId('ch', 1), name: 'ООО "Ромашка" — Поддержка', type: 'client', chatId: -1000000001 },
        { id: demoId('ch', 2), name: 'ИП Иванов — Интеграция', type: 'client', chatId: -1000000002 },
        { id: demoId('ch', 3), name: 'Фрилансер Алексей — Вопросы', type: 'client', chatId: -1000000003 },
      ]

      for (const ch of channels) {
        await sql`
          INSERT INTO support_channels (id, telegram_chat_id, name, type, is_active, org_id, members_count, created_at, last_message_at)
          VALUES (${ch.id}, ${ch.chatId}, ${ch.name}, ${ch.type}, true, ${orgId}, 3, ${ago(1440)}, ${ago(5)})
          ON CONFLICT (id) DO NOTHING
        `
      }

      const messages: Array<{ id: string; chId: string; sender: string; senderName: string; text: string; isClient: boolean; min: number }> = [
        { id: demoId('msg', 1), chId: demoId('ch', 1), sender: '100001', senderName: 'Мария', text: 'Здравствуйте! У нас не работает оплата на сайте. Клиенты жалуются.', isClient: true, min: 120 },
        { id: demoId('msg', 2), chId: demoId('ch', 1), sender: '100002', senderName: 'Поддержка', text: 'Добрый день, Мария! Проверяем. Какой способ оплаты не работает?', isClient: false, min: 115 },
        { id: demoId('msg', 3), chId: demoId('ch', 1), sender: '100001', senderName: 'Мария', text: 'Карта Visa и Mastercard. При оплате пишет "Ошибка шлюза".', isClient: true, min: 110 },
        { id: demoId('msg', 4), chId: demoId('ch', 1), sender: '100002', senderName: 'Поддержка', text: 'Нашли проблему — сертификат истёк. Уже обновляем, будет готово в течение часа.', isClient: false, min: 90 },
        { id: demoId('msg', 5), chId: demoId('ch', 1), sender: '100001', senderName: 'Мария', text: 'Спасибо! Ждём.', isClient: true, min: 88 },

        { id: demoId('msg', 6), chId: demoId('ch', 2), sender: '200001', senderName: 'Дмитрий Иванов', text: 'Привет! Подскажите, как подключить API для выгрузки заказов?', isClient: true, min: 60 },
        { id: demoId('msg', 7), chId: demoId('ch', 2), sender: '200002', senderName: 'Техподдержка', text: 'Дмитрий, добрый день! Вот документация: /docs. Нужен API-ключ из настроек.', isClient: false, min: 55 },
        { id: demoId('msg', 8), chId: demoId('ch', 2), sender: '200001', senderName: 'Дмитрий Иванов', text: 'А как генерировать ключ? Не могу найти раздел.', isClient: true, min: 50 },

        { id: demoId('msg', 9), chId: demoId('ch', 3), sender: '300001', senderName: 'Алексей', text: 'Ребят, у меня проект горит. Можно срочно посмотреть почему webhook не приходит?', isClient: true, min: 15 },
        { id: demoId('msg', 10), chId: demoId('ch', 3), sender: '300002', senderName: 'Саша', text: 'Алексей, проверяю сейчас. Какой URL вебхука?', isClient: false, min: 10 },
        { id: demoId('msg', 11), chId: demoId('ch', 3), sender: '300001', senderName: 'Алексей', text: 'https://myapp.com/webhook — на этот адрес ничего не приходит уже 2 часа', isClient: true, min: 8 },
      ]

      for (const m of messages) {
        await sql`
          INSERT INTO support_messages (id, channel_id, sender_id, sender_name, text_content, is_from_client, org_id, created_at, content_type)
          VALUES (${m.id}, ${m.chId}, ${m.sender}, ${m.senderName}, ${m.text}, ${m.isClient}, ${orgId}, ${ago(m.min)}, 'text')
          ON CONFLICT (id) DO NOTHING
        `
      }

      const cases = [
        {
          id: demoId('case', 1), chId: demoId('ch', 1),
          title: 'Не работает оплата картой', status: 'in_progress', priority: 'high',
          category: 'technical', description: 'Клиент ООО "Ромашка" сообщает об ошибке шлюза при оплате Visa/MC.',
          ticketNum: 1001, createdMin: 120,
        },
        {
          id: demoId('case', 2), chId: demoId('ch', 2),
          title: 'Вопрос по API интеграции', status: 'detected', priority: 'medium',
          category: 'question', description: 'ИП Иванов не может найти раздел генерации API-ключей.',
          ticketNum: 1002, createdMin: 60,
        },
        {
          id: demoId('case', 3), chId: demoId('ch', 3),
          title: 'Webhook не доставляется', status: 'detected', priority: 'critical',
          category: 'technical', description: 'Фрилансер Алексей: вебхуки не приходят на указанный URL уже 2 часа. Проект горит.',
          ticketNum: 1003, createdMin: 15,
        },
      ]

      for (const c of cases) {
        await sql`
          INSERT INTO support_cases (id, channel_id, title, description, status, priority, category, org_id, ticket_number, created_at)
          VALUES (${c.id}, ${c.chId}, ${c.title}, ${c.description}, ${c.status}, ${c.priority}, ${c.category}, ${orgId}, ${c.ticketNum}, ${ago(c.createdMin)})
          ON CONFLICT (id) DO NOTHING
        `
      }

      await sql`
        INSERT INTO support_settings (org_id, key, value) VALUES (${orgId}, 'has_demo_data', 'true')
        ON CONFLICT (org_id, key) DO UPDATE SET value = 'true'
      `

      return json({ success: true, message: 'Демо-данные созданы', channels: channels.length, messages: messages.length, cases: cases.length })

    } catch (e: any) {
      console.error('[Demo Seed]', e)
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'DELETE') {
    try {
      const prefix = DEMO_PREFIX + '%'

      await sql`DELETE FROM support_messages WHERE org_id = ${orgId} AND id LIKE ${prefix}`
      await sql`DELETE FROM support_cases WHERE org_id = ${orgId} AND id LIKE ${prefix}`
      await sql`DELETE FROM support_channels WHERE org_id = ${orgId} AND id LIKE ${prefix}`
      await sql`DELETE FROM support_settings WHERE org_id = ${orgId} AND key = 'has_demo_data'`

      return json({ success: true, message: 'Демо-данные удалены' })
    } catch (e: any) {
      console.error('[Demo Delete]', e)
      return json({ error: e.message }, 500)
    }
  }

  if (req.method === 'GET') {
    const [row] = await sql`
      SELECT value FROM support_settings WHERE org_id = ${orgId} AND key = 'has_demo_data'
    `
    return json({ hasDemo: row?.value === 'true' })
  }

  return json({ error: 'Method not allowed' }, 405)
}
