import { describe, it, expect } from 'vitest'
import { missingRequisites, renderTemplate } from './sales-requisites.js'

/**
 * Договор уходит клиенту на подпись. Ошибка тут стоит не пересборки экрана,
 * а переподписания документа, поэтому проверяем ровно два обещания: система
 * заранее говорит, чего не хватает, и не оставляет в документе следов шаблона.
 */

describe('нехватка реквизитов', () => {
  it('пустой клиент — весь обязательный список', () => {
    const miss = missingRequisites({})
    expect(miss.map(m => m.field).sort())
      .toEqual(['legal_address', 'legal_name', 'signer_name', 'tax_code'])
  })

  it('пробелы не считаются заполненным полем', () => {
    const miss = missingRequisites({
      legal_name: '   ', tax_code: '123456789',
      legal_address: 'Ташкент', signer_name: 'Иванов',
    })
    expect(miss.map(m => m.field)).toEqual(['legal_name'])
  })

  it('заполненный клиент не мешает выпускать договор', () => {
    expect(missingRequisites({
      legal_name: 'ООО Вкусно', tax_code: '305123456',
      legal_address: 'Ташкент, Амира Темура 1', signer_name: 'Иванов И.И.',
    })).toEqual([])
  })

  it('у каждой нехватки есть человеческое название', () => {
    for (const m of missingRequisites({})) expect(m.label).toBeTruthy()
  })
})

describe('сборка договора из шаблона', () => {
  it('подставляет значения', () => {
    expect(renderTemplate('Клиент: {{client_name}}', { client_name: 'ООО Вкусно' }))
      .toBe('Клиент: ООО Вкусно')
  })

  it('незаполненное превращается в видимый пропуск, а не в «{{…}}»', () => {
    // Подписант должен заметить дыру до подписи, а не после
    const out = renderTemplate('Банк: {{client_bank}}', {})
    expect(out).not.toMatch(/\{\{/)
    expect(out).toContain('___')
  })

  it('подставляет одно и то же поле в нескольких местах', () => {
    const out = renderTemplate('{{n}} и ещё раз {{n}}', { n: 'Вкусно' })
    expect(out).toBe('Вкусно и ещё раз Вкусно')
  })

  it('пустая строка тоже показывается пропуском, а не исчезает молча', () => {
    const out = renderTemplate('ИНН: {{tax}}', { tax: '' })
    expect(out).toBe('ИНН: ')
  })
})
