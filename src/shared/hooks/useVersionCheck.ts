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
  const fetchVersion = useCallback(async (): Promise<VersionInfo | null> => {
    try {
      // Метка времени в адресе: иначе браузер отдаёт свой старый файл и
      // обновление никогда не замечается
      const response = await fetch(`/releases.json?t=${Date.now()}`)
      if (!response.ok) return null
      const list: VersionInfo[] = await response.json()
      if (!Array.isArray(list) || !list.length) return null
      setHistory(list)
      // Первый в списке — текущий выпуск: файл ведётся сверху вниз
      return list[0]
    } catch {
      return null
    }
  }, [])

  // Проверка версии
  const checkVersion = useCallback(async () => {
    const versionInfo = await fetchVersion()
    if (!versionInfo) return

    // Первая загрузка - сохраняем текущую версию
    if (!currentVersion) {
      setCurrentVersion(versionInfo.version)
      return
    }

    // Сравниваем версии
    if (versionInfo.version !== currentVersion && !dismissed) {
      setNewVersion(versionInfo.version)
      setInfo(versionInfo)
      setHasUpdate(true)
    }
  }, [currentVersion, dismissed, fetchVersion])

  // Обновить страницу
  const refresh = useCallback(() => {
    window.location.reload()
  }, [])

  // Отложить обновление
  const dismiss = useCallback(() => {
    setDismissed(true)
    setHasUpdate(false)
  }, [])

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
    refresh,
    dismiss,
    checkVersion
  }
}
