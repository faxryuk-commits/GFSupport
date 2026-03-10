import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function getBotToken(): Promise<string | null> {
  try {
    const sql = getSQL()
    const rows = await sql`SELECT value FROM support_settings WHERE key = 'telegram_bot_token' LIMIT 1`
    if (rows[0]?.value) return rows[0].value
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null
}

async function resolveFileUrl(botToken: string, fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
    const data = await res.json()
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`
    }
  } catch {}
  return null
}

/**
 * GET /api/support/media/proxy?url=...  — проксирует любой HTTPS media URL
 * GET /api/support/media/proxy?fileId=... — резолвит Telegram file_id и проксирует
 * GET /api/support/media/proxy?tg=tg://photo/FILE_ID — резолвит tg:// URL и проксирует
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const params = new URL(req.url).searchParams
  const rawUrl = params.get('url')
  const fileId = params.get('fileId')
  const tgUrl = params.get('tg')

  let targetUrl: string | null = null

  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
    targetUrl = rawUrl
  } else if (fileId || tgUrl) {
    const botToken = await getBotToken()
    if (!botToken) {
      return new Response(null, { status: 502, headers: corsHeaders })
    }

    let resolvedFileId = fileId
    if (!resolvedFileId && tgUrl) {
      const parts = tgUrl.replace('tg://', '').split('/')
      resolvedFileId = parts.length >= 2 ? parts.slice(1).join('/') : parts[0]
    }

    if (resolvedFileId) {
      targetUrl = await resolveFileUrl(botToken, resolvedFileId)
    }
  }

  if (!targetUrl) {
    return new Response(null, { status: 400, headers: corsHeaders })
  }

  try {
    const res = await fetch(targetUrl)
    if (!res.ok) {
      // URL expired — try to re-resolve if we have a fileId
      if (fileId || tgUrl) {
        const botToken = await getBotToken()
        let fid = fileId
        if (!fid && tgUrl) {
          const parts = tgUrl.replace('tg://', '').split('/')
          fid = parts.length >= 2 ? parts.slice(1).join('/') : parts[0]
        }
        if (botToken && fid) {
          const freshUrl = await resolveFileUrl(botToken, fid)
          if (freshUrl) {
            const freshRes = await fetch(freshUrl)
            if (freshRes.ok) {
              const body = await freshRes.arrayBuffer()
              return new Response(body, {
                headers: {
                  ...corsHeaders,
                  'Content-Type': freshRes.headers.get('Content-Type') || 'application/octet-stream',
                  'Cache-Control': 'public, max-age=86400',
                },
              })
            }
          }
        }
      }
      return new Response(null, { status: 404, headers: corsHeaders })
    }

    const body = await res.arrayBuffer()
    return new Response(body, {
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response(null, { status: 502, headers: corsHeaders })
  }
}
