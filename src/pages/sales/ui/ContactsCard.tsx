import { useCallback, useEffect, useState } from 'react'
import { CallPhone, confirmDialog } from '@/shared/ui'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/services/api.service'
import { Card, Btn, Combo } from './kit'
import { useSalesRefs, optionsFor } from './refs'

/**
 * Контакты клиента с правкой по месту.
 *
 * Раньше контакт был ровно один — заведённый автоматически из телефона
 * заявки. Добавить ЛПР, бухгалтера или почту было нечем, и поля роли и почты
 * в базе не заполнялись вообще ни у кого.
 */

type Contact = {
  id: string; name: string | null; role: string | null; phone: string | null
  telegram: string | null; email: string | null; is_primary: boolean
}

const EMPTY = { name: '', role: '', phone: '', email: '', telegram: '' }

export function ContactsCard({ accountId, market }: { accountId?: string; market?: string | null }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  // Что мессенджеры знают об этих номерах: имя, ник, логотип. Показываем
  // подсказку только там, где в карточке пусто — заполненное не трогаем
  const [known, setKnown] = useState<Record<string, any>>({})
  const [enriching, setEnriching] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  // Правка по месту: телефон в заявке приходит с ошибкой чаще, чем кажется,
  // и заводить второй контакт ради опечатки — плодить дубли
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ ...EMPTY })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refs = useSalesRefs()

  const load = useCallback(() => {
    if (!accountId) return
    apiGet<{ contacts: Contact[] }>(`/sales/contacts?accountId=${accountId}`, false)
      .then(r => setContacts(r.contacts || []))
      .catch(() => {})
  }, [accountId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const missing = contacts.filter(c => c.phone && !known[c.id])
    if (!missing.length) return
    let alive = true
    Promise.all(missing.slice(0, 6).map(c =>
      apiGet<any>(`/sales/channels?phone=${encodeURIComponent(c.phone!)}`, false)
        .then(d => [c.id, d] as const).catch(() => [c.id, null] as const)))
      .then(pairs => {
        if (!alive) return
        setKnown(prev => {
          const next = { ...prev }
          for (const [id, d] of pairs) next[id] = d
          return next
        })
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts])

  const enrich = async (c: Contact, withPhoto: boolean) => {
    if (enriching) return
    setEnriching(c.id)
    try {
      await apiPost('/sales/channels', { action: 'enrich', contactId: c.id, withPhoto })
      load()
    } catch (e: any) { setError(e?.message || 'не получилось') } finally { setEnriching('') }
  }

  const create = async () => {
    if (!form.name.trim() && !form.phone.trim()) return
    setBusy(true); setError(null)
    try {
      await apiPost('/sales/contacts', { accountId, ...form })
      setForm({ ...EMPTY }); setOpen(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось добавить контакт')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c: Contact) => {
    setEditId(c.id)
    setEdit({
      name: c.name || '', role: c.role || '', phone: c.phone || '',
      email: c.email || '', telegram: c.telegram || '',
    })
    setError(null)
  }

  const saveEdit = async () => {
    if (!editId || busy) return
    setBusy(true); setError(null)
    try {
      await apiPatch('/sales/contacts', { id: editId, ...edit })
      setEditId(null)
      load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить контакт')
    } finally { setBusy(false) }
  }

  const makePrimary = async (c: Contact) => {
    try {
      await apiPatch('/sales/contacts', { id: c.id, isPrimary: true })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось назначить основным') }
  }

  const remove = async (c: Contact) => {
    if (!await confirmDialog(`Удалить контакт «${c.name || c.phone}»?`)) return
    try {
      await apiDelete(`/sales/contacts?id=${c.id}`)
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось удалить') }
  }

  if (!accountId) return null

  return (
    <Card dense
      title="Контакты"
      count={contacts.length ? contacts.length : undefined}
      hint="ЛПР, бухгалтер, второй номер. По телефону склеиваются обращения из разных каналов"
      right={
        <Btn size="sm" onClick={() => setOpen(o => !o)}>
          {open ? 'Отмена' : '+ Контакт'}
        </Btn>
      }
    >
      {open && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Имя" className="text-[13px] px-3 py-2 border border-gray-200 rounded-lg
                focus:outline-none focus:border-blue-400" />
            <div>
              <Combo value={form.role} options={optionsFor(refs, 'dm_role', market)}
                onChange={v => setForm(f => ({ ...f, role: v }))} placeholder="Должность" />
            </div>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Телефон" className="text-[13px] px-3 py-2 border border-gray-200 rounded-lg
                focus:outline-none focus:border-blue-400" />
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Почта" className="text-[13px] px-3 py-2 border border-gray-200 rounded-lg
                focus:outline-none focus:border-blue-400" />
          </div>
          <div className="flex items-center gap-2">
            <Btn kind="primary" onClick={create} disabled={busy || (!form.name.trim() && !form.phone.trim())}>
              {busy ? '…' : 'Добавить'}
            </Btn>
            <span className="text-[11px] text-gray-400">хватит имени или телефона</span>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {!contacts.length && !open && (
        <div className="px-4 py-4 text-[12.5px] text-gray-400">
          Контактов нет. Добавьте того, кто принимает решение, — иначе на встрече говорить не с кем.
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {contacts.map(c => {
          // Телефон, введённый в поле имени, — всё равно телефон: старые
          // контакты с таким вводом должны оставаться кликабельными
          const callNum = c.phone
            || (/^[\d\s+()-]{7,20}$/.test(c.name || '') && (c.name || '').replace(/\D/g, '').length >= 7
              ? c.name : null)
          if (editId === c.id) return (
            <div key={c.id} className="px-4 py-3 bg-blue-50/40">
              <div className="flex flex-wrap gap-2">
                <input value={edit.name} onChange={e => setEdit(f => ({ ...f, name: e.target.value }))}
                  placeholder="Имя"
                  className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[120px]" />
                <input value={edit.phone} onChange={e => setEdit(f => ({ ...f, phone: e.target.value }))}
                  placeholder="Телефон"
                  className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[130px]" />
                <div className="flex-1 min-w-[110px] text-[12.5px]">
                  <Combo value={edit.role} onChange={v => setEdit(f => ({ ...f, role: v }))}
                    options={optionsFor(refs, 'contact_role')} placeholder="Роль" />
                </div>
                <input value={edit.telegram} onChange={e => setEdit(f => ({ ...f, telegram: e.target.value }))}
                  placeholder="Telegram"
                  className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[110px]" />
                <input value={edit.email} onChange={e => setEdit(f => ({ ...f, email: e.target.value }))}
                  placeholder="Почта"
                  className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[130px]" />
              </div>
              <div className="flex gap-2 mt-2">
                <Btn kind="primary" onClick={saveEdit} disabled={busy}>Сохранить</Btn>
                <Btn onClick={() => setEditId(null)}>Отмена</Btn>
              </div>
            </div>
          )
          return (
          <div key={c.id} className="px-4 min-h-8 py-1.5 flex items-center justify-between gap-3 group">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              {/* Одна строка на контакт, как у полей: имя · роль · метка. Вторая
                  строка — только когда есть почта или Telegram, а не прочерк */}
              <span className={`text-[12.5px] ${c.name ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                {c.name || 'без имени'}
              </span>
              {c.role && <span className="text-[11.5px] text-gray-500">{c.role}</span>}
              {c.is_primary && (
                <span className="text-[9.5px] font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                  основной
                </span>
              )}
              {(c.email || c.telegram) && (
                <span className="text-[11px] text-gray-400 truncate">{[c.email, c.telegram].filter(Boolean).join(' · ')}</span>
              )}
              {/* Мессенджер знает то, чего нет в карточке — предлагаем перенести */}
              {(() => {
                const k = known[c.id]
                if (!k?.hasTelegram) return null
                // Заглушкой считаем только пустое имя и «Без имени» целиком:
                // любая осмысленная запись — уже чьи-то данные
                const noName = !c.name || /^\s*(без имени|no name|-|—|н\/д)\s*$/i.test(c.name)
                const canName = noName && k.tgName
                const canTg = !c.telegram && k.tgUsername
                if (!canName && !canTg) return null
                return (
                  <button onClick={() => enrich(c, true)} disabled={!!enriching}
                    className="mt-1 text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1.5 disabled:opacity-50">
                    {k.tgPhoto && (
                      <img src={k.tgPhoto} alt="" className="w-4 h-4 rounded object-cover border border-gray-200" />
                    )}
                    <span>
                      {enriching === c.id ? 'Заполняем…' : 'Дополнить из Telegram: '}
                      {enriching !== c.id && [canName ? k.tgName : null, canTg ? '@' + k.tgUsername : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )
              })()}
            </div>
            <div className="flex items-center gap-2 flex-none">
              {callNum && (
                <CallPhone phone={callNum} size="sm" channels className="text-[12px] text-blue-600" />
              )}
              <button onClick={() => startEdit(c)} title="Изменить контакт"
                className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-blue-600">
                изменить
              </button>
              {!c.is_primary && (
                <button onClick={() => makePrimary(c)} title="Сделать основным контактом"
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-blue-600">
                  основной
                </button>
              )}
              <button onClick={() => remove(c)} title="Удалить контакт"
                className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-red-600">
                удалить
              </button>
            </div>
          </div>
          )
        })}
      </div>
    </Card>
  )
}
