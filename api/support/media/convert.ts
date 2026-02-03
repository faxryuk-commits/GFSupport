export const config = {
  runtime: 'edge',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const url = new URL(req.url)
  const tgUrl = url.searchParams.get('url') || url.searchParams.get('file_id')
  
  if (!tgUrl) {
    return json({ error: 'url or file_id parameter required' }, 400)
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return json({ error: 'Bot token not configured' }, 500)
  }

  // Extract file_id from tg:// URL or use directly
  let fileId = tgUrl
  if (tgUrl.startsWith('tg://')) {
    // Format: tg://photo/file_id or tg://video/file_id etc
    const parts = tgUrl.replace('tg://', '').split('/')
    if (parts.length >= 2) {
      fileId = parts.slice(1).join('/')
    }
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
    const data = await response.json()
    
    if (data.ok && data.result?.file_path) {
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`
      return json({ 
        success: true, 
        url: fileUrl,
        filePath: data.result.file_path,
        fileSize: data.result.file_size
      })
    }
    
    return json({ error: 'Failed to get file', details: data }, 400)
  } catch (e: any) {
    return json({ error: 'Failed to convert URL', details: e.message }, 500)
  }
}
