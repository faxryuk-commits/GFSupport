import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Get fresh photo URL from Telegram for a user
async function getFreshUserPhotoUrl(botToken: string, telegramUserId: string): Promise<string | null> {
  try {
    // Get user profile photos
    const photosRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramUserId}&limit=1`
    )
    const photosData = await photosRes.json()
    
    if (photosData.ok && photosData.result?.photos?.length > 0) {
      // Get the smallest photo (first in the array)
      const photo = photosData.result.photos[0]
      if (photo && photo.length > 0) {
        const smallestPhoto = photo[0] // Usually 160x160
        
        // Get file path
        const fileRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${smallestPhoto.file_id}`
        )
        const fileData = await fileRes.json()
        
        if (fileData.ok) {
          return `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
        }
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
  const userId = url.searchParams.get('userId')
  
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), { 
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

    // Skip non-numeric IDs (WhatsApp phone numbers that aren't valid Telegram IDs)
    const isValidTelegramId = /^\d{5,15}$/.test(userId)
    if (!isValidTelegramId) {
      return new Response(null, { status: 404, headers: corsHeaders })
    }

    const cached = await sql`
      SELECT sender_photo_url FROM support_messages 
      WHERE sender_id = ${userId} AND sender_photo_url IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `
    
    let photoUrl = cached[0]?.sender_photo_url
    
    if (photoUrl) {
      try {
        const checkRes = await fetch(photoUrl, { method: 'HEAD' })
        if (!checkRes.ok) photoUrl = null
      } catch { photoUrl = null }
    }
    
    if (!photoUrl) {
      photoUrl = await getFreshUserPhotoUrl(botToken, userId)
      if (photoUrl) {
        await sql`UPDATE support_messages SET sender_photo_url = ${photoUrl} WHERE sender_id = ${userId}`.catch(() => {})
      }
    }
    
    if (!photoUrl) {
      return new Response(null, { status: 404, headers: corsHeaders })
    }
    
    try {
      let imageRes = await fetch(photoUrl)
      if (!imageRes.ok) {
        photoUrl = await getFreshUserPhotoUrl(botToken, userId)
        if (photoUrl) {
          await sql`UPDATE support_messages SET sender_photo_url = ${photoUrl} WHERE sender_id = ${userId}`.catch(() => {})
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
    console.error('User photo proxy error:', e)
    return new Response(null, { status: 404, headers: corsHeaders })
  }
}
