import { neon } from '@neondatabase/serverless'
import { identifySender } from '../lib/identification.js'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * Mark messages as seen by support staff
 * Called when:
 * 1. Support agent views channel in web UI
 * 2. Support agent views messages in Telegram (via webhook)
 * 
 * This updates is_read status but preserves awaiting_reply based on AI analysis
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const { 
      channelId, 
      messageIds,
      viewerId,       // Telegram user ID of viewer
      viewerUsername, // Telegram username
      viewerName,     // Telegram name
      source = 'web'  // 'web' | 'telegram'
    } = body
    
    if (!channelId && (!messageIds || messageIds.length === 0)) {
      return json({ error: 'channelId or messageIds required' }, 400)
    }

    const sql = getSQL()

    // If viewer info provided, check if they're support staff
    let isStaff = true // Default to true for web UI (authenticated)
    
    if (source === 'telegram' && viewerId) {
      const identification = await identifySender(sql, {
        telegramId: viewerId,
        username: viewerUsername,
        senderName: viewerName,
      })
      isStaff = identification.role === 'support' || identification.role === 'team'
      
      if (!isStaff) {
        // Client viewing their own messages - don't mark as read by support
        return json({ 
          success: true, 
          skipped: true, 
          reason: 'Viewer is not staff' 
        })
      }
    }

    let markedCount = 0

    if (channelId) {
      // Mark all unread client messages in channel as read
      const result = await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE channel_id = ${channelId}
          AND is_read = false
          AND is_from_client = true
        RETURNING id
      `
      markedCount = result.length

      // Reset unread count
      await sql`
        UPDATE support_channels 
        SET unread_count = 0
        WHERE id = ${channelId}
      `

      // Check if any unread messages need response (for awaiting_reply status)
      // Don't automatically clear awaiting_reply - let AI analysis handle it
      // But if staff has seen all messages, at least they're aware

      console.log(`[Messages Seen] Staff viewed channel ${channelId}, marked ${markedCount} messages as read (source: ${source})`)
    } else if (messageIds && messageIds.length > 0) {
      // Mark specific messages as read
      const result = await sql`
        UPDATE support_messages 
        SET is_read = true, read_at = NOW()
        WHERE id = ANY(${messageIds})
          AND is_read = false
        RETURNING id
      `
      markedCount = result.length

      // Update channel unread count
      if (markedCount > 0) {
        const channelResult = await sql`
          SELECT DISTINCT channel_id FROM support_messages WHERE id = ANY(${messageIds})
        `
        for (const row of channelResult) {
          const unreadCount = await sql`
            SELECT COUNT(*) as count FROM support_messages 
            WHERE channel_id = ${row.channel_id} AND is_read = false AND is_from_client = true
          `
          await sql`
            UPDATE support_channels SET unread_count = ${parseInt(unreadCount[0]?.count || 0)}
            WHERE id = ${row.channel_id}
          `
        }
      }
    }

    // Record staff activity if viewer info provided
    if (isStaff && viewerId) {
      try {
        await sql`
          INSERT INTO support_agent_activity (
            id, agent_id, agent_name, activity_type, channel_id, created_at
          ) VALUES (
            ${'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
            ${String(viewerId)},
            ${viewerName || 'Unknown'},
            'messages_viewed',
            ${channelId || null},
            NOW()
          )
        `
      } catch (e) {
        // Activity table may not exist
        console.log('[Messages Seen] Could not record activity:', e)
      }
    }

    return json({
      success: true,
      markedCount,
      source,
      isStaff,
    })

  } catch (error) {
    console.error('[Messages Seen] Error:', error)
    return json({ 
      error: 'Failed to mark messages as seen', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500)
  }
}
