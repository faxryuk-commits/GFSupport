import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Тесты закрывают не «покрытие», а места, где ошибка стоит дорого и молчит:
 * подбор заведения на картах, разбор телефонов, склейка дублей и сборка
 * договора. Всё это чистые функции, поэтому база и сеть не нужны.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
