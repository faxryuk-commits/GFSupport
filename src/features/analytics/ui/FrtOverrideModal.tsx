import { useEffect, useState } from 'react'
import { Modal } from '@/shared/ui/Modal'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import {
  deleteFrtOverride,
  saveFrtOverride,
  type FrtOverrideType,
  type ResponseTimeDetailRow,
} from '@/shared/api/analytics'

interface Props {
  row: ResponseTimeDetailRow | null
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export function FrtOverrideModal({ row, isOpen, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<FrtOverrideType>('exclude')
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!row) return
    if (row.frtOverride?.type === 'manual') {
      setMode('manual')
      setMinutes(row.frtOverride.frtMinutes != null ? String(row.frtOverride.frtMinutes) : '')
    } else {
      setMode('exclude')
      setMinutes(
        row.computedResponseMinutes != null ? String(row.computedResponseMinutes) : '',
      )
    }
    setNote(row.frtOverride?.note || '')
    setError(null)
  }, [row, isOpen])

  if (!row) return null

  const hasOverride = Boolean(row.frtOverride)

  async function handleSave() {
    if (!row) return
    setSaving(true)
    setError(null)
    try {
      await saveFrtOverride({
        messageId: row.id,
        channelId: row.channelId,
        overrideType: mode,
        frtMinutes: mode === 'manual' ? Number(minutes) : null,
        note: note.trim() || null,
      })
      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!row) return
    setSaving(true)
    setError(null)
    try {
      await deleteFrtOverride(row.id)
      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Корректировка FRT" size="md">
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm">
          <p className="font-medium text-slate-800 truncate">{row.channelName}</p>
          <p className="text-slate-600 mt-1 line-clamp-2">{row.clientMessage || '—'}</p>
          {row.computedResponseMinutes != null && (
            <p className="text-xs text-slate-500 mt-2">
              Авторасчёт: {row.computedResponseMinutes} мин
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Тип корректировки</p>
          <label className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="radio"
              name="frt-mode"
              checked={mode === 'exclude'}
              onChange={() => setMode('exclude')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Не новый запрос</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Подтверждение клиента после решения — исключить из FRT и «без ответа»
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="radio"
              name="frt-mode"
              checked={mode === 'manual'}
              onChange={() => setMode('manual')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Фактическое FRT</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Указать реальное время первого ответа в минутах
              </span>
            </span>
          </label>
        </div>

        {mode === 'manual' && (
          <Input
            label="FRT, минут"
            type="number"
            min={0}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="Например, 5"
          />
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Почему скорректировали (необязательно)"
            className="w-full px-4 py-2 border border-[#e8edf3] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {hasOverride ? (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={saving}>
              Сбросить корректировку
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
