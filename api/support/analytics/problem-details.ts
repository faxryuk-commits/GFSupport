import { getSQL } from '../lib/db.js'

export const config = { runtime: 'edge' }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })

export async function GET(req: Request) {
  try {
    const sql = getSQL()
    const url = new URL(req.url)
    const category = url.searchParams.get('category') || ''
    const period = url.searchParams.get('period') || '30d'
    
    // Calculate date range
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 30
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    // 1. Get cases for this category
    const cases = await sql`
      SELECT 
        c.id, c.title, c.description, c.priority, c.status,
        c.channel_id, c.created_at, c.resolved_at,
        ch.name as channel_name
      FROM support_cases c
      LEFT JOIN support_channels ch ON c.channel_id = ch.id
      WHERE c.category = ${category}
        AND c.created_at >= ${startDate.toISOString()}
      ORDER BY c.created_at DESC
      LIMIT 100
    `
    
    // 2. Analyze root causes from descriptions
    const rootCauses: Record<string, { count: number; examples: string[] }> = {}
    const keywords: Record<string, string[]> = {
      'Интеграция не работает': ['интеграция', 'iiko', 'rkeeper', 'yandex', 'wolt', 'uzum'],
      'Заказы не проходят': ['заказ', 'order', 'buyurtma', 'не проходит', 'ошибка'],
      'Чеки не печатаются': ['чек', 'печат', 'принтер', 'chek', 'printer'],
      'Проблемы с меню': ['меню', 'menu', 'товар', 'product', 'цена', 'price'],
      'Скидки не работают': ['скидка', 'chegirma', 'discount', 'акция', 'promocode'],
      'Доступ/Авторизация': ['доступ', 'пароль', 'логин', 'вход', 'access', 'login'],
      'Синхронизация данных': ['синхрон', 'sync', 'обновл', 'update', 'данные'],
      'Отмены заказов': ['отмен', 'cancel', 'bekor', 'возврат'],
    }
    
    for (const c of cases) {
      const text = ((c.title || '') + ' ' + (c.description || '')).toLowerCase()
      let matched = false
      
      for (const [cause, words] of Object.entries(keywords)) {
        if (words.some(w => text.includes(w))) {
          if (!rootCauses[cause]) {
            rootCauses[cause] = { count: 0, examples: [] }
          }
          rootCauses[cause].count++
          if (rootCauses[cause].examples.length < 3) {
            rootCauses[cause].examples.push(c.title?.slice(0, 60) || '')
          }
          matched = true
          break
        }
      }
      
      if (!matched) {
        if (!rootCauses['Прочее']) {
          rootCauses['Прочее'] = { count: 0, examples: [] }
        }
        rootCauses['Прочее'].count++
      }
    }
    
    // 3. Group by channels (segments)
    const byChannel: Record<string, { count: number; resolved: number; avgResolutionHours: number }> = {}
    for (const c of cases) {
      const ch = c.channel_name || 'Неизвестно'
      if (!byChannel[ch]) {
        byChannel[ch] = { count: 0, resolved: 0, avgResolutionHours: 0 }
      }
      byChannel[ch].count++
      if (c.status === 'resolved' && c.resolved_at) {
        byChannel[ch].resolved++
        const hours = (new Date(c.resolved_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60)
        byChannel[ch].avgResolutionHours = (byChannel[ch].avgResolutionHours * (byChannel[ch].resolved - 1) + hours) / byChannel[ch].resolved
      }
    }
    
    // 4. Trend by day
    const trend: Record<string, number> = {}
    for (const c of cases) {
      const day = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : ''
      if (day) trend[day] = (trend[day] || 0) + 1
    }
    
    // 5. Priority distribution
    const byPriority: Record<string, number> = {}
    for (const c of cases) {
      const p = c.priority || 'medium'
      byPriority[p] = (byPriority[p] || 0) + 1
    }
    
    // 6. Status distribution
    const byStatus: Record<string, number> = {}
    for (const c of cases) {
      const s = c.status || 'unknown'
      byStatus[s] = (byStatus[s] || 0) + 1
    }
    
    // 7. Get sample messages for context
    const sampleMessages = await sql`
      SELECT 
        m.text_content, m.sender_name, m.created_at,
        ch.name as channel_name
      FROM support_messages m
      JOIN support_channels ch ON m.channel_id = ch.id
      WHERE m.ai_category = ${category}
        AND m.created_at >= ${startDate.toISOString()}
        AND m.text_content IS NOT NULL
        AND LENGTH(m.text_content) > 20
      ORDER BY m.created_at DESC
      LIMIT 10
    `
    
    // Format response
    const topChannels = Object.entries(byChannel)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        count: data.count,
        resolved: data.resolved,
        resolutionRate: data.count > 0 ? Math.round(data.resolved / data.count * 100) : 0,
        avgResolutionHours: Math.round(data.avgResolutionHours * 10) / 10
      }))
    
    const topCauses = Object.entries(rootCauses)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([cause, data]) => ({
        cause,
        count: data.count,
        percentage: cases.length > 0 ? Math.round(data.count / cases.length * 100) : 0,
        examples: data.examples
      }))
    
    const dailyTrend = Object.entries(trend)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }))
    
    return json({
      category,
      period,
      summary: {
        totalCases: cases.length,
        resolved: byStatus['resolved'] || 0,
        active: (byStatus['detected'] || 0) + (byStatus['in_progress'] || 0) + (byStatus['waiting'] || 0),
        resolutionRate: cases.length > 0 ? Math.round((byStatus['resolved'] || 0) / cases.length * 100) : 0
      },
      rootCauses: topCauses,
      topChannels,
      byPriority,
      byStatus,
      dailyTrend,
      sampleMessages: sampleMessages.map((m: any) => ({
        text: m.text_content?.slice(0, 200),
        sender: m.sender_name,
        channel: m.channel_name,
        date: m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : ''
      }))
    })
    
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
}
