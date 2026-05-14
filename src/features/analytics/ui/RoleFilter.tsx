/**
 * Фильтр «по роли сотрудника» — определяет, кого считать «командой».
 *
 * Изначально метрики строились ПО ВСЕМ записям в support_agents — туда
 * попадают CEO, PM, Developer и т.п. (вся компания клиента сидит в одной
 * таблице). Это искажало FRT/SLA, потому что ответ CEO в чате клиента
 * засчитывался как ответ поддержки.
 *
 * Этот компонент даёт переключить scope:
 *   - "Только поддержка" (default) — preset.support из /agent-roles
 *   - "Все роли" — без фильтра
 *   - <конкретная роль> — узкий срез по одной роли
 *
 * Возвращает массив ролей (или null = без фильтра). null/[] = «все роли».
 */

import { useEffect, useState } from 'react'
import { Users, ChevronDown, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchAgentRoles, type AgentRolesResponse } from '@/shared/api'

export type RoleSelection =
  | { kind: 'support' }
  | { kind: 'all' }
  | { kind: 'role'; role: string }

export interface RoleFilterValue {
  selection: RoleSelection
  /** Готовый массив ролей для backend (null = без фильтра). */
  roles: string[] | null
}

interface RoleFilterProps {
  value: RoleFilterValue
  onChange: (v: RoleFilterValue) => void
}

export function RoleFilter({ value, onChange }: RoleFilterProps) {
  const [data, setData] = useState<AgentRolesResponse | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAgentRoles()
      .then((r) => {
        if (cancelled) return
        setData(r)
        // Если value по умолчанию (support), но preset пустой — переключаем на all
        if (value.selection.kind === 'support' && r.presets.support.length === 0) {
          onChange({ selection: { kind: 'all' }, roles: null })
        } else if (value.selection.kind === 'support') {
          // Обновляем roles из свежего preset на случай если он изменился
          onChange({ selection: { kind: 'support' }, roles: r.presets.support })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const supportRoles = data?.presets.support ?? []
  const label =
    value.selection.kind === 'support'
      ? `Только поддержка (${supportRoles.length})`
      : value.selection.kind === 'all'
      ? 'Все роли'
      : value.selection.role

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:border-slate-400"
        title="Какие роли сотрудников считать командой при расчёте метрик"
      >
        <Users className="w-3.5 h-3.5 text-slate-500" />
        {label}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-lg z-20 max-h-[400px] overflow-y-auto">
            <button
              onClick={() => {
                onChange({ selection: { kind: 'support' }, roles: supportRoles })
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                value.selection.kind === 'support' ? 'bg-blue-50 text-blue-900' : ''
              }`}
            >
              <div className="font-medium">Только поддержка</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {supportRoles.length > 0
                  ? `Включает: ${supportRoles.join(', ')}`
                  : 'Нет ролей, попадающих в пресет — переключитесь на «Все»'}
              </div>
            </button>
            <button
              onClick={() => {
                onChange({ selection: { kind: 'all' }, roles: null })
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-t border-slate-100 ${
                value.selection.kind === 'all' ? 'bg-blue-50 text-blue-900' : ''
              }`}
            >
              <div className="font-medium">Все роли</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Без фильтра — каждый, кто отвечал, считается «агентом»
              </div>
            </button>

            <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
              Конкретная роль
            </div>
            {data?.roles.map((r) =>
              r.role ? (
                <button
                  key={r.role}
                  onClick={() => {
                    onChange({
                      selection: { kind: 'role', role: r.role! },
                      roles: [r.role!],
                    })
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center justify-between ${
                    value.selection.kind === 'role' && value.selection.role === r.role
                      ? 'bg-blue-50 text-blue-900'
                      : ''
                  }`}
                >
                  <span>{r.role}</span>
                  <span className="text-[10px] text-slate-400">{r.count}</span>
                </button>
              ) : null,
            )}
            {(data?.roles?.length ?? 0) === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500 italic">
                Список ролей загружается…
              </div>
            )}

            <div className="border-t border-slate-100 p-2">
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-800"
              >
                <Settings className="w-3 h-3" />
                Управлять ролями — Settings → Команда
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function defaultRoleFilter(): RoleFilterValue {
  // Изначально подставляем support — preset пополнится после fetchAgentRoles
  return { selection: { kind: 'support' }, roles: [] }
}
