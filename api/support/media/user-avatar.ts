import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

// Proxy endpoint for user avatar photos
// Telegram photo URLs expire, so we need to refresh them dynamically
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const telegramId = url.searchParams.get('telegramId')
  const userId = url.searchParams.get('userId')

  if (!telegramId && !userId) {
    return new Response('telegramId or userId required', { status: 400 })
  }

  try {
    // Get user from database
    let user
    if (telegramId) {
      const users = await sql`
        SELECT id, telegram_id, photo_url FROM support_users WHERE telegram_id = ${telegramId} LIMIT 1
      `
      user = users[0]
    } else {
      const users = await sql`
        SELECT id, telegram_id, photo_url FROM support_users WHERE id = ${userId} LIMIT 1
      `
      user = users[0]
    }

    if (!user) {
      return new Response('User not found', { status: 404 })
    }

    // Try to use cached photo_url first
    let photoUrl = user.photo_url

    // Check if URL is valid (not expired)
    if (photoUrl) {
      try {
        const checkRes = await fetch(photoUrl, { method: 'HEAD' })
        if (checkRes.ok) {
          // URL is valid, redirect to it
          return Response.redirect(photoUrl, 302)
        }
      } catch {
        // URL invalid, need to refresh
      }
    }

    // Try to get fresh photo from Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken || !user.telegram_id) {
      // No token or telegram_id, return placeholder
      return Response.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.id)}&background=3b82f6&color=fff`, 302)
    }

    // Get user profile photos from Telegram
    const photosRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${user.telegram_id}&limit=1`
    )

    if (!photosRes.ok) {
      console.log(`[User Avatar] Failed to get photos for telegram_id ${user.telegram_id}`)
      return Response.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.id)}&background=3b82f6&color=fff`, 302)
    }

    const photosData = await photosRes.json()
    const photos = photosData.result?.photos

    if (!photos || photos.length === 0 || !photos[0] || photos[0].length === 0) {
      // No profile photo
      return Response.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.id)}&background=3b82f6&color=fff`, 302)
    }

    // Get the largest photo (last in array)
    const photo = photos[0][photos[0].length - 1]
    const fileId = photo.file_id

    // Get file path
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    )

    if (!fileRes.ok) {
      return Response.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.id)}&background=3b82f6&color=fff`, 302)
    }

    const fileData = await fileRes.json()
    const filePath = fileData.result?.file_path

    if (!filePath) {
      return Response.redirect(`https://ui-avatars.com/api/?name=${encodeURIComponent(user.id)}&background=3b82f6&color=fff`, 302)
    }

    // Construct fresh URL
    const freshUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`

    // Update cached URL in database
    await sql`
      UPDATE support_users SET photo_url = ${freshUrl}, updated_at = NOW()
      WHERE id = ${user.id}
    `

    console.log(`[User Avatar] Updated photo for user ${user.id}`)

    // Redirect to fresh URL
    return Response.redirect(freshUrl, 302)

  } catch (e: any) {
    console.error('[User Avatar] Error:', e.message)
    return Response.redirect(`https://ui-avatars.com/api/?name=User&background=3b82f6&color=fff`, 302)
  }
}
