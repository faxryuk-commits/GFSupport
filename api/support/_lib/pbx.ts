import type { NeonQueryFunction } from '@neondatabase/serverless'

type SQL = NeonQueryFunction<false, false>

/**
 * OnlinePBX — телефония отдела продаж.
 *
 * Команда звонит через АТС pbx27296.onpbx.ru: все звонки с записями до сих
 * пор оседали только в Amo. Здесь — тот же поток в GFSupport: история звонков
 * ложится касаниями на лида, дозвон проставляет первое касание (норматив
 * «15 минут» наконец меряется и звонками, а не только перепиской), кнопка на
 * карточке набирает номер за сейлза.
 *
 * Устройство API OnlinePBX: долгоживущий ключ из личного кабинета меняется
 * на сессионную пару key_id:key запросом auth.json; дальше пара ходит в
 * заголовке x-pbx-authentication. Сессию держим в памяти и в настройках —
 * повторный обмен на каждый запрос был бы лишней дорогой.
 */

const AUTH_TTL_MS = 20 * 60 * 1000

interface PbxSession { keyId: string; key: string; at: number }
let session: PbxSession | null = null

export interface PbxConfig { domain: string; authKey: string }

export async function readPbxConfig(sql: SQL, orgId: string): Promise<PbxConfig | null> {
  const rows = await sql`
    SELECT key, value FROM support_settings
    WHERE org_id = ${orgId} AND key IN ('onlinepbx_domain', 'onlinepbx_api_key')
  ` as any[]
  const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]))
  const domain = String(map.onlinepbx_domain || '').trim()
  const authKey = String(map.onlinepbx_api_key || '').trim()
  if (!domain || !authKey) return null
  return { domain, authKey }
}

async function pbxAuth(cfg: PbxConfig): Promise<PbxSession> {
  if (session && Date.now() - session.at < AUTH_TTL_MS) return session

  const res = await fetch(`https://api.onlinepbx.ru/${cfg.domain}/auth.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth_key: cfg.authKey, new: 'true' }),
    signal: AbortSignal.timeout(10000),
  })
  const data: any = await res.json().catch(() => null)
  if (!res.ok || !data || Number(data.status) !== 1 || !data.data?.key) {
    throw new Error(`OnlinePBX auth: ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  }
  session = { keyId: String(data.data.key_id), key: String(data.data.key), at: Date.now() }
  return session
}

async function pbxPost(cfg: PbxConfig, path: string, params: Record<string, string>): Promise<any> {
  const s = await pbxAuth(cfg)
  const res = await fetch(`https://api.onlinepbx.ru/${cfg.domain}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-pbx-authentication': `${s.keyId}:${s.key}`,
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  })
  const data: any = await res.json().catch(() => null)
  // Протухшая сессия — единственный случай, когда стоит попробовать заново
  if (data && Number(data.status) !== 1 && /auth|key/i.test(String(data.comment || ''))) {
    session = null
    const s2 = await pbxAuth(cfg)
    const res2 = await fetch(`https://api.onlinepbx.ru/${cfg.domain}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-pbx-authentication': `${s2.keyId}:${s2.key}`,
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    })
    return res2.json().catch(() => null)
  }
  return data
}

export interface PbxCall {
  uuid: string
  /** unix-секунды начала */
  startStamp: number
  direction: 'in' | 'out' | 'unknown'
  /** Номер клиента — внешняя нога звонка. */
  clientNumber: string
  /** Внутренний номер сотрудника. */
  ext: string | null
  /** Секунды разговора; 0 = недозвон. */
  talkSec: number
  durationSec: number
  hangupCause: string | null
}

/** Похоже на внутренний номер АТС: короткий, только цифры. */
const isExt = (n: string) => /^\d{2,4}$/.test(n)

/**
 * История звонков за интервал. Формат ответа разбираем оборонительно:
 * закрытая документация не даёт гарантий, а падать из-за лишнего поля нельзя.
 */
export async function pbxHistory(cfg: PbxConfig, fromUnix: number, toUnix: number): Promise<PbxCall[]> {
  const data = await pbxPost(cfg, 'mongo_history/search.json', {
    start_stamp_from: String(fromUnix),
    start_stamp_to: String(toUnix),
  })
  if (!data || Number(data.status) !== 1) {
    throw new Error(`OnlinePBX history: ${JSON.stringify(data).slice(0, 200)}`)
  }
  const rows: any[] = Array.isArray(data.data) ? data.data : []
  const calls: PbxCall[] = []
  for (const r of rows) {
    const caller = String(r.caller_id_number ?? r.caller_id ?? '')
    const dest = String(r.destination_number ?? r.destination ?? '')
    const accountcode = String(r.accountcode ?? '').toLowerCase()
    let direction: PbxCall['direction'] = 'unknown'
    if (accountcode.includes('in')) direction = 'in'
    else if (accountcode.includes('out')) direction = 'out'
    else if (isExt(caller) && !isExt(dest)) direction = 'out'
    else if (!isExt(caller) && isExt(dest)) direction = 'in'
    const clientNumber = direction === 'in' ? caller : dest
    const ext = direction === 'in' ? (isExt(dest) ? dest : null) : (isExt(caller) ? caller : null)
    calls.push({
      uuid: String(r.uuid || r.id || `${r.start_stamp}_${caller}_${dest}`),
      startStamp: Number(r.start_stamp || 0),
      direction,
      clientNumber,
      ext,
      talkSec: Number(r.user_talk_time ?? r.talk_time ?? 0),
      durationSec: Number(r.duration ?? 0),
      hangupCause: r.hangup_cause ? String(r.hangup_cause) : null,
    })
  }
  return calls
}

/**
 * Набрать клиента: АТС сначала звонит сотруднику, потом соединяет.
 * Обе ноги — только цифры: «+998…» АТС отвергает как UNALLOCATED_NUMBER,
 * а плюс неизбежно просачивается из карточек и полей настроек.
 */
export async function pbxCallNow(cfg: PbxConfig, fromExt: string, toNumber: string): Promise<{ ok: boolean; raw: any }> {
  const data = await pbxPost(cfg, 'call/now.json', {
    from: fromExt.replace(/\D/g, ''),
    to: toNumber.replace(/\D/g, ''),
  })
  return { ok: Boolean(data && Number(data.status) === 1), raw: data }
}

/**
 * Ссылка на запись разговора. Для одиночного uuid АТС отдаёт прямой mp3
 * (для интервала — tar-архив, поэтому только точечные запросы). Ссылка
 * подписанная и живёт недолго — запрашивается на каждое прослушивание.
 */
export async function pbxRecordUrl(cfg: PbxConfig, uuid: string): Promise<string | null> {
  const data = await pbxPost(cfg, 'mongo_history/search.json', { uuid, download: '1' })
  const url = data && Number(data.status) === 1 && typeof data.data === 'string' ? data.data : null
  return url && url.startsWith('http') ? url : null
}

/** Диагностика для настройки: живой ли ключ и что отвечает история. */
export async function pbxProbe(cfg: PbxConfig): Promise<any> {
  const now = Math.floor(Date.now() / 1000)
  const data = await pbxPost(cfg, 'mongo_history/search.json', {
    start_stamp_from: String(now - 24 * 3600),
    start_stamp_to: String(now),
  })
  return data
}
