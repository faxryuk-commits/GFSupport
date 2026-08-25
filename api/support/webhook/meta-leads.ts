import { getSQL, json } from '../lib/db.js'
import { ensureSalesSchema } from '../lib/sales-schema.js'
import { acceptLead, findRecentTwin } from '../lib/sales-intake.js'
import { marketByPhoneCity } from '../lib/region-detect.js'
import { validMetaSignature } from '../lib/meta-signature.js'
import { readMetaConfig, ensureMetaSchema, marketFromFormName } from '../lib/meta-config.js'

export const config = { runtime: 'edge' }

/**
 * Заявки лид-форм Meta напрямую от Meta, минуя AmoCRM.
 *
 * Это главный блокер ухода с Amo: сегодня заявки с рекламы приходят ТОЛЬКО
 * через «Неразобранное» в Amo, и отключение моста оборвало бы весь поток.
 * Здесь тот же вход, что у сайта и директа, — общий приёмник лидов.
 *
 * GET  — проверка вебхука Meta (hub.challenge)
 * POST — уведомление leadgen: приходит только идентификатор заявки,
 *        содержимое догружаем отдельным запросом
 *
 * Что доезжает здесь и не доезжало через Amo: ad_id, campaign_id и adset_id.
 * Через Amo приходил только тег формы, поэтому разбивки по кампаниям не было.
 *
 * Доступы берутся из настроек организации (карточка «Instagram и Facebook»
 * в интеграциях), переменные окружения остаются запасным путём.
 */

const ORG = process.env.SALES_ORG || 'org_delever'
const SOURCE = 'meta_leadform'

/** Имена полей Meta для того, что мы храним отдельными колонками. */
const NAME_KEYS = ['full_name', 'first_name', 'имя', 'ism']
const PHONE_KEYS = ['phone_number', 'phone', 'телефон']
const EMAIL_KEYS = ['email', 'почта']
const CITY_KEYS = ['city', 'город', 'shahar']

