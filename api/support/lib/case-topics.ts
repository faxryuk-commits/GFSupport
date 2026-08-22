/**
 * Тема тикета по тексту обращения.
 *
 * Категория проставлялась при создании и в четырёх случаях из пяти оказывалась
 * «general» — то есть на вопрос «о чём нас спрашивают» отвечать было нечем.
 * Причина простая: клиенты пишут свободным текстом на трёх языках, и правилами
 * это не разбирается.
 *
 * Список тем закрытый и продуктовый: он описывает НАШУ систему, а не абстрактную
 * поддержку. По нему видно, что чинить в продукте, а не только кто быстрее
 * отвечает.
 */

export const CASE_TOPICS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'orders_not_arriving', label: 'Заказы не доходят до кассы', hint: 'заказ оформлен, но не появился в POS или на кассе, пропадает, приходит с задержкой' },
  { key: 'order_content', label: 'Ошибки в заказе', hint: 'неверный состав, дубли, не те позиции, проблемы с конкретным заказом' },
  { key: 'menu', label: 'Меню и товары', hint: 'фото, описания, модификаторы, стоп-листы, вес и цена позиции' },
  { key: 'pricing', label: 'Цены и комиссии', hint: 'цена без учёта комиссии агрегатора, наценка, расхождение цен' },
  { key: 'integration', label: 'Интеграции', hint: 'Yandex, Uzum, Glovo, Express24, выгрузка и связь с внешними площадками' },
  { key: 'pos', label: 'POS и оборудование', hint: 'касса, терминал, принтер, iiko, Poster, Clopos, Alisa' },
  { key: 'billing', label: 'Оплата и тарифы', hint: 'счета, подписка, задолженность, закрывающие документы' },
  { key: 'delivery', label: 'Доставка и курьеры', hint: 'зоны, тарифы доставки, курьеры, время доставки' },
  { key: 'access', label: 'Доступы и пользователи', hint: 'добавить кассира, роли, пароли, вход в систему, боты и группы' },
  { key: 'app', label: 'Приложение и сайт', hint: 'мобильное приложение, сайт заведения, витрина для гостя' },
  { key: 'howto', label: 'Как это сделать', hint: 'вопрос по работе с системой, обучение, инструкция' },
  { key: 'feature_request', label: 'Просят доработку', hint: 'нет нужной возможности, просьба добавить функцию' },
  { key: 'complaint', label: 'Претензия', hint: 'недовольство сервисом, жалоба на качество работы или поддержку' },
  { key: 'other', label: 'Прочее', hint: 'не подходит ни под одну тему' },
]

const KEYS = CASE_TOPICS.map(t => t.key)

const SYSTEM = 'Ты классифицируешь обращения в поддержку платформы доставки для ресторанов. '
  + 'Клиенты пишут по-русски, по-узбекски и по-казахски, часто коротко и без контекста. '
  + 'Отвечай строго JSON-массивом без пояснений.\n\nТемы:\n'
  + CASE_TOPICS.map(t => `${t.key} — ${t.label}: ${t.hint}`).join('\n')

/**
 * Разбор пачкой: одно обращение на строку, ответ — массив тем в том же порядке.
 *
 * Пачкой, а не по одному: у нас сотни необработанных тикетов, и отдельный
 * запрос на каждый — это и деньги, и минуты ожидания.
 */
export async function classifyCases(
  items: Array<{ id: string; text: string }>,
  apiKey: string,
  model = 'gpt-4o-mini',
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!items.length || !apiKey) return out

  const numbered = items
    .map((it, i) => `${i + 1}. ${String(it.text || '').replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Определи тему каждого обращения. Верни JSON вида `
            + `{"items":[{"n":1,"topic":"ключ"}, ...]} — ровно ${items.length} элементов.\n\n${numbered}`,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)

  const data = await res.json()
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  for (const row of parsed.items || []) {
    const idx = Number(row?.n) - 1
    const topic = String(row?.topic || '')
    // Незнакомый ключ — это выдумка модели, а не новая тема: молча записать
    // его значит получить справочник, которого нет в продукте
    if (items[idx] && KEYS.includes(topic)) out.set(items[idx].id, topic)
  }
  return out
}
