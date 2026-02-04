import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

export async function GET(req: Request) {
  try {
    const sql = getSQL()
    const url = new URL(req.url)
    const oldToken = url.searchParams.get('old') || ''
    const newToken = url.searchParams.get('new') || ''
    
    if (!oldToken || !newToken) {
      return json({ 
        error: 'Provide old and new token params',
        example: '/api/support/db/fix-media-urls?old=OLD_TOKEN&new=NEW_TOKEN'
      }, 400)
    }
    
    // Update media_url replacing old token with new
    const result = await sql`
      UPDATE support_messages 
      SET media_url = REPLACE(media_url, ${oldToken}, ${newToken})
      WHERE media_url LIKE ${'%' + oldToken + '%'}
      RETURNING id
    `
    
    return json({
      success: true,
      updated: result.length,
      message: `Updated ${result.length} media URLs`
    })
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