const pick = (map: Map<string, string>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = map.get(k)
    if (v) return v
  }
  return null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const token = url.searchParams.get('hub.verify_token')
    const cfg = await readMetaConfig(ORG)
    const expected = cfg.verifyToken
    if (url.searchParams.get('hub.mode') === 'subscribe' && token && expected && token === expected) {
      return new Response(url.searchParams.get('hub.challenge') || '', {
        status: 200, headers: { 'Content-Type': 'text/plain' },
      })
    }
    return new Response('forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return json({ ok: true })

  // Подпись проверяем до разбора тела: без неё адрес вебхука — открытая
  // дверь, и кто угодно, узнав ссылку, положит сейлзам в очередь поддельные
  // заявки. Нет секрета в переменных — не принимаем вовсе
  const cfg = await readMetaConfig(ORG)
  const raw = await req.text()
  if (!(await validMetaSignature(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret))) {
    console.error('[meta-leads] подпись не сошлась или не задан секрет приложения')
    return new Response('forbidden', { status: 403 })
  }

  // Дальше Meta ждёт 200 в любом случае: наша ошибка не должна приводить
  // к повторной доставке и отключению подписки на стороне Meta
  try {
    const body: any = JSON.parse(raw)
    if (body?.object !== 'page') return json({ ok: true })

    const token = cfg.pageToken
    if (!token) {
      console.error('[meta-leads] нет токена страницы — заявка не разобрана')
      return json({ ok: true })
    }

    const sql = getSQL()
    await ensureSalesSchema(sql, ORG)
    await ensureMetaSchema(sql)

    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        if (ch.field !== 'leadgen') continue
        const v = ch.value || {}
        const leadgenId = String(v.leadgen_id || '')
        if (!leadgenId) continue

        // Уведомление содержит только идентификатор: ответы человека лежат
        // отдельно и живут ограниченное время, поэтому забираем сразу
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${token}`)
        if (!res.ok) {
          console.error('[meta-leads] Meta не отдала заявку', leadgenId, res.status)
          continue
        }
        const lead: any = await res.json()

        const fields = new Map<string, string>()
        for (const f of lead.field_data || []) {
          const key = String(f?.name || '').toLowerCase()
          const val = Array.isArray(f?.values) ? String(f.values[0] ?? '') : ''
          if (key && val) fields.set(key, val)
        }

        const phone = pick(fields, PHONE_KEYS)
        const name = pick(fields, NAME_KEYS)
        const city = pick(fields, CITY_KEYS)

        // Пока Amo ещё работает, та же заявка приедет и оттуда. Второй
        // экземпляр карточку не создаёт — иначе у сейлза два одинаковых
        // обращения на каждую заявку с рекламы
        const twin = await findRecentTwin(sql, ORG, phone, ['meta_leadform', 'unknown'])
        if (twin) {
          await sql`
            UPDATE sales_leads
            SET raw = COALESCE(raw, '{}'::jsonb) || ${JSON.stringify({ _meta_leadgen_id: leadgenId })}::jsonb,
                ad_id = COALESCE(${v.ad_id ? String(v.ad_id) : null}, ad_id),
                utm_campaign = COALESCE(${v.campaign_id ? String(v.campaign_id) : null}, utm_campaign),
                updated_at = NOW()
            WHERE id = ${twin.id} AND org_id = ${ORG}
          `
          continue
        }

        // Ответы на вопросы формы — самое содержательное, что о человеке
        // известно до первого разговора: кладём их в текст обращения целиком.
        // То, что уже разложено по своим полям, во второй раз не повторяем
        const known = [...NAME_KEYS, ...PHONE_KEYS, ...EMAIL_KEYS, ...CITY_KEYS]
        const answers = [...fields.entries()]
          .filter(([k]) => !known.includes(k))
          .map(([k, val]) => `${k}: ${val}`)
          .join('\n')

        // Регион заявки. Порядок намеренный: назначенное форме руками
        // выигрывает всегда, дальше идёт подсказка из названия формы
        // («KZ FORM» — это Казахстан), и только потом догадка по телефону
        // и городу. Если не сошлось нигде — регион остаётся пустым и это
        // видно в карточке, а не подменяется наугад
        const formId = v.form_id ? String(v.form_id) : null
        const [formRow] = formId
          ? await sql`
              SELECT market_id, suggested_market FROM support_meta_forms
              WHERE org_id = ${ORG} AND form_id = ${formId} LIMIT 1
            ` as any[]
          : []
        const market = formRow?.market_id || formRow?.suggested_market
          || marketByPhoneCity(phone, city) || null

        // Форму, которой мы ещё не видели, заводим сразу: она появится
        // в настройках с пометкой «регион не назначен», а не потеряется
        if (formId) {
          await sql`
            INSERT INTO support_meta_forms (org_id, form_id, name, page_id, suggested_market,
                                            leads_count, last_lead_at, seen_at)
            VALUES (${ORG}, ${formId}, ${lead.form_name || null}, ${cfg.pageId},
                    ${marketFromFormName(lead.form_name)}, 1, NOW(), NOW())
            ON CONFLICT (org_id, form_id) DO UPDATE SET
              leads_count = support_meta_forms.leads_count + 1,
              last_lead_at = NOW()
          `
        }

        const accepted = await acceptLead(sql, ORG, {
          source: SOURCE,
          external_id: `meta_${leadgenId}`,
          lead_kind: 'form',
          name: name || null,
          contact_name: name || null,
          phone,
          city,
          market,
          text: answers || null,
          form_id: v.form_id ? String(v.form_id) : null,
          // Через Amo это не доезжало — приходил только тег формы, и разбивки
          // по кампаниям в отчётах не было вовсе
          ad_id: v.ad_id ? String(v.ad_id) : null,
          campaign: v.campaign_id ? String(v.campaign_id) : null,
          utm_source: 'meta',
          utm_medium: 'lead_form',
          utm_campaign: v.campaign_id ? String(v.campaign_id) : null,
          utm_content: v.adgroup_id ? String(v.adgroup_id) : null,
          raw: { ...lead, _leadgen: v },
        })

        // Почта с формы — единственное место, откуда она вообще попадает
        // в систему: ни один другой вход её не приносит, и поле у контактов
        // стояло пустым у всех
        const email = pick(fields, EMAIL_KEYS)
        if (email && accepted.ok && accepted.account_id) {
          await sql`
            UPDATE sales_contacts SET email = COALESCE(email, ${email})
            WHERE org_id = ${ORG} AND account_id = ${accepted.account_id} AND is_primary = true
          `
        }
      }
    }
  } catch (e) {
    console.error('[meta-leads] error:', e)
  }

  return json({ ok: true })
}
