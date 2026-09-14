import { describe, it, expect } from 'vitest'
import { marketByPhoneCity, marketByCountryCode } from './region-detect.js'

/**
 * Случаи — с боевых обращений 14.09.2026: двенадцать заведений Баку с +994
 * ушли в узбекский рынок. Причина была двойная: детектор получал phone_norm
 * (последние девять цифр, код страны отрезан) и читал любые девять цифр как
 * узбекские, а регион доски стоял в приоритете выше страны номера.
 */
describe('страна по номеру', () => {
  it('+994 — Азербайджан, как ни напиши', () => {
    expect(marketByPhoneCity('+994 997 83 66 89', 'Baku')).toBe('az')
    expect(marketByPhoneCity('994558044898', null)).toBe('az')
    expect(marketByPhoneCity('+994709056535', '')).toBe('az')
  })
  it('последние девять цифр азербайджанского номера — не узбекский номер', () => {
    // Так выглядел phone_norm: код страны отрезан. Детектор по полному
    // номеру такого не увидит, а по норме ошибался — проверяем, что
    // строгий определитель на нём молчит
    expect(marketByCountryCode('558044898')).toBeNull()
    expect(marketByCountryCode('997836689')).toBeNull()
  })
  it('строгий определитель знает только код страны', () => {
    expect(marketByCountryCode('+998 90 162 69 69')).toBe('uz')
    expect(marketByCountryCode('+7 707 723 69 69')).toBe('kz')
    expect(marketByCountryCode('8 707 723 69 69')).toBe('kz')
    expect(marketByCountryCode('+994 50 465 17 76')).toBe('az')
    expect(marketByCountryCode('+996 555 123 456')).toBe('kg')
    // Местный узбекский номер без кода — не факт, а догадка: строгий молчит,
    // мягкий отвечает
    expect(marketByCountryCode('90 162 69 69')).toBeNull()
    expect(marketByPhoneCity('901626969', null)).toBe('uz')
  })
  it('город добирает то, чего нет в номере', () => {
    expect(marketByPhoneCity(null, 'baku')).toBe('az')
    expect(marketByPhoneCity('', 'Алматы')).toBe('kz')
    expect(marketByPhoneCity('', 'Kattakurgan')).toBeNull()
  })
})
