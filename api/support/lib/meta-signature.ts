/**
 * Проверка подписи вебхуков Meta.
 *
 * Meta подписывает каждое уведомление секретом приложения и кладёт подпись
 * в заголовок X-Hub-Signature-256. Без этой проверки адрес вебхука —
 * открытая дверь: кто угодно, узнав ссылку, может слать нам поддельные
 * заявки, и они лягут сейлзам в очередь как настоящие.
 *
 * Проверяем строго: нет секрета в переменных — уведомления не принимаем
 * вовсе. Молча доверять неподписанным данным хуже, чем не работать.
 */

/**
 * Сверка подписи с телом запроса. Секрет передаёт вызывающий — он лежит
 * в настройках организации, а не в переменных окружения. Сравнение идёт
 * посимвольно до конца, без раннего выхода: по времени ответа не должно
 * быть видно, насколько подпись близка к правильной.
 */
export async function validMetaSignature(
  rawBody: string, header: string | null, secret: string | null,
): Promise<boolean> {
  if (!secret || !header?.startsWith('sha256=')) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')

  const got = header.slice('sha256='.length)
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}
