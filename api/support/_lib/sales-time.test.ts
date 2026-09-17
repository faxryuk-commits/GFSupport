import { describe, it, expect } from 'vitest'
import { nextWorkMorning, localDate, localHour } from './sales-time.js'

/**
 * Случай из Баку 17.09.2026: задачи вставали на 04:00 UTC — ташкентское
 * утро, в Баку это 08:00, до рабочего дня; а задачи без срока не всплывали
 * нигде. Утро считается по часам страны сотрудника.
 */
describe('рабочее утро по стране', () => {
  it('Баку: завтра 10:00 по Баку = 06:00 UTC', () => {
    const d = nextWorkMorning('az', new Date('2026-09-17T08:00:00Z'))
    expect(d.toISOString()).toBe('2026-09-18T06:00:00.000Z')
  })
  it('Ташкент: завтра 10:00 = 05:00 UTC', () => {
    expect(nextWorkMorning('uz', new Date('2026-09-17T08:00:00Z')).toISOString()).toBe('2026-09-18T05:00:00.000Z')
  })
  it('поздний вечер по стране — всё равно завтра, а не послезавтра', () => {
    // 23:30 по Баку 17.09 = 19:30 UTC → утро 18.09
    expect(nextWorkMorning('az', new Date('2026-09-17T19:30:00Z')).toISOString()).toBe('2026-09-18T06:00:00.000Z')
  })
  it('с субботы задача уходит на понедельник', () => {
    // 19.09.2026 — суббота
    expect(nextWorkMorning('uz', new Date('2026-09-19T08:00:00Z')).toISOString()).toBe('2026-09-21T05:00:00.000Z')
  })
  it('неизвестная страна — по Ташкенту', () => {
    expect(nextWorkMorning(null, new Date('2026-09-17T08:00:00Z')).toISOString()).toBe('2026-09-18T05:00:00.000Z')
  })
  it('дата и час по стране', () => {
    expect(localDate('az', new Date('2026-09-17T21:30:00Z'))).toBe('2026-09-18')
    expect(localHour('az', new Date('2026-09-17T05:00:00Z'))).toBe(9)
    expect(localHour('uz', new Date('2026-09-17T05:00:00Z'))).toBe(10)
  })
})
