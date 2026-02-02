import { neon } from '@neondatabase/serverless'

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

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return json({ error: 'Bot token not configured' }, 500)
  }

  try {
    const sql = getSQL()
    
    // Ensure photo_url column exists
    await sql`ALTER TABLE support_channels ADD COLUMN IF NOT EXISTS photo_url TEXT`
    
    // Get all channels with telegram_chat_id
    const channels = await sql`
      SELECT id, telegram_chat_id, name, photo_url 
      FROM support_channels 
      WHERE telegram_chat_id IS NOT NULL
    `
    
    const results: Array<{ id: string; name: string; photoUrl: string | null; error?: string }> = []
    
    for (const channel of channels) {
      try {
        // Get chat info from Telegram
        const chatInfoRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getChat?chat_id=${channel.telegram_chat_id}`
        )
        const chatInfo = await chatInfoRes.json()
        
        if (chatInfo.ok && chatInfo.result?.photo?.small_file_id) {
          // Get file path
          const fileRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getFile?file_id=${chatInfo.result.photo.small_file_id}`
          )
          const fileData = await fileRes.json()
          
          if (fileData.ok) {
            const photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
            
            // Update in database
            await sql`
              UPDATE support_channels 
              SET photo_url = ${photoUrl} 
              WHERE id = ${channel.id}
            `
            
            results.push({ 
              id: channel.id, 
              name: channel.name, 
              photoUrl 
            })
          } else {
            results.push({ 
              id: channel.id, 
              name: channel.name, 
              photoUrl: null, 
              error: 'File not found' 
            })
          }
        } else {
          results.push({ 
            id: channel.id, 
            name: channel.name, 
            photoUrl: null, 
            error: chatInfo.ok ? 'No photo' : chatInfo.description 
          })
        }
      } catch (e: any) {
        results.push({ 
          id: channel.id, 
          name: channel.name, 
          photoUrl: null, 
          error: e.message 
        })
      }
    }
    
    const updated = results.filter(r => r.photoUrl).length
    const failed = results.filter(r => !r.photoUrl).length
    
    return json({
      success: true,
      message: `Updated ${updated} channel photos, ${failed} failed/no photo`,
      total: channels.length,
      updated,
      failed,
      results
    })
    
  } catch (e: any) {
    console.error('Update photos error:', e)
    return json({ error: e.message }, 500)
  }
}
