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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const bridgeUrl = process.env.WHATSAPP_BRIDGE_URL
  if (!bridgeUrl) {
    return json({ connected: false, phone: null, qr: null, configured: false })
  }

  const target = `${bridgeUrl}/qr`

  try {
    const res = await fetch(target, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return json({ connected: false, phone: null, qr: null, configured: true, error: `Bridge HTTP ${res.status}`, debug: { target, body: body.slice(0, 200) } })
    }

    const data = await res.json()
    return json({ ...data, configured: true })
  } catch (e: any) {
    return json({ connected: false, phone: null, qr: null, configured: true, error: `Bridge offline: ${e.message}`, debug: { target } })
  }
}
