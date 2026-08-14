/**
 * Разбор телефона по регионам, где мы работаем.
 *
 * Зачем: половина заявок приходит с номером, набранным как попало — с восьмёркой,
 * с пробелами, без кода страны или с чужим кодом. Сейлз звонит, попадает «не
 * туда» и отмечает лид как недозвон. Здесь номер приводится к единому виду,
 * определяется страна и оператор, а мобильный отличается от городского: на
 * городской не напишешь в мессенджер.
 *
 * Коды операторов сверены по публичным планам нумерации на 2026 год. Если
 * оператор неизвестен — говорим об этом прямо, а не выдумываем.
 */

export interface PhoneInfo {
  raw: string
  /** Только цифры в международном виде, без плюса. */
  e164: string
  /** Как показывать человеку: +998 90 123 45 67. */
  pretty: string
  country: string | null
  countryName: string | null
  operator: string | null
  kind: 'mobile' | 'landline' | 'unknown'
  valid: boolean
  problem: string | null
}

interface Plan {
  code: string
  name: string
  /** Длина национального номера без кода страны. */
  nationalLength: number
  mobile: Record<string, string>
  landlinePrefixes: string[]
  group: (n: string) => string
}

const PLANS: Record<string, Plan> = {
  '998': {
    code: 'uz', name: 'Узбекистан', nationalLength: 9,
    mobile: {
      '90': 'Beeline', '91': 'Beeline', '93': 'Ucell', '94': 'Ucell',
      '95': 'Uzmobile', '99': 'Uzmobile', '88': 'Humans', '77': 'Perfectum',
      '97': 'Mobiuz', '98': 'Uzmobile', '33': 'Humans', '20': 'Mobiuz',
    },
    landlinePrefixes: ['71', '72', '73', '74', '75', '76', '78', '79', '61', '62', '65', '66', '67', '69'],
    group: n => `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`,
  },
  '7': {
    code: 'kz', name: 'Казахстан', nationalLength: 10,
    mobile: {
      '700': 'Altel', '701': 'Activ', '702': 'Beeline', '705': 'Beeline',
      '707': 'Tele2', '708': 'Altel', '747': 'Tele2', '771': 'Altel',
      '775': 'Tele2', '776': 'Altel', '777': 'Beeline', '778': 'Altel',
    },
    landlinePrefixes: ['727', '717', '712', '713', '718', '721', '722', '723', '724', '725', '726', '728'],
    group: n => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`,
  },
  '996': {
    code: 'kg', name: 'Кыргызстан', nationalLength: 9,
    mobile: {
      '55': 'MegaCom', '99': 'MegaCom', '77': 'MegaCom',
      '70': 'Beeline', '50': 'Beeline', '22': 'Beeline',
      '51': 'O!', '54': 'O!', '56': 'O!', '57': 'O!',
    },
    landlinePrefixes: ['31', '32', '33', '34', '35', '36', '37', '39'],
    group: n => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`,
  },
  '994': {
    code: 'az', name: 'Азербайджан', nationalLength: 9,
    mobile: { '50': 'Azercell', '51': 'Azercell', '55': 'Bakcell', '99': 'Bakcell', '70': 'Nar', '77': 'Nar' },
    landlinePrefixes: ['12', '18', '20', '21', '22', '23', '24', '25', '26'],
    group: n => `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`,
  },
  '995': {
    code: 'ge', name: 'Грузия', nationalLength: 9,
    mobile: { '55': 'Geocell', '57': 'Geocell', '58': 'Geocell', '59': 'Magti', '5': 'мобильный' },
    landlinePrefixes: ['32', '31', '34', '41', '42', '43'],
    group: n => `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`,
  },
  '357': {
    code: 'cy', name: 'Кипр', nationalLength: 8,
    mobile: { '96': 'Cyta', '97': 'Cyta', '99': 'Cyta', '95': 'Epic', '94': 'Primetel' },
    landlinePrefixes: ['22', '23', '24', '25', '26'],
    group: n => `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`,
  },
  '971': {
    code: 'ae', name: 'ОАЭ', nationalLength: 9,
    mobile: { '50': 'Etisalat', '54': 'du', '55': 'du', '56': 'Etisalat', '52': 'du', '58': 'Etisalat' },
    landlinePrefixes: ['2', '3', '4', '6', '7', '9'],
    group: n => `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`,
  },
}

/** Узбекский номер часто пишут без кода страны или с ведущей 8 — чиним. */
function guessCountry(digits: string): { cc: string; national: string } | null {
  for (const cc of ['998', '996', '995', '994', '971', '357']) {
    if (digits.startsWith(cc)) return { cc, national: digits.slice(cc.length) }
  }
  if (digits.startsWith('7') && digits.length === 11) return { cc: '7', national: digits.slice(1) }
  if (digits.startsWith('8') && digits.length === 11) return { cc: '7', national: digits.slice(1) }
  // Девять цифр без кода — почти всегда Узбекистан: это наш основной рынок
  if (digits.length === 9) return { cc: '998', national: digits }
  return null
}

export function parsePhone(raw: string | null | undefined): PhoneInfo {
  const text = String(raw || '').trim()
  const digits = text.replace(/\D/g, '')
  const empty: PhoneInfo = {
    raw: text, e164: digits, pretty: text, country: null, countryName: null,
    operator: null, kind: 'unknown', valid: false,
    problem: text ? 'номер не распознан' : 'номер не указан',
  }
  if (!digits) return empty

  const guess = guessCountry(digits)
  if (!guess) return { ...empty, problem: 'неизвестный код страны' }

  const plan = PLANS[guess.cc]
  if (!plan) return { ...empty, problem: 'страна вне наших рынков' }

  const national = guess.national
  if (national.length !== plan.nationalLength) {
    return {
      ...empty,
      country: plan.code, countryName: plan.name,
      problem: `в номере ${national.length} цифр вместо ${plan.nationalLength}`,
    }
  }

  // Оператор ищем от длинного префикса к короткому: 777 важнее 77
  let operator: string | null = null
  let kind: PhoneInfo['kind'] = 'unknown'
  for (const len of [3, 2, 1]) {
    const p = national.slice(0, len)
    if (plan.mobile[p]) { operator = plan.mobile[p]; kind = 'mobile'; break }
  }
  if (!operator) {
    for (const p of plan.landlinePrefixes) {
      if (national.startsWith(p)) { kind = 'landline'; operator = 'городской'; break }
    }
  }

  return {
    raw: text,
    e164: `${guess.cc}${national}`,
    pretty: `+${guess.cc} ${plan.group(national)}`.replace(/\s+/g, ' ').trim(),
    country: plan.code,
    countryName: plan.name,
    operator,
    kind,
    valid: true,
    problem: kind === 'unknown' ? 'код оператора не опознан' : null,
  }
}
