import { describe, it, expect } from 'vitest'
import { parsePhone } from './phone'

/**
 * Телефон — вход в звонок и в WhatsApp. Ошибка здесь означает не кривой
 * текст на экране, а несостоявшийся разговор: АТС наберёт не тот номер,
 * а мост не найдёт человека.
 */

describe('разбор телефона', () => {
  it('узбекский мобильный в любом написании даёт один и тот же номер', () => {
    const forms = ['+998 90 123 45 67', '998901234567', '90 123 45 67', '(90) 123-45-67']
    const got = forms.map(f => parsePhone(f, 'uz').e164)
    expect(new Set(got).size).toBe(1)
    expect(got[0]).toBe('998901234567')
  })

  it('восьмёрка в начале не превращается в чужую страну', () => {
    // Набирают «8 90 …» по привычке; если счесть это Россией, звонок уйдёт не туда
    const p = parsePhone('890 123 45 67', 'uz')
    expect(p.country === 'uz' || p.valid === false).toBe(true)
  })

  it('казахстанский номер опознаётся своим рынком', () => {
    const p = parsePhone('+7 701 234 56 78', 'kz')
    expect(p.valid).toBe(true)
    expect(p.country).toBe('kz')
  })

  it('короткий огрызок не считается годным номером', () => {
    const p = parsePhone('12345', 'uz')
    expect(p.valid).toBe(false)
    expect(p.problem).toBeTruthy()
  })

  it('пустое поле объясняется отдельно от нераспознанного', () => {
    expect(parsePhone('', 'uz').problem).toBe('номер не указан')
    expect(parsePhone(null, 'uz').problem).toBe('номер не указан')
  })

  it('человеку показываем номер с пробелами, машине — без', () => {
    const p = parsePhone('998901234567', 'uz')
    expect(p.pretty).toMatch(/\s/)
    expect(p.e164).toMatch(/^\d+$/)
  })

  it('городской и мобильный различаются', () => {
    const mobile = parsePhone('+998 90 123 45 67', 'uz')
    const landline = parsePhone('+998 71 205 11 11', 'uz')
    expect(mobile.kind).toBe('mobile')
    expect(landline.kind).toBe('landline')
  })
})
