import { getRequestOrgId } from '../lib/org.js'
import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

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
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Org-Id',
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

  try {
    const sql = getSQL()
    const orgId = await getRequestOrgId(req)

    let botToken: string | null = null
    try {
      const tokenRows = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token' AND org_id = ${orgId} LIMIT 1`
      if (tokenRows[0]?.value) botToken = tokenRows[0].value
    } catch {}
    if (!botToken) botToken = process.env.TELEGRAM_BOT_TOKEN || null
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'Bot not configured' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    let channel
    if (channelId) {
      const result = await sql`
        SELECT id, telegram_chat_id, photo_url FROM support_channels WHERE id = ${channelId} AND org_id = ${orgId}
      `
      channel = result[0]
    } else if (chatId) {
      const result = await sql`
        SELECT id, telegram_chat_id, photo_url FROM support_channels WHERE telegram_chat_id = ${chatId} AND org_id = ${orgId}
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
    
    if (photoUrl) {
      try {
        const checkRes = await fetch(photoUrl, { method: 'HEAD' })
        if (!checkRes.ok) photoUrl = null
      } catch {
        photoUrl = null
      }
    }
    
    if (!photoUrl) {
      photoUrl = await getFreshPhotoUrl(botToken, channel.telegram_chat_id)
      if (photoUrl) {
        await sql`
          UPDATE support_channels 
          SET photo_url = ${photoUrl}, updated_at = NOW()
          WHERE id = ${channel.id} AND org_id = ${orgId}
        `
      }
    }
    
    if (!photoUrl) {
      return new Response(null, { status: 404, headers: corsHeaders })
    }
    
    try {
      let imageRes = await fetch(photoUrl)
      if (!imageRes.ok) {
        photoUrl = await getFreshPhotoUrl(botToken, channel.telegram_chat_id)
        if (photoUrl) {
          await sql`UPDATE support_channels SET photo_url = ${photoUrl} WHERE id = ${channel.id} AND org_id = ${orgId}`
          imageRes = await fetch(photoUrl)
        }
        if (!imageRes.ok) return new Response(null, { status: 404, headers: corsHeaders })
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
