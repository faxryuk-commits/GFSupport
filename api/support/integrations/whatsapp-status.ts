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

  try {
    const res = await fetch(`${bridgeUrl}/qr`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return json({ connected: false, phone: null, qr: null, error: 'Bridge unavailable' })
    }

    const data = await res.json()
    return json({ ...data, configured: true })
  } catch (e: any) {
    return json({ connected: false, phone: null, qr: null, configured: true, error: 'Bridge offline' })
  }
}
