import { describe, it, expect } from 'vitest'
import { fieldsOf, pick, venueOf, normKey, NAME_KEYS, PHONE_KEYS } from './meta-form-fields'

// Случаи — с боевых заявок: узбекская форма с апострофом в ключе,
// казахская с русскими ключами и company_name, отписка «....»
const uzForm = [
  { name: 'full_name', values: ['Olimkhon'] },
  { name: 'phone_number', values: ['+998910225000'] },
  { name: "restoraningiz_no'mi?", values: ['Super Gold'] },
  { name: 'telefon_raqamingiz?', values: ['+998910225000'] },
]
const uzCurly = [
  { name: 'full_name', values: ['Akromov Rixsiboy'] },
  { name: 'restoraningiz_no‘mi?', values: ['Hot snack'] },
]
const kzForm = [
  { name: 'полное_имя', values: ['Fakhriddin Yusupov'] },
  { name: 'название_компании', values: ['Delever'] },
  { name: 'номер_телефона', values: ['+998973436397'] },
]
const kzEn = [
  { name: 'full_name', values: ['Askar'] },
  { name: 'phone_number', values: ['+77787377251'] },
  { name: 'ваш_номер_телефона?', values: ['87787377251'] },
  { name: "restoraningiz_no'mi?", values: ['Lavash food'] },
]

describe('meta-form-fields', () => {
  it('нормализует ключ: регистр, апострофы, хвостовой «?»', () => {
    expect(normKey("Restoraningiz_no‘mi?")).toBe("restoraningiz_no'mi")
    expect(normKey('ваш_номер_телефона?')).toBe('ваш_номер_телефона')
  })

  it('узбекская форма: заведение из restoraningiz_no\'mi, человек — из full_name', () => {
    const { fields, isTest } = fieldsOf(uzForm)
    expect(isTest).toBe(false)
    expect(venueOf(fields)).toBe('Super Gold')
    expect(pick(fields, NAME_KEYS)).toBe('Olimkhon')
    expect(pick(fields, PHONE_KEYS)).toBe('+998910225000')
  })

  it('фигурный апостроф в ключе — тот же ключ', () => {
    expect(venueOf(fieldsOf(uzCurly).fields)).toBe('Hot snack')
  })

  it('казахская форма с русскими ключами', () => {
    const { fields } = fieldsOf(kzForm)
    expect(venueOf(fields)).toBe('Delever')
    expect(pick(fields, NAME_KEYS)).toBe('Fakhriddin Yusupov')
    expect(pick(fields, PHONE_KEYS)).toBe('+998973436397')
  })

  it('два телефона: международный из phone_number важнее локального', () => {
    const { fields } = fieldsOf(kzEn)
    expect(pick(fields, PHONE_KEYS)).toBe('+77787377251')
    expect(venueOf(fields)).toBe('Lavash food')
  })

  it('отписка вместо названия — заведения нет', () => {
    expect(venueOf(fieldsOf([{ name: "restoraningiz_no'mi?", values: ['....'] }]).fields)).toBeNull()
    expect(venueOf(fieldsOf([{ name: 'company_name', values: ['-'] }]).fields)).toBeNull()
    expect(venueOf(fieldsOf([{ name: 'biznesingiz_nomi', values: ["yo'q"] }]).fields)).toBeNull()
  })

  it('заглушка проверки Meta помечает заявку тестовой и не попадает в поля', () => {
    const { fields, isTest } = fieldsOf([
      { name: 'company_name', values: ['<test lead: dummy data for company_name>'] },
      { name: 'full_name', values: ['Test'] },
    ])
    expect(isTest).toBe(true)
    expect(venueOf(fields)).toBeNull()
  })
})
