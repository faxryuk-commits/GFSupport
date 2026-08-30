import { getRequestOrgId } from '../lib/org.js'
import { extractAgentContext } from '../lib/auth.js'
import { json, corsHeaders } from '../lib/db.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Загрузка материала в хранилище.
 *
 * Презентации лежат в дата-руме без наружной ссылки, а прикладывать к
 * предложению нечего. Заливаем в то же хранилище, где живут вложения из
 * переписки, и получаем постоянный адрес.
 *
 * Ссылка на файл в хранилище публичная — она и должна такой быть: её
 * открывает клиент, у которого нет и не будет доступа в систему. Поэтому
 * сюда кладут только то, что и так предназначено клиенту: презентации,
 * кейсы, брошюры. Договоры и прайсы «для своих» здесь не место.
 *
 * POST multipart/form-data: file
 */
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || ''
const MAX_BYTES = 25 * 1024 * 1024

/** Что клиент откроет на телефоне без плясок. */
const ALLOWED = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const orgId = await getRequestOrgId(req)
  const ctx = await extractAgentContext(req)
  if (!ctx.agentId) return json({ error: 'unauthorized' }, 401)
  if (!(ctx.isOrgAdmin || ctx.isGlobalAdmin || ctx.isSuperAdmin)) {
    return json({ error: 'Загружать материалы может только администратор' }, 403)
  }
  if (!BLOB_TOKEN) {
    return json({ error: 'Хранилище файлов не настроено' }, 500)
  }

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return json({ error: 'Не удалось прочитать файл' }, 400)
  }
  if (!file) return json({ error: 'Файл не приложен' }, 400)
  if (file.size > MAX_BYTES) {
    return json({ error: 'Файл больше 25 МБ — сожмите или дайте ссылку' }, 413)
  }
  if (file.type && !ALLOWED.includes(file.type)) {
    return json({
      error: 'Такой формат клиент может не открыть. Подойдут PDF, картинка или презентация',
    }, 415)
  }

  // Имя обезличиваем: в адресе окажется исходное название файла, а там
  // случаются и фамилии, и внутренние пометки вроде «финал_правки_шефа»
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const key = `sales/materials/${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const res = await fetch(`https://blob.vercel-storage.com/${key}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${BLOB_TOKEN}`,
        'x-api-version': '7',
        'x-content-type': file.type || 'application/octet-stream',
        'x-add-random-suffix': '0',
        'x-cache-control-max-age': '31536000',
      },
      body: await file.arrayBuffer(),
    })
    if (!res.ok) {
      return json({ error: 'Хранилище не приняло файл', details: (await res.text()).slice(0, 200) }, 502)
    }
    const data: any = await res.json()
    return json({ ok: true, url: data?.url, name: file.name, size: file.size })
  } catch (e: any) {
    return json({ error: e?.message || 'Не удалось загрузить файл' }, 500)
  }
}
