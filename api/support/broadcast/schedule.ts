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
      filter_type VARCHAR(30) DEFAULT 'all',
      selected_channels TEXT[], -- массив ID каналов для выборочной рассылки
      scheduled_at TIMESTAMP NOT NULL,
      timezone VARCHAR(50) DEFAULT 'Asia/Tashkent',
      status VARCHAR(20) DEFAULT 'pending', -- pending, sent, cancelled, failed
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      sent_at TIMESTAMP,
      broadcast_id VARCHAR(50), -- ID рассылки после отправки
      error_message TEXT
    )
  `.catch(() => {})

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
          filterType: s.filter_type,
          selectedChannels: s.selected_channels || [],
          scheduledAt: s.scheduled_at,
          timezone: s.timezone,
          status: s.status,
          createdBy: s.created_by,
          createdAt: s.created_at,
          sentAt: s.sent_at,
          broadcastId: s.broadcast_id,
          errorMessage: s.error_message,
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
        filterType = 'all',
        selectedChannels = [],
        scheduledAt,
        timezone = 'Asia/Tashkent',
        createdBy = 'Unknown'
      } = body
      
      if (!messageText?.trim()) {
        return json({ error: 'Message text is required' }, 400)
      }
      
      if (!scheduledAt) {
        return json({ error: 'Scheduled time is required' }, 400)
      }
      
      // scheduledAt приходит как "2026-02-01T05:50" (локальное время Ташкента)
      // Сохраняем как есть - PostgreSQL NOW() тоже в UTC, но мы сравниваем правильно
      
      // Парсим дату
      const [datePart, timePart] = scheduledAt.split('T')
      if (!datePart || !timePart) {
        return json({ error: 'Invalid date format' }, 400)
      }
      const [year, month, day] = datePart.split('-').map(Number)
      const [hour, minute] = timePart.split(':').map(Number)
      
      // Создаём дату в локальном времени Ташкента (UTC+5)
      // Для сравнения с NOW() в PostgreSQL конвертируем в UTC
      const localDate = new Date(year, month - 1, day, hour, minute, 0)
      
      // Конвертируем локальное время Ташкента в UTC (вычитаем 5 часов)
      const utcDate = new Date(localDate.getTime() - 5 * 60 * 60 * 1000)
      
      // Проверяем что время в будущем
      const nowUTC = new Date()
      if (utcDate.getTime() <= nowUTC.getTime()) {
        return json({ error: 'Scheduled time must be in the future' }, 400)
      }
      
      const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Сохраняем в UTC
      await sql`
        INSERT INTO support_broadcast_scheduled (
          id, message_text, message_type, filter_type, selected_channels,
          scheduled_at, timezone, status, created_by
        ) VALUES (
          ${id},
          ${messageText},
          ${messageType},
          ${filterType},
          ${selectedChannels},
          ${utcDate.toISOString()}::timestamptz,
          ${timezone},
          'pending',
          ${createdBy}
        )
      `
      
      return json({
        success: true,
        id,
        scheduledAt,
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
