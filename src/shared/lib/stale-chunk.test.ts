import { describe, it, expect } from 'vitest'
import { isStaleChunkError } from './stale-chunk'

// Тексты — как их пишут браузеры: Chrome, Safari, Firefox и Vite
describe('isStaleChunkError', () => {
  it('узнаёт недогруженный чанк после выкладки', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://www.gfsupport.uz/assets/SalesFunnelPage-a1b2c3.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/index-abc.css'))).toBe(true)
    expect(isStaleChunkError(new Error('Loading chunk 12 failed.'))).toBe(true)
  })

  it('настоящую ошибку кода за выкладку не принимает', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isStaleChunkError(new Error('unauthorized'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })
})
