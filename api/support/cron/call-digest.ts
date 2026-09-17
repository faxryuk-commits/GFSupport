import { getSQL, json } from '../_lib/db.js'
import { assertCron } from '../_lib/cron-auth.js'
import { readPbxConfig } from '../_lib/pbx.js'
import { hasSpeechKey } from '../_lib/speech.js'
import { processCallDigests } from '../_lib/call-digest.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

const ORG = 'org_delever'

/**
 * Разбор записей звонков: расшифровка Chirp → сводка, факты и разбор
 * тренера — одним проходом на разговор (очередь в `_lib/call-digest.ts`).
 *
 * До этого лента показывала «Исходящий звонок · 84 сек» — через неделю по
 * такой записи невозможно вспомнить, о чём говорили. Теперь у каждого
 * разговора есть суть, предложенный следующий шаг, заполненная со слов
 * клиента квалификация и разбор для сейлза.
 */
export default async function handler(req: Request): Promise<Response> {
  const denied = assertCron(req)
  if (denied) return denied

  if (!hasSpeechKey()) {
    return json({ ok: true, skipped: 'GOOGLE_SPEECH_KEY не задан' })
  }

  const sql = getSQL()
  const cfg = await readPbxConfig(sql, ORG)
  if (!cfg) return json({ ok: true, skipped: 'АТС не настроена' })

  const out = await processCallDigests(sql, ORG, cfg)
  return json({ ok: true, ...out })
}
