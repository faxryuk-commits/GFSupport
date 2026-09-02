import { useRef, useState } from 'react'
import { apiPost } from '@/shared/services/api.service'
import { Btn } from './kit'

/**
 * Импорт лидов из файла: наш простой шаблон или выгрузка в формате amoCRM.
 *
 * Колонки распознаются по заголовкам сами — парсеры лидгена выгружают
 * амо-форматом на 38 колонок, и заставлять переименовывать их вручную
 * значит убить желание пользоваться импортом. Дедуп по телефону делает
 * сервер: повторная загрузка того же файла не плодит дублей.
 */

export interface ParsedRow {
  name: string; phone: string
  city?: string; segment?: string; note?: string; tags?: string
  contactName?: string; contactRole?: string
}

interface HeaderMap {
  name: number[]; phone: number[]; city: number[]; segment: number[]
  note: number[]; tags: number[]; contactName: number[]; contactRole: number[]
  extra: number[]
}

/** Кто есть кто среди колонок — по заголовку, без чувствительности к регистру. */
function mapHeaders(headers: string[]): HeaderMap {
  const m: HeaderMap = {
    name: [], phone: [], city: [], segment: [], note: [], tags: [],
    contactName: [], contactRole: [], extra: [],
  }
  headers.forEach((raw, i) => {
    const h = String(raw || '').trim().toLowerCase()
    if (!h) return
    if (h.includes('телефон') || h.includes('phone')) m.phone.push(i)
    else if (h === 'название' || h === 'название сделки' || h === 'name' || h === 'бренд'
      || h === 'название (компания)' || h === 'компания') m.name.push(i)
    else if (h.includes('полное имя') || h === 'контакт' || h === 'имя') m.contactName.push(i)
    else if (h.includes('должность')) m.contactRole.push(i)
    else if (h === 'город' || h === 'city') m.city.push(i)
    else if (h.includes('тип заведения') || h === 'сегмент' || h === 'категория') m.segment.push(i)
    else if (h.includes('примечание') || h === 'комментарий' || h.includes('заметк')) m.note.push(i)
    else if (h.startsWith('тег')) m.tags.push(i)
    else if (h.includes('адрес') || h.includes('сайт')) m.extra.push(i)
  })
  return m
}

function buildRows(table: any[][]): { rows: ParsedRow[]; unmapped: boolean } {
  if (!table.length) return { rows: [], unmapped: true }
  const map = mapHeaders(table[0].map(String))
  if (!map.phone.length || (!map.name.length && !map.contactName.length)) {
    return { rows: [], unmapped: true }
  }
  const cell = (row: any[], i: number) => String(row[i] ?? '').trim()
  const first = (row: any[], idx: number[]) => {
    for (const i of idx) { const v = cell(row, i); if (v) return v }
    return ''
  }
  const rows: ParsedRow[] = []
  for (const row of table.slice(1)) {
    if (!row || row.every(c => !String(c ?? '').trim())) continue
    const notes = [...map.note, ...map.extra].map(i => cell(row, i)).filter(Boolean)
    let segment = first(row, map.segment)
    // Парсеры кладут категорию в примечание: «Категория: Семейный ресторан»
    if (!segment) {
      const hit = notes.map(n => n.match(/Категория:\s*([^,;·]+)/i)).find(Boolean)
      if (hit) segment = hit[1].trim()
    }
    rows.push({
      name: first(row, map.name) || first(row, map.contactName),
      phone: first(row, map.phone),
      city: first(row, map.city) || undefined,
      segment: segment || undefined,
      note: notes.filter(n => !/^Категория:/i.test(n)).join(' · ').slice(0, 2000) || undefined,
      tags: first(row, map.tags) || undefined,
      contactName: first(row, map.contactName) || undefined,
      contactRole: first(row, map.contactRole) || undefined,
    })
  }
  return { rows, unmapped: false }
}

