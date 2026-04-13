import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)
  const url = new URL(req.url)

  // Создаём таблицу если не существует
  await sql`
    CREATE TABLE IF NOT EXISTS support_broadcast_scheduled (
      id VARCHAR(50) PRIMARY KEY,
      org_id VARCHAR(50) NOT NULL DEFAULT 'org_delever',
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
  
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS message_text TEXT`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS message_type VARCHAR(30) DEFAULT 'announcement'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS notification_type VARCHAR(30) DEFAULT 'announcement'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS filter_type VARCHAR(30) DEFAULT 'all'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS selected_channels TEXT[]`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Tashkent'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) DEFAULT 'ai'`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_id VARCHAR(64)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS media_url TEXT`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS media_type VARCHAR(30)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS broadcast_id VARCHAR(50)`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS error_message TEXT`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS recipients_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS viewed_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS reaction_count INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE support_broadcast_scheduled ADD COLUMN IF NOT EXISTS org_id VARCHAR(50) DEFAULT 'org_delever'`.catch(() => {})
  await sql`UPDATE support_broadcast_scheduled SET org_id = 'org_delever' WHERE org_id IS NULL`.catch(() => {})

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
          WHERE org_id = ${orgId} AND status = 'pending' 
          ORDER BY scheduled_at ASC
        `
      } else if (status === 'sent') {
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE org_id = ${orgId} AND status = 'sent' 
          ORDER BY sent_at DESC
          LIMIT 20
        `
      } else if (from && to) {
        // Для календаря - все за период
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE org_id = ${orgId}
            AND scheduled_at >= ${from}::timestamp 
            AND scheduled_at <= ${to}::timestamp
          ORDER BY scheduled_at ASC
        `
      } else {
        // Все (последние 50)
        scheduled = await sql`
          SELECT * FROM support_broadcast_scheduled 
          WHERE org_id = ${orgId}
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
      
      // sendNow: create with status='pending' and scheduled_at=NOW()
      // The cron (every 5 min) will pick it up. No self-call to /execute to avoid race conditions.
      if (sendNow) {
        let recipientsCount = 0
        if (filterType === 'selected' && selectedChannels.length > 0) {
          recipientsCount = selectedChannels.length
        } else if (filterType === 'clients') {
          const countResult = await sql`
            SELECT COUNT(*) as count FROM support_channels 
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
              AND (type = 'client' OR sla_category = 'client')
          `
          recipientsCount = parseInt(countResult[0]?.count || '0')
        } else if (filterType === 'partners') {
          const countResult = await sql`
            SELECT COUNT(*) as count FROM support_channels 
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
              AND (type = 'partner' OR sla_category = 'partner')
          `
          recipientsCount = parseInt(countResult[0]?.count || '0')
        } else {
          const countResult = await sql`
            SELECT COUNT(*) as count FROM support_channels 
            WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
          `
          recipientsCount = parseInt(countResult[0]?.count || '0')
        }
        
        const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        await sql`
          INSERT INTO support_broadcast_scheduled (
            id, org_id, message_text, message_type, notification_type, filter_type, selected_channels,
            scheduled_at, timezone, status, sender_type, sender_id, sender_name,
            media_url, media_type, created_by, recipients_count
          ) VALUES (
            ${id}, ${orgId}, ${messageText}, ${messageType}, ${notificationType}, ${filterType}, ${selectedChannels},
            NOW(), ${timezone}, 'pending', ${senderType}, ${senderId || null}, ${senderName || null},
            ${mediaUrl || null}, ${mediaType || null}, ${createdBy}, ${recipientsCount}
          )
        `

        return json({
          success: true,
          id,
          sendNow: true,
          recipientsCount,
          message: 'Broadcast queued — will be sent within 5 minutes by cron'
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
      
      let recipientsCount = 0
      if (filterType === 'selected' && selectedChannels.length > 0) {
        recipientsCount = selectedChannels.length
      } else if (filterType === 'clients') {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM support_channels 
          WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
            AND (type = 'client' OR sla_category = 'client')
        `
        recipientsCount = parseInt(countResult[0]?.count || '0')
      } else if (filterType === 'partners') {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM support_channels 
          WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
            AND (type = 'partner' OR sla_category = 'partner')
        `
        recipientsCount = parseInt(countResult[0]?.count || '0')
      } else {
        const countResult = await sql`
          SELECT COUNT(*) as count FROM support_channels 
          WHERE telegram_chat_id IS NOT NULL AND org_id = ${orgId}
        `
        recipientsCount = parseInt(countResult[0]?.count || '0')
      }
      
      const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      await sql`
        INSERT INTO support_broadcast_scheduled (
          id, org_id, message_text, message_type, notification_type, filter_type, selected_channels,
          scheduled_at, timezone, status, sender_type, sender_id, sender_name,
          media_url, media_type, created_by, recipients_count
        ) VALUES (
          ${id}, ${orgId}, ${messageText}, ${messageType}, ${notificationType}, ${filterType}, ${selectedChannels},
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

  // DELETE - отменить рассылку (pending, processing, sending, sent)
  if (req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id')
      const stopAll = url.searchParams.get('stopAll')

      // Stop ALL active broadcasts
      if (stopAll === 'true') {
        const result = await sql`
          UPDATE support_broadcast_scheduled 
          SET status = 'cancelled', error_message = 'Остановлено вручную'
          WHERE org_id = ${orgId}
            AND status IN ('pending', 'processing', 'sending')
          RETURNING id
        `
        return json({
          success: true,
          cancelled: result.length,
          message: `Остановлено ${result.length} рассылок`
        })
      }

      if (!id) {
        return json({ error: 'Schedule ID is required' }, 400)
      }
      
      const existing = await sql`
        SELECT id, status FROM support_broadcast_scheduled WHERE id = ${id} AND org_id = ${orgId}
      `
      
      if (existing.length === 0) {
        return json({ error: 'Scheduled broadcast not found' }, 404)
      }

      const cancellable = ['pending', 'processing', 'sending', 'sent']
      if (!cancellable.includes(existing[0].status)) {
        return json({ error: `Cannot cancel broadcast with status '${existing[0].status}'` }, 400)
      }
      
      await sql`
        UPDATE support_broadcast_scheduled 
        SET status = 'cancelled', error_message = 'Остановлено вручную'
        WHERE id = ${id} AND org_id = ${orgId}
      `
      
      return json({ success: true, message: 'Broadcast cancelled' })
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
