/**
 * Реквизиты сторон и сборка договора из шаблона.
 *
 * Шаблон спрашивает конкретные вещи: юрлицо, банк, счёт, подписанта и на
 * каком основании он подписывает. Пока их негде было хранить, договор
 * приходилось дописывать руками в Word — а значит нумерация, дата и суммы
 * расходились с тем, что стоит в сделке.
 */

/** Дата договора — в рабочей зоне: документ подписывают в Ташкенте. */
function formatDateDMY(d?: Date): string {
  return (d || new Date()).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent',
  })
}

/** Поля реквизитов клиента — один список для формы, проверки и подстановки. */
export const CLIENT_REQUISITE_FIELDS: Array<[string, string]> = [
  ['legal_name', 'Юридическое название'],
  ['tax_code', 'ИНН / БИН'],
  ['legal_address', 'Юридический адрес'],
  ['bank_name', 'Банк'],
  ['bank_code', 'МФО / БИК'],
  ['bank_account', 'Расчётный счёт'],
  ['signer_name', 'Подписант'],
  ['signer_title', 'Должность подписанта'],
  ['signer_basis', 'Действует на основании'],
]

/** Чего не хватает, чтобы договор не вышел с пустыми местами. */
export function missingRequisites(account: any): Array<{ field: string; label: string }> {
  const required = ['legal_name', 'tax_code', 'legal_address', 'signer_name']
  return CLIENT_REQUISITE_FIELDS
    .filter(([f]) => required.includes(f))
    .filter(([f]) => {
      const v = account?.[f]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map(([field, label]) => ({ field, label }))
}

/**
 * Значения для подстановки в шаблон.
 *
 * Пустые места оставляем видимыми — «__________», а не пустоту: подписант
 * должен заметить пробел в реквизитах до подписи, а не после.
 */
export function contractValues(args: {
  deal: any
  account: any
  entity: any
  number: string
  date?: Date
}): Record<string, string> {
  const { deal, account, entity, number } = args
  const blank = '__________'
  const val = (v: any) => (v === null || v === undefined || String(v).trim() === '' ? blank : String(v))
  const money = (v: any) => (v ? Number(v).toLocaleString('ru-RU') : blank)

  return {
    contract_number: number,
    contract_date: formatDateDMY(args.date),
    city: val(deal?.city || account?.city),

    licensor_legal: val(entity?.legal_name || entity?.name),
    licensor_signer: val(entity?.signer_name),
    licensor_basis: val(entity?.signer_basis),
    licensor_signer_title: val(entity?.signer_title),
    licensor_inn: val(entity?.tax_code),
    licensor_address: val(entity?.legal_address),
    licensor_bank: val(entity?.bank_name),
    licensor_mfo: val(entity?.bank_code),
    licensor_account: val(entity?.bank_account),
    // Готовый блок реквизитов, если он заведён строкой; иначе собираем сами,
    // чтобы в договоре не осталось пустого места вместо нашей стороны
    licensor_requisites: entity?.requisites?.trim()
      || [entity?.legal_name, entity?.legal_address,
          entity?.tax_code ? `ИНН: ${entity.tax_code}` : null,
          entity?.bank_name ? `Банк: ${entity.bank_name}` : null,
          entity?.bank_code ? `МФО: ${entity.bank_code}` : null,
          entity?.bank_account ? `Счёт: ${entity.bank_account}` : null,
         ].filter(Boolean).join('\n') || blank,

    client_legal: val(account?.legal_name || account?.name),
    client_inn: val(account?.tax_code || account?.inn),
    client_address: val(account?.legal_address),
    client_bank: val(account?.bank_name),
    client_mfo: val(account?.bank_code),
    client_account: val(account?.bank_account),
    client_signer: val(account?.signer_name),
    client_signer_title: val(account?.signer_title),
    client_basis: val(account?.signer_basis),

    tariff: val(deal?.tariff),
    points: val(deal?.points),
    monthly_amount: money(deal?.monthly_amount),
    onetime_amount: money(deal?.onetime_amount),
    currency: val(deal?.currency),
    term_months: val(deal?.term_months),
    start_date: deal?.start_date ? formatDateDMY(new Date(deal.start_date)) : blank,
    deal_title: val(deal?.title),
  }
}

/**
 * Подстановка в тело шаблона.
 *
 * Незаполненные плейсхолдеры не оставляем как есть: «{{client_bank}}» в
 * подписанном документе выглядит как ошибка системы, а пустая строка — как
 * недосмотр, который видно и можно дописать от руки.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '__________')
}
