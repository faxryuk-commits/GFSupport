import { describe, it, expect } from 'vitest'
import { trafficLight } from './QualCall'

/**
 * Светофор профиля из регламента. Значения ответов взяты из справочника
 * системы как есть: «до 10», «30-50», «50-100», «Нет кассы», «Доставки нет».
 * Ошибка здесь молчит: красный клиент выглядит рабочим и съедает неделю.
 */
describe('светофор профиля клиента', () => {
  it('пока нечего оценивать — серый', () => {
    expect(trafficLight({}, null).tone).toBe('gray')
  })

  it('нет доставки и не планируют — красный', () => {
    const r = trafficLight({ orders_per_day: '50-100', points: '3', delivery_type: 'Доставки нет' }, 'Ташкент')
    expect(r.tone).toBe('red')
    expect(r.contra.join(' ')).toMatch(/доставки нет/)
  })

  it('меньше тридцати заказов — красный по правилу регламента', () => {
    expect(trafficLight({ orders_per_day: 'до 10', points: '1' }, null).tone).toBe('red')
    expect(trafficLight({ orders_per_day: '10-30', points: '2' }, null).tone).toBe('red')
  })

  it('точка, полсотни заказов и касса — зелёный', () => {
    const r = trafficLight({ orders_per_day: '50-100', points: '2', pos: 'IIKO' }, 'Самарканд')
    expect(r.tone).toBe('green')
    expect(r.pro.join(' ')).toMatch(/касса IIKO/)
  })

  it('тридцать-пятьдесят заказов — жёлтый, квалифицировать дальше', () => {
    expect(trafficLight({ orders_per_day: '30-50', points: '1', pos: 'Jowi' }, null).tone).toBe('amber')
  })

  it('без кассы зелёным не станет', () => {
    const r = trafficLight({ orders_per_day: '100-300', points: '4', pos: 'Нет кассы' }, null)
    expect(r.tone).toBe('amber')
    expect(r.contra.join(' ')).toMatch(/кассы нет/)
  })

  it('названная боль идёт в плюс', () => {
    const r = trafficLight({ orders_per_day: '50-100', points: '2', pos: 'IIKO', pain: 'Курьеры не под контролем' }, null)
    expect(r.pro.join(' ')).toMatch(/боль названа/)
  })
})
