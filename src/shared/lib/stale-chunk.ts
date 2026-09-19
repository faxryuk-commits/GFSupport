/**
 * Устаревшая вкладка после выкладки.
 *
 * Сборка режется на чанки с хешем в имени. Вкладка, открытая до выкладки,
 * помнит старые имена; на переходе в «Воронку» браузер просит чанк, которого
 * на сервере уже нет, — 404 и «Что-то пошло не так». В день с десятком
 * выкладок это ломало каждый переход у всей команды.
 *
 * Лечение одно: такую ошибку не показывать, а один раз перезагрузить
 * страницу — свежая сборка знает свои чанки. Один раз — чтобы при настоящей
 * поломке (чанк не отдаётся и после перезагрузки) не крутить цикл: вторая
 * попытка в течение минуты не делается, и ошибка доходит до экрана.
 */

const KEY = 'gfs_chunk_reload_at'
const COOLDOWN_MS = 60_000

const PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Unable to preload CSS/i,
]

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return PATTERNS.some(p => p.test(msg))
}

/** Перезагрузить, если за последнюю минуту этого ещё не делали. */
export function reloadForNewVersion(): boolean {
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch { /* приватный режим */ }
  if (Date.now() - last < COOLDOWN_MS) return false
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* приватный режим */ }
  window.location.reload()
  return true
}

/**
 * Ленивая страница с защитой: если модуль не загрузился из-за выкладки,
 * страница перезагружается, а обещание не разрешается — рендерить нечего,
 * через мгновение вкладка откроется заново. Настоящая ошибка пробрасывается.
 */
export function lazyLoad<T>(loader: () => Promise<T>): () => Promise<T> {
  return () => loader().catch((err: unknown) => {
    if (isStaleChunkError(err) && reloadForNewVersion()) return new Promise<T>(() => {})
    throw err
  })
}
