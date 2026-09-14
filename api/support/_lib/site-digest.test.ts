import { describe, it, expect } from 'vitest'
import { parseSiteDigest } from './site-digest.js'

/**
 * Сводка бота delever.io в том виде, как она пришла 07.09.2026 — с разметкой
 * Telegram. С тегами разбор молча возвращал нули, и «Сайт» в отчётах
 * показывал пустоту три недели.
 */
const DIGEST = `<b>📊 Аналитика delever.io — 07.09.2026</b>

<b>👥 Просмотры:</b> 110 📈 +43%
<b>👤 Уник. посетители:</b> 83
<b>🔄 Сессии:</b> 90
<b>⏱ Медиан. время:</b> 0м 53с
<b>📩 Лидов:</b> 1

<b>🆕 Новые:</b> 90 | <b>🔁 Возвращ.:</b> 20

<b>📱 Устройства:</b> Mobile 30% · Desktop 70%
<b>💻 ОС:</b> macOS 56 · Windows 50 · Android 3 · Linux 1
<b>🌐 Языки:</b> ru 47 · zh 41 · en 20 · uz 2

<b>📄 Топ страниц:</b>
  1. / (Главная) — 46
  2. /guides/wolt-for-restaurants — 8
  3. /en/glossary/b2b-delivery — 8
  4. /en/case-studies/pizza-time — 8
  5. /en/glossary/rfm-analiz — 8
  6. /pricing — 5
  7. /integrations — 4

<b>🎯 Интересы посетителей:</b>
  📝 Блог: 6
  💰 Тарифы: 5
  🚀 Калькулятор запуска: 1
  ✅ Тест готовности: 1

<b>🔗 Источники трафика:</b>
  • Google: 32

<b>🌍 Страны:</b> UZ 45, CN 22, SG 9, US 9, AZ 8

<b>🔥 Вовлечённость (scroll 75%+):</b>
  • / (Главная) — 14
  • /pricing — 3
  • /integrations — 2
  • /partners — 2
  • /thank-you — 1

<b>🧪 A/B тесты:</b>

  <b>Hero: выбор отрасли:</b>
  A (контроль): 1 визитов → 0 конв. (0.0%)
  B (тест): 0 визитов → 0 конв. (0%)

  <b>Калькулятор на главной:</b>
  A (контроль): 1 визитов → 0 конв. (0.0%)
  B (тест): 0 визитов → 0 конв. (0%)

  <b>Smart exit-intent:</b>
  A (контроль): 13 визитов → 0 конв. (0.0%)
  B (тест): 25 визитов → 0 конв. (0.0%)

<i>delever.io analytics</i>`

describe('parseSiteDigest', () => {
  it('разбирает сводку с html-разметкой Telegram', () => {
    const d = parseSiteDigest(DIGEST)
    expect(d.day).toBe('2026-09-07')
    expect(d.views).toBe(110)
    expect(d.uniques).toBe(83)
    expect(d.sessions).toBe(90)
    expect(d.leads).toBe(1)
    expect(d.median_seconds).toBe(53)
    expect(d.new_visitors).toBe(90)
    expect(d.returning_visitors).toBe(20)
    expect(d.devices).toEqual({ Mobile: 30, Desktop: 70 })
    expect(d.countries[0]).toEqual({ code: 'UZ', hits: 45 })
    expect(d.sources).toEqual([{ label: 'Google', hits: 32 }])
    expect(d.top_pages).toHaveLength(7)
  })

  it('имя A/B-теста с двоеточием внутри не превращается в «тест»', () => {
    const d = parseSiteDigest(DIGEST)
    expect(d.ab_tests.map(t => t.name)).toEqual([
      'Hero: выбор отрасли', 'Hero: выбор отрасли',
      'Калькулятор на главной', 'Калькулятор на главной',
      'Smart exit-intent', 'Smart exit-intent',
    ])
    expect(d.ab_tests[5]).toMatchObject({ variant: 'B (тест)', visits: 25, conversions: 0 })
  })
})
