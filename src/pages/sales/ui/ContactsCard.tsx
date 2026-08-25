import { useCallback, useEffect, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
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

  const makePrimary = async (c: Contact) => {
    try {
      await apiPatch('/sales/contacts', { id: c.id, isPrimary: true })
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось назначить основным') }
  }

  const remove = async (c: Contact) => {
    if (!confirm(`Удалить контакт «${c.name || c.phone}»?`)) return
    try {
      await apiDelete(`/sales/contacts?id=${c.id}`)
      load()
    } catch (e: any) { setError(e?.message || 'Не удалось удалить') }
  }

  if (!accountId) return null

  return (
    <Card
      title="Контакты"
      sub="по телефону идёт склейка обращений из разных каналов"
      right={
        <Btn kind={open ? 'ghost' : 'primary'} onClick={() => setOpen(o => !o)}>
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
        {contacts.map(c => (
          <div key={c.id} className="px-4 py-2.5 flex items-start justify-between gap-3 group">
            <div className="min-w-0">
              <div className="text-[12.5px] text-gray-900 flex items-center gap-1.5">
                {c.name || 'Без имени'}
                {c.is_primary && (
                  <span className="text-[9.5px] font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                    основной
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400">
                {[c.role, c.email, c.telegram].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              {c.phone && (
                <a href={`tel:${c.phone}`} className="text-[12px] text-blue-600 hover:underline tabular-nums">
                  {c.phone}
                </a>
              )}
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
        ))}
      </div>
    </Card>
  )
}
