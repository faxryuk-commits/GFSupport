export const config = {
  runtime: 'edge',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL
  const bridgeSecret = process.env.WHATSAPP_BRIDGE_SECRET
  if (!bridgeUrl) {
    return json({ connected: false, phone: null, qr: null, configured: false })
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const action = body.action as string | undefined

      if (action === 'logout') {
        const res = await fetch(`${bridgeUrl}/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${bridgeSecret}`,
          },
          signal: AbortSignal.timeout(10000),
        })
        const data = await res.json()
        return json(data, res.status)
      }

      const res = await fetch(`${bridgeUrl}/filter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bridgeSecret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      const data = await res.json()
      return json(data, res.status)
    } catch (e: any) {
      return json({ error: `Bridge offline: ${e.message}` }, 502)
    }
  }

  try {
    const res = await fetch(`${bridgeUrl}/qr`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return json({ connected: false, phone: null, qr: null, configured: true, error: `Bridge HTTP ${res.status}`, debug: { body: body.slice(0, 200) } })
    }

    const data = await res.json()
    return json({ ...data, configured: true })
  } catch (e: any) {
    return json({ connected: false, phone: null, qr: null, configured: true, error: `Bridge offline: ${e.message}` })
  }
}