/** Наш шаблон — простой CSV, который откроет и Excel, и Numbers. */
export function downloadTemplate() {
  const csv = '﻿Название;Телефон;Город;Тип заведения;Комментарий;Теги\n'
    + 'Кафе Анор;+998901234567;Ташкент;Кофейня;говорили на выставке;выставка\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = 'шаблон-импорта-лидов.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

interface Report { created: number; dupes: number; noPhone: number; failed: number }

export function ImportLeadsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = async (f: File | null) => {
    if (!f) return
    setError(null); setRows(null); setReport(null); setFileName(f.name)
    try {
      // Парсер тяжёлый — грузится отдельным куском только здесь
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const table: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
      const parsed = buildRows(table)
      if (parsed.unmapped) {
        setError('Не узнал колонки: нужен столбец с телефоном и с названием. '
          + 'Подойдёт наш шаблон или выгрузка из amoCRM.')
        return
      }
      if (!parsed.rows.length) {
        setError('В файле не нашлось ни одной строки с данными')
        return
      }
      setRows(parsed.rows)
    } catch {
      setError('Файл не прочитался — нужен .xlsx или .csv')
    }
  }

  const run = async () => {
    if (!rows?.length || progress !== null) return
    setProgress(0)
    const total: Report = { created: 0, dupes: 0, noPhone: 0, failed: 0 }
    const CHUNK = 25
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await apiPost<Report & { ok: boolean }>(
          '/sales/leads?action=import', { rows: rows.slice(i, i + CHUNK) })
        total.created += r.created || 0
        total.dupes += r.dupes || 0
        total.noPhone += r.noPhone || 0
        total.failed += r.failed || 0
        setProgress(Math.min(rows.length, i + CHUNK))
      }
      setReport(total)
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Импорт прервался — уже загруженное осталось, повторная загрузка дублей не создаст')
      setProgress(null)
    }
  }

  const withPhone = rows ? rows.filter(r => r.phone.replace(/\D/g, '').length >= 7).length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Импорт лидов</h3>
            <p className="text-[11.5px] text-gray-400 mt-0.5">
              .xlsx или .csv — наш шаблон или выгрузка amoCRM, колонки распознаются сами
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {report ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-[13px] text-emerald-900">
              <div className="font-semibold mb-1">Готово</div>
              <div>Создано лидов: <b>{report.created}</b></div>
              {report.dupes > 0 && <div>Пропущено дублей по телефону: {report.dupes}</div>}
              {report.noPhone > 0 && <div>Без телефона (не импортируются): {report.noPhone}</div>}
              {report.failed > 0 && <div className="text-red-700">Не удалось: {report.failed}</div>}
            </div>
            <p className="text-[11.5px] text-gray-400">
              Все лиды легли в «Новые» с источником «Импорт базы» — раздавайте из общей очереди.
            </p>
            <Btn kind="primary" onClick={onClose}>Закрыть</Btn>
          </div>
        ) : (
          <>
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => pick(e.target.files?.[0] || null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl py-6 text-[13px]
                         text-gray-500 hover:border-blue-400 hover:text-blue-600"
            >
              {fileName ? `Файл: ${fileName} — выбрать другой` : 'Выбрать файл…'}
            </button>

            {error && <div className="text-[12.5px] text-red-600">{error}</div>}

            {rows && (
              <div className="space-y-3">
                <div className="text-[12.5px] text-gray-700">
                  Строк: <b>{rows.length}</b> · с телефоном: <b>{withPhone}</b>
                  {rows.length - withPhone > 0 && (
                    <span className="text-amber-600"> · без телефона: {rows.length - withPhone} (пропустятся)</span>
                  )}
                </div>
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-44 overflow-y-auto">
                  {rows.slice(0, 5).map((r, i) => (
                    <div key={i} className="px-3 py-1.5 text-[12px]">
                      <span className="text-gray-800">{r.name || '—'}</span>
                      <span className="text-gray-400"> · {r.phone || 'без телефона'}</span>
                      {r.segment && <span className="text-gray-400"> · {r.segment}</span>}
                    </div>
                  ))}
                  {rows.length > 5 && (
                    <div className="px-3 py-1.5 text-[11px] text-gray-400">…и ещё {rows.length - 5}</div>
                  )}
                </div>
                {progress !== null && (
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all"
                      style={{ width: `${Math.round((progress / rows.length) * 100)}%` }} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Btn kind="primary" onClick={run} disabled={progress !== null || !withPhone}>
                    {progress !== null ? `Загружаю… ${progress}/${rows.length}` : `Импортировать ${withPhone}`}
                  </Btn>
                  <button onClick={onClose} className="text-[12.5px] text-gray-400 hover:text-gray-700">отмена</button>
                </div>
              </div>
            )}

            {!rows && (
              <button onClick={downloadTemplate}
                className="text-[11.5px] text-blue-600 hover:underline">
                скачать шаблон CSV
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
