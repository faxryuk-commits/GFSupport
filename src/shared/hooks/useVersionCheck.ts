import { useState, useEffect, useCallback } from 'react'

export interface ReleaseNote {
  icon?: string
  title: string
  text?: string
}

export interface VersionInfo {
  version: string
  date?: string
  buildTime?: string
  /** Что изменилось — показываем прямо в окне обновления. */
  title?: string
  notes?: ReleaseNote[]
}

/** Какой выпуск человек уже видел — чтобы не пересказывать его каждую выкладку. */
const SEEN_KEY = 'gfs_seen_release'

interface UseVersionCheckOptions {
  checkInterval?: number // интервал проверки в мс (по умолчанию 60 секунд)
  enabled?: boolean
}

export function useVersionCheck(options: UseVersionCheckOptions = {}) {
  const { checkInterval = 60000, enabled = true } = options
  
  const [hasUpdate, setHasUpdate] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  // Держим весь ответ, а не только номер: из него берутся заголовок выпуска
  // и список изменений — иначе окно сообщает «новые функции» и молчит о том,
  // какие именно
  const [info, setInfo] = useState<VersionInfo | null>(null)
  // Всю историю держим рядом: она же питает страницу «Что нового», и
  // отдельным файлом две копии состава выпуска разъехались бы на первой же
  // выкладке
  const [history, setHistory] = useState<VersionInfo[]>([])
  const [dismissed, setDismissed] = useState(false)

  // Получить версию приложения
  /**
   * Сигнал и содержание — разные файлы, и это намеренно.
   *
   * version.json собирается заново на каждой выкладке и меняет номер: по нему
   * видно, что вкладка устарела. releases.json ведётся руками и меняется
   * только когда есть о чём рассказать. Если слушать один releases.json,
   * баннер молчал бы на всех выкладках без новых возможностей; если один version.json —
   * не о чем было бы рассказывать.
   */
  const fetchVersion = useCallback(async (): Promise<string | null> => {
    try {
      // Метка времени в адресе: иначе браузер отдаёт свой старый файл и
      // обновление никогда не замечается
      const res = await fetch(`/version.json?t=${Date.now()}`)
      if (!res.ok) return null
      const info = await res.json()
      return info?.version ? String(info.version) : null
    } catch {
      return null
    }
  }, [])

  const fetchReleases = useCallback(async (): Promise<VersionInfo[]> => {
    try {
      const res = await fetch(`/releases.json?t=${Date.now()}`)
      if (!res.ok) return []
      const list = await res.json()
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }, [])

  // Проверка версии
  const checkVersion = useCallback(async () => {
    const version = await fetchVersion()
    if (!version) return

    // Первая загрузка — запоминаем, что сейчас, и заодно тянем историю:
    // она нужна и странице «Что нового», где никакого обновления не ждут
    if (!currentVersion) {
      setCurrentVersion(version)
      const list = await fetchReleases()
      setHistory(list)
      setInfo(list[0] || null)
      return
    }

    if (version !== currentVersion && !dismissed) {
      const list = await fetchReleases()
      setHistory(list)
      // Состав показываем только если выпуск новый. Сборка пересобирается на
      // каждой выкладке, и без этой проверки один и тот же список изменений
      // всплывал по десять раз за день — его переставали читать
      const latest = list[0] || null
      const seen = localStorage.getItem(SEEN_KEY)
      setInfo(latest && latest.version !== seen ? latest : null)
      setNewVersion(version)
      setHasUpdate(true)
    }
  }, [currentVersion, dismissed, fetchVersion, fetchReleases])

  // Отложить обновление. Запоминаем прочитанный выпуск: закрыл — значит
  // ознакомился, и второй раз тот же список показывать незачем
  const dismiss = useCallback(() => {
    if (info?.version) {
      try { localStorage.setItem(SEEN_KEY, info.version) } catch { /* приватный режим */ }
    }
    setDismissed(true)
    setHasUpdate(false)
  }, [info])

  // Обновление страницы — тоже знакомство с выпуском
  const refreshAndRemember = useCallback(() => {
    if (info?.version) {
      try { localStorage.setItem(SEEN_KEY, info.version) } catch { /* приватный режим */ }
    }
    window.location.reload()
  }, [info])

  // Периодическая проверка версии
  useEffect(() => {
    if (!enabled) return

    // Первичная проверка
    checkVersion()

    // Периодическая проверка
    const interval = setInterval(checkVersion, checkInterval)

    // Также проверяем при возвращении на вкладку
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, checkInterval, checkVersion])

  return {
    hasUpdate,
    currentVersion,
    newVersion,
    info,
    history,
    refresh: refreshAndRemember,
    dismiss,
    checkVersion
  }
}
