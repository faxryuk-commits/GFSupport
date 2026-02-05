import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Get fresh photo URL from Telegram
async function getFreshPhotoUrl(botToken: string, telegramChatId: string): Promise<string | null> {
  try {
    const chatInfoRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${telegramChatId}`
    )
    const chatInfo = await chatInfoRes.json()
    
    if (chatInfo.ok && chatInfo.result?.photo?.small_file_id) {
      const fileRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${chatInfo.result.photo.small_file_id}`
      )
      const fileData = await fileRes.json()
      
      if (fileData.ok) {
        return `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
      }
    }
    return null
  } catch {
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const chatId = url.searchParams.get('chatId')
  
  if (!channelId && !chatId) {
    return new Response(JSON.stringify({ error: 'channelId or chatId required' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return new Response(JSON.stringify({ error: 'Bot not configured' }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  try {
    const sql = getSQL()
    
    // Get channel info
    let channel
    if (channelId) {
      const result = await sql`
        SELECT id, telegram_chat_id, photo_url FROM support_channels WHERE id = ${channelId}
      `
      channel = result[0]
    } else if (chatId) {
      const result = await sql`
        SELECT id, telegram_chat_id, photo_url FROM support_channels WHERE telegram_chat_id = ${chatId}
      `
      channel = result[0]
    }
    
    if (!channel || !channel.telegram_chat_id) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }
    
    let photoUrl = channel.photo_url
    
    // If we have a URL, check if it's still valid
    if (photoUrl) {
      try {
        const checkRes = await fetch(photoUrl, { method: 'HEAD' })
        if (!checkRes.ok) {
          // URL expired, get fresh one
          photoUrl = null
        }
      } catch {
        photoUrl = null
      }
    }
    
    // Get fresh URL if needed
    if (!photoUrl) {
      photoUrl = await getFreshPhotoUrl(botToken, channel.telegram_chat_id)
      
      // Update in database
      if (photoUrl) {
        await sql`
          UPDATE support_channels 
          SET photo_url = ${photoUrl}, updated_at = NOW()
          WHERE id = ${channel.id}
        `
      }
    }
    
    if (!photoUrl) {
      // Return a placeholder gradient image (1x1 transparent pixel)
      return new Response(null, { 
        status: 404, 
        headers: { ...corsHeaders } 
      })
    }
    
    // Proxy the image instead of redirect (Telegram URLs expire)
    try {
      const imageRes = await fetch(photoUrl)
      if (!imageRes.ok) {
        // URL expired, try to get fresh one
        photoUrl = await getFreshPhotoUrl(botToken, channel.telegram_chat_id)
        if (photoUrl) {
          await sql`UPDATE support_channels SET photo_url = ${photoUrl} WHERE id = ${channel.id}`
          const freshRes = await fetch(photoUrl)
          if (freshRes.ok) {
            const imageData = await freshRes.arrayBuffer()
            return new Response(imageData, {
              headers: {
                ...corsHeaders,
                'Content-Type': freshRes.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
              }
            })
          }
        }
        return new Response(null, { status: 404, headers: corsHeaders })
      }
      
      const imageData = await imageRes.arrayBuffer()
      return new Response(imageData, {
        headers: {
          ...corsHeaders,
          'Content-Type': imageRes.headers.get('Content-Type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        }
      })
    } catch {
      return new Response(null, { status: 404, headers: corsHeaders })
    }
    
  } catch (e: any) {
    console.error('Photo proxy error:', e)
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
}
