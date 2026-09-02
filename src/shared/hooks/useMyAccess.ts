import { useEffect, useState } from 'react'
import { apiGet } from '@/shared/services/api.service'
import { modulesFor, type ModuleKey } from '@/shared/lib/modules'

/**
 * Модули текущего сотрудника.
 *
 * Мгновенный ответ — из данных логина в localStorage (роль там есть всегда),
 * точный — одним запросом к /agents с кэшем на десять минут: оттуда
 * приезжают отдел и галочки-исключения. `ready` отличает быстрый ответ от
 * точного: жёсткие действия вроде редиректа ждут точного, чтобы не выкинуть
 * человека из модуля, который ему открыли галочкой.
 */

interface MyAccess { mods: Set<ModuleKey>; ready: boolean }

let cache: { at: number; mods: Set<ModuleKey> } | null = null
let inflight: Promise<Set<ModuleKey> | null> | null = null

function fromLogin(): Set<ModuleKey> {
  try {
    const a = JSON.parse(localStorage.getItem('support_agent') || 'null')
    if (a?.role) return modulesFor(a.role, a.department, a.permissions)
  } catch { /* битый localStorage — считаем, что прав нет данных */ }
  // Данных нет — не прячем ничего: это UI-слой, ложный запрет хуже
  return modulesFor('admin')
}

function fetchAccess(): Promise<Set<ModuleKey> | null> {
  if (inflight) return inflight
  const myId = localStorage.getItem('support_agent_id')
  if (!myId) return Promise.resolve(null)
  inflight = apiGet<{ agents: any[] }>('/agents', true)
    .then(d => {
      const me = (d?.agents || []).find(a => a.id === myId)
      if (!me) return null
      const mods = modulesFor(me.role, me.department, me.permissions)
      cache = { at: Date.now(), mods }
      return mods
    })
    .catch(() => null)
    .finally(() => { inflight = null })
  return inflight
}

export function useMyAccess(): MyAccess {
  const [state, setState] = useState<MyAccess>(() =>
    cache && Date.now() - cache.at < 10 * 60_000
      ? { mods: cache.mods, ready: true }
      : { mods: fromLogin(), ready: false })

  useEffect(() => {
    if (state.ready) return
    let stop = false
    fetchAccess().then(mods => {
      if (!stop && mods) setState({ mods, ready: true })
    })
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
