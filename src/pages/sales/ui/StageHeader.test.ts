import { describe, it, expect } from 'vitest'
import { compactMoney } from './StageHeader'

/**
 * Сокращение сумм в шапке колонки. Ошибка тут читается как «в воронке
 * денег в десять раз меньше», поэтому проверяем на настоящих числах.
 */
describe('короткая запись суммы', () => {
  it('миллионы сумов', () => {
    expect(compactMoney(7150000)).toBe('7,15 млн')
    expect(compactMoney(85800000)).toBe('85,8 млн')
    expect(compactMoney(497620000)).toBe('498 млн')
    expect(compactMoney(1300000)).toBe('1,3 млн')
  })
  it('тысячи и малые суммы — как есть', () => {
    expect(compactMoney(16860)).toBe('16,9 тыс')
    expect(compactMoney(1405)).toBe('1 405')
    expect(compactMoney(9)).toBe('9')
  })
  it('миллиарды', () => {
    expect(compactMoney(1250000000)).toBe('1,25 млрд')
  })
  it('пусто и ноль — прочерк', () => {
    expect(compactMoney(null)).toBe('—')
    expect(compactMoney(0)).toBe('—')
    expect(compactMoney(undefined)).toBe('—')
  })
})
