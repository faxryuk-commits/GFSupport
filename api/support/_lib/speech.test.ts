import { describe, it, expect } from 'vitest'
import { plausibleFact, firstInt } from './speech.js'

/**
 * Случаи — с боевых разборов звонков 17.09.2026: модель отдаёт «null»
 * строкой, число вместо названия кассы, а «2-3 точки» — текстом, тогда как
 * колонка сделки числовая.
 */
describe('факты из разговора', () => {
  it('«null» и «нет данных» строкой — не факт', () => {
    expect(plausibleFact('pain', 'null')).toBe(false)
    expect(plausibleFact('city', 'нет данных')).toBe(false)
    expect(plausibleFact('pos', '')).toBe(false)
  })
  it('касса — название, не число', () => {
    expect(plausibleFact('pos', '3')).toBe(false)
    expect(plausibleFact('pos', 'iiko')).toBe(true)
  })
  it('точки и заказы — с числом, город — без', () => {
    expect(plausibleFact('points', 'две')).toBe(false)
    expect(plausibleFact('points', '2-3')).toBe(true)
    expect(plausibleFact('orders_per_day', '15-20')).toBe(true)
    expect(plausibleFact('city', 'Ташкент')).toBe(true)
    expect(plausibleFact('city', 'Ташкент 2')).toBe(false)
  })
  it('боль клиента — как сказал, одной фразой', () => {
    expect(plausibleFact('pain', 'проблемы с платежной системой')).toBe(true)
  })
  it('первое число для числовой колонки сделки', () => {
    expect(firstInt('2-3 точки')).toBe(2)
    expect(firstInt('больше 100')).toBe(100)
    expect(firstInt('несколько')).toBeNull()
  })
})
