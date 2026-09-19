/**
 * Поля Meta-формы → карточка обращения.
 *
 * Ключи — как их называют в формах на трёх языках. Сравнение идёт по
 * нормализованному ключу: без «?», с одним видом апострофа (в узбекских
 * формах встречаются ' ‘ ’ ʻ), так что «restoraningiz_no‘mi?» и
 * «restoraningiz_no'mi» — один ключ.
 *
 * Заведение — заголовок карточки. Без этого обращение называлось человеком,
 * хотя ресторан в форме был: «restoraningiz_no'mi?: Super Gold».
 */
export const NAME_KEYS = ['full_name', 'first_name', 'имя', 'полное_имя', 'ism', 'ism-familiyangizni_kiriting', 'ismingiz']
export const PHONE_KEYS = ['phone_number', 'phone', 'телефон', 'номер_телефона', 'ваш_номер_телефона', 'telefon_raqamingiz', 'telefon']
export const EMAIL_KEYS = ['email', 'почта', 'эл._адрес']
export const CITY_KEYS = ['city', 'город', 'shahar', 'qaysi_shahardansiz']
export const VENUE_KEYS = ['restoraningiz_no\'mi', 'restoran_nomi', 'biznesingiz_nomi', 'company_name', 'business_name', 'restaurant_name',
  'название_компании', 'название_заведения', 'название_ресторана', 'заведение', 'компания', 'nomi', 'название']

export const normKey = (k: string) =>
  k.toLowerCase().replace(/[‘’ʻ`´]/g, '\'').replace(/\s+/g, '_').replace(/[?:]+$/g, '').trim()

export const pick = (map: Map<string, string>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = map.get(normKey(k))
    if (v) return v
  }
  return null
}

/** Заглушки инструмента проверки Meta: «<test lead: dummy data for …>». */
export const DUMMY = /^<test lead:/i

/** «....», «-», «нет» — отписки, заведением не считаются. */
export function venueOf(fields: Map<string, string>): string | null {
  const raw = pick(fields, VENUE_KEYS)
  if (!raw) return null
  const v = raw.trim()
  if (!/[\p{L}\d]{2,}/u.test(v) || /^(нет|yo'q|yoq|no|none|-)$/i.test(v)) return null
  return v.slice(0, 200)
}

/** Ответы формы по нормализованным ключам; тестовая заглушка помечает заявку. */
export function fieldsOf(fieldData: any[]): { fields: Map<string, string>; isTest: boolean } {
  let isTest = false
  const fields = new Map<string, string>()
  for (const f of fieldData || []) {
    const key = normKey(String(f?.name || ''))
    const rawVal = Array.isArray(f?.values) ? String(f.values[0] ?? '') : ''
    if (DUMMY.test(rawVal)) { isTest = true; continue }
    if (key && rawVal) fields.set(key, rawVal)
  }
  return { fields, isTest }
}
