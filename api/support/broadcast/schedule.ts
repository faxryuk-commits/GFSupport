import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const sql = getSQL()
  const url = new URL(req.url)

  // Создаём таблицу если не существует
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcast_scheduled (
      id VARCHAR(50) PRIMARY KEY,
      message_text TEXT NOT NULL,
      message_type VARCHAR(30) DEFAULT 'announcement',
      notification_type VARCHAR(30) DEFAULT 'announcement',
      filter_type VARCHAR(30) DEFAULT 'all',
      selected_channels TEXT[],
      scheduled_at TIMESTAMP NOT NULL,
      timezone VARCHAR(50) DEFAULT 'Asia/Tashkent',
      status VARCHAR(20) DEFAULT 'pending',
      sender_type VARCHAR(20) DEFAULT 'ai',
      sender_id VARCHAR(64),
      sender_name VARCHAR(255),
      media_url TEXT,
      media_type VARCHAR(30),
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      sent_at TIMESTAMP,
      broadcast_id VARCHAR(50),
      error_message TEXT,
      recipients_count INTEGER DEFAULT 0,
      delivered_count INTEGER DEFAULT 0,
      viewed_count INTEGER DEFAULT 0,
      reaction_count INTEGER DEFAULT 0
    )
  `.catch(() => {})
  
  // Добавляем новые колонки если их нет
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS notification_type VARCHAR(30) DEFAULT 'announcement'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) DEFAULT 'ai'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_id VARCHAR(64)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS media_url TEXT`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS media_type VARCHAR(30)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS recipients_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS viewed_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS reaction_count INTEGER DEFAULT 0`.catch(() => {})

  // GET - список запланированных рассылок
  if (req.method === 'GET') {
    try {
      const status = url.searchParams.get('status') // pending, sent, all
      const from = url.searchParams.get('from') // дата от
      const to = url.searchParams.get('to') // дата до
      
      let scheduled
      if (status === 'pending') {
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE status = 'pending' 
          ORDER BY scheduled_at ASC
        `
      } else if (status === 'sent') {
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE status = 'sent' 
          ORDER BY sent_at DESC
          LIMIT 20
        `
      } else if (from && to) {
        // Для календаря - все за период
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE scheduled_at >= ${from}::timestamp 
            AND scheduled_at <= ${to}::timestamp
          ORDER BY scheduled_at ASC
        `
      } else {
        // Все (последние 50)
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, scheduled_at DESC
          LIMIT 50
        `
      }
      
      return json({
        success: true,
        scheduled: scheduled.map((s: any) => ({
          id: s.id,
          messageText: s.message_text,
          messageType: s.message_type,
          notificationType: s.notification_type || 'announcement',
          filterType: s.filter_type,
          selectedChannels: s.selected_channels || [],
          scheduledAt: s.scheduled_at,
          timezone: s.timezone,
          status: s.status,
          senderType: s.sender_type || 'ai',
          senderId: s.sender_id,
          senderName: s.sender_name,
          mediaUrl: s.media_url,
          mediaType: s.media_type,
          createdBy: s.created_by,
          createdAt: s.created_at,
          sentAt: s.sent_at,
          broadcastId: s.broadcast_id,
          errorMessage: s.error_message,
          recipientsCount: s.recipients_count || 0,
          deliveredCount: s.delivered_count || 0,
          viewedCount: s.viewed_count || 0,
          reactionCount: s.reaction_count || 0,
        }))
      })
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500)
    }
  }

  // POST - создать запланированную рассылку
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { 
        messageText, 
        messageType = 'announcement',
        notificationType = 'announcement',
        filterType = 'all',
        selectedChannels = [],
        scheduledAt,
        sendNow = false,
        timezone = 'Asia/Tashkent',
        senderType = 'ai',
        senderId,
        senderName,
        mediaUrl,
        mediaType,
        createdBy = 'Unknown'
      } = body
      
      if (!messageText?.trim()) {
        return json({ error: 'Message text is required' }, 400)
      }
      
      // Если sendNow=true, отправляем немедленно
      if (sendNow) {
        // Подсчитываем количество получателей
        let recipientsCount = 0
        if (filterType === 'selected' && selectedChannels.length > 0) {
          recipientsCount = selectedChannels.length
        } else {
          const countResult = await sql`
            SELECT COUNT(*) as count FROM support_channels 
            WHERE telegram_chat_id IS NOT NULL
            ${filterType === 'clients' ? sql`AND (type = 'client' OR sla_category = 'client')` : sql``}
            ${filterType === 'partners' ? sql`AND (type = 'partner' OR sla_category = 'partner')` : sql``}
          `
          recipientsCount = parseInt(countResult[0]?.count || '0')
        }
        
        const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        await sql`
          INSERT INTO support_broadcast_scheduled (
            id, message_text, message_type, notification_type, filter_type, selected_channels,
            scheduled_at, timezone, status, sender_type, sender_id, sender_name,
            media_url, media_type, created_by, recipients_count
          ) VALUES (
            ${id}, ${messageText}, ${messageType}, ${notificationType}, ${filterType}, ${selectedChannels},
            NOW(), ${timezone}, 'sending', ${senderType}, ${senderId || null}, ${senderName || null},
            ${mediaUrl || null}, ${mediaType || null}, ${createdBy}, ${recipientsCount}
          )
        `
        
        return json({
          success: true,
          id,
          sendNow: true,
          recipientsCount,
          message: 'Broadcast queued for immediate sending'
        })
      }
      
      if (!scheduledAt) {
        return json({ error: 'Scheduled time is required' }, 400)
      }
      
      // Парсим дату
      const [datePart, timePart] = scheduledAt.split('T')
      if (!datePart || !timePart) {
        return json({ error: 'Invalid date format' }, 400)
      }
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      
      // Создаём дату в локальном времени Ташкента (UTC+5)
      const localDate = new Date(year, month - 1, day, hour, minute, 0)
      
      // Конвертируем локальное время Ташкента в UTC (вычитаем 5 часов)
      const utcDate = new Date(localDate.getTime() - 5 * 60 * 60 * 1000)
      
      // Проверяем что время в будущем
      const nowUTC = new Date()
      if (utcDate.getTime() <= nowUTC.getTime()) {
        return json({ error: 'Scheduled time must be in the future' }, 400)
      }
      
      // Подсчитываем количество получателей
      let recipientsCount = 0
      if (filterType === 'selected' && selectedChannels.length > 0) {
        recipientsCount = selectedChannels.length
      } else {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM support_channels 
          WHERE telegram_chat_id IS NOT NULL
          ${filterType === 'clients' ? sql`AND (type = 'client' OR sla_category = 'client')` : sql``}
          ${filterType === 'partners' ? sql`AND (type = 'partner' OR sla_category = 'partner')` : sql``}
        `
        recipientsCount = parseInt(countResult[0]?.count || '0')
      }
      
      const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      await sql`
        INSERT INTO support_broadcast_scheduled (
          id, message_text, message_type, notification_type, filter_type, selected_channels,
          scheduled_at, timezone, status, sender_type, sender_id, sender_name,
          media_url, media_type, created_by, recipients_count
        ) VALUES (
          ${id}, ${messageText}, ${messageType}, ${notificationType}, ${filterType}, ${selectedChannels},
          ${utcDate.toISOString()}::timestamptz, ${timezone}, 'pending', ${senderType}, ${senderId || null}, ${senderName || null},
          ${mediaUrl || null}, ${mediaType || null}, ${createdBy}, ${recipientsCount}
        )
      `
      
      return json({
        success: true,
        id,
        scheduledAt,
        recipientsCount,
        message: 'Broadcast scheduled successfully'
      })
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500)
    }
  }

  // DELETE - отменить запланированную рассылку
  if (req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id')
      
      if (!id) {
        return json({ error: 'Schedule ID is required' }, 400)
      }
      
      // Проверяем существование и статус
      const existing = await sql`
        SELECT id, status FROM support_broadcast_scheduled WHERE id = ${id}
      `
      
      if (existing.length === 0) {
        return json({ error: 'Scheduled broadcast not found' }, 404)
      }
      
      if (existing[0].status !== 'pending') {
        return json({ error: 'Can only cancel pending broadcasts' }, 400)
      }
      
      // Помечаем как отменённую
      await sql`
        UPDATE support_broadcast_scheduled 
        SET status = 'cancelled'
        WHERE id = ${id}
      `
      
      return json({
        success: true,
        message: 'Scheduled broadcast cancelled'
      })
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
