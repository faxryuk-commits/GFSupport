import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiGet, apiPost } from '@/shared/services/api.service'
import { Card, Chip, PageShell, Skeleton } from '@/pages/sales/ui/kit'

/**
 * Наём: доска кандидатов, карточка со скорингом и расшифровкой, вакансии.
 *
 * ИИ ранжирует, человек решает: отказ, резерв и оффер — только ручные кнопки.
 * Пока вакансия в «тени», порог ничего не значит — оценки собираются для
 * калибровки на первых кандидатах.
 */

const STAGE_LABELS: Record<string, string> = {
  applied: 'Отклик', interview: 'Интервью', scored: 'Рекомендация',
  invited: 'Собеседование', interviewed: 'После собеса', offer: 'Оффер',
  rejected: 'Отказ', reserve: 'Резерв',
}
const BOARD_STAGES = ['applied', 'interview', 'scored', 'invited', 'offer']

const gradeColor: Record<string, string> = {
  A: 'bg-emerald-600', B: 'bg-blue-600', C: 'bg-amber-500', D: 'bg-red-500',
}
const fmtAgo = (iso: string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'только что'
  if (h < 24) return `${h} ч назад`
  return `${Math.round(h / 24)} дн назад`
}

function GradeChip({ grade }: { grade: string | null }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-[12.5px] font-bold ${
      grade ? gradeColor[grade] || 'bg-gray-400' : 'bg-gray-300'}`}>
      {grade || '–'}
    </span>
  )
}

/* ───────────── Карточка кандидата ───────────── */

function CandidateCard({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null)
  const [invite, setInvite] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<any>({})

  const load = useCallback(() => {
    apiGet<any>(`/hiring?action=candidate&id=${id}`, false).then(setData).catch(() => {})
  }, [id])
  useEffect(() => { setData(null); setInvite(null); load() }, [load])

  // Отказ и резерв закрывают карточку — работа с кандидатом окончена;
  // «на собеседование» оставляет её открытой: дальше нужен текст приглашения
  const move = async (stage: string) => {
    if (busy) return
    setBusy(true)
    try {
      await apiPost('/hiring', { action: 'stage', id, stage })
      onChanged()
      if (stage === 'rejected' || stage === 'reserve') onClose()
      else load()
    } catch (e: any) { alert(e?.message || 'Не получилось') } finally { setBusy(false) }
  }
  const loadInvite = () => apiGet<any>(`/hiring?action=invite&id=${id}`, false).then(setInvite).catch(() => {})

  const saveEdit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await apiPost('/hiring', { action: 'candidate_update', id, ...edit })
      setEditing(false); load(); onChanged()
    } catch (e: any) { alert(e?.message || 'Не сохранилось') } finally { setBusy(false) }
  }

  const removeCandidate = async () => {
    if (!confirm('Удалить кандидата целиком, вместе с интервью? Это для тестов и спама — настоящим кандидатам место в «Отказе».')) return
    try {
      await apiPost('/hiring', { action: 'candidate_delete', id })
      onChanged(); onClose()
    } catch (e: any) { alert(e?.message || 'Не удалилось') }
  }

  if (!data) return <Card title="Кандидат"><Skeleton rows={3} kpis={false} /></Card>
  const c = data.candidate
  const blocks: Array<[string, string]> = [
    ['experience', 'Опыт'], ['product', 'Продукт'], ['expectations', 'Ожидания'],
    ['motivation', 'Мотивация'], ['red_flags', 'Red flags'],
  ]

  return (
    <Card
      title={`${c.name}`}
      sub={`${c.vacancy_title} · ${c.city || '—'} · ${c.phone} · отклик ${fmtAgo(c.created_at)}${
        c.finished_at && c.started_at
          ? ` · интервью ${Math.round((new Date(c.finished_at).getTime() - new Date(c.started_at).getTime()) / 60000)} мин` : ''}`}
      right={
        <span className="flex items-center gap-1.5">
          <Chip tone={c.stage === 'rejected' ? 'red' : c.stage === 'offer' ? 'green' : 'blue'}>
            {STAGE_LABELS[c.stage] || c.stage}
          </Chip>
          <button title="Редактировать анкету"
            onClick={() => {
              setEdit({ name: c.name, phone: c.phone, city: c.city || '', salary: c.salary_exp || '', experience: c.experience || '' })
              setEditing(v => !v)
            }}
            className="text-[12px] px-2 py-1.5 rounded-lg text-gray-500 bg-gray-100 hover:text-blue-600">✎</button>
          <button title="Удалить кандидата" onClick={removeCandidate}
            className="text-[12px] px-2 py-1.5 rounded-lg text-gray-500 bg-gray-100 hover:text-red-600">🗑</button>
          <button onClick={onClose}
            className="text-[12px] font-semibold text-gray-500 bg-gray-100 rounded-lg px-3 py-1.5 hover:text-gray-800">
            ← к доске
          </button>
        </span>
      }
    >
      {editing && (
        <div className="px-4 py-3 border-b border-gray-100 bg-blue-50/40">
          <div className="flex flex-wrap gap-2">
            {([['name', 'Имя'], ['phone', 'Телефон'], ['city', 'Город'], ['salary', 'Ожидания по зарплате']] as const).map(([k, ph]) => (
              <input key={k} value={edit[k] || ''} placeholder={ph}
                onChange={e => setEdit((x: any) => ({ ...x, [k]: e.target.value }))}
                className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[140px]" />
            ))}
            <input value={edit.experience || ''} placeholder="Опыт работы"
              onChange={e => setEdit((x: any) => ({ ...x, experience: e.target.value }))}
              className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 w-full" />
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={saveEdit} disabled={busy}
              className="text-[12px] font-semibold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50">Сохранить</button>
            <button onClick={() => setEditing(false)}
              className="text-[12px] font-semibold text-gray-500 bg-gray-100 rounded-lg px-3 py-1.5">Отмена</button>
          </div>
        </div>
      )}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-gray-100">
        <span className={`flex items-center justify-center w-12 h-12 rounded-xl text-white text-[22px] font-bold ${
          c.grade ? gradeColor[c.grade] : 'bg-gray-300'}`}>{c.grade || '–'}</span>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[14px] font-semibold tabular-nums">
            {c.score != null ? `${c.score} / 100` : 'без автооценки'}
            {c.shadow && <Chip tone="amber">тень: порог не влияет</Chip>}
            {c.recommended && !c.shadow && <Chip tone="green">рекомендован</Chip>}
          </div>
          <div className="text-[11.5px] text-gray-400">
            ожидания: {c.salary_exp || '—'} · вилка {Number(c.pay_fix).toLocaleString('ru-RU')}+{Number(c.pay_kpi).toLocaleString('ru-RU')} {c.currency}
            {c.red_flags && c.red_flags !== 'чисто' ? ` · флаги: ${c.red_flags}` : ''}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['rejected', 'reserve'].includes(c.stage) ? (
            <button onClick={() => move('scored')} disabled={busy}
              className="text-[12px] font-semibold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
              Вернуть в работу
            </button>
          ) : (
            <>
              {c.stage !== 'invited' && c.stage !== 'offer' && (
                <button onClick={() => move('invited')} disabled={busy}
                  className="text-[12px] font-semibold text-white bg-blue-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
                  На собеседование
                </button>
              )}
              {c.stage === 'invited' && (
                <button onClick={() => move('offer')} disabled={busy}
                  className="text-[12px] font-semibold text-white bg-emerald-600 rounded-lg px-3 py-1.5 disabled:opacity-50">
                  Оффер
                </button>
              )}
              <button onClick={() => move('reserve')} disabled={busy}
                className="text-[12px] font-semibold text-gray-600 bg-gray-100 rounded-lg px-3 py-1.5 disabled:opacity-50">В резерв</button>
              <button onClick={() => move('rejected')} disabled={busy}
                className="text-[12px] font-semibold text-red-600 bg-red-50 rounded-lg px-3 py-1.5 disabled:opacity-50">Отказ</button>
            </>
          )}
        </div>
      </div>

      {c.summary && (
        <div className="px-4 py-3 text-[13px] text-gray-700 border-b border-gray-100">
          <b>Выжимка:</b> {c.summary}
        </div>
      )}

      {c.blocks && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-200 border-b border-gray-100">
          {blocks.map(([k, label]) => {
            const b = c.blocks?.[k]
            if (!b) return <div key={k} className="bg-white px-3 py-2" />
            const s = Number(b.score) || 0
            return (
              <div key={k} className="bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
                <div className={`text-[17px] font-bold tabular-nums ${
                  s >= 70 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-red-600'}`}>{s}</div>
                <div className="text-[10.5px] text-gray-400 leading-tight">{b.note}</div>
              </div>
            )
          })}
        </div>
      )}

      {Array.isArray(c.qualification) && c.qualification.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
            Квалификация по требованиям · met только при подтверждении словами кандидата
          </div>
          <div className="space-y-1">
            {c.qualification.map((q: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[12.5px]">
                <span className={`flex-none mt-px font-bold ${
                  q.status === 'met' ? 'text-emerald-600' : q.status === 'unmet' ? 'text-red-600' : 'text-gray-400'}`}>
                  {q.status === 'met' ? '✓' : q.status === 'unmet' ? '✗' : '?'}
                </span>
                <span className="text-gray-800">{q.requirement}
                  {q.note && <span className="text-gray-400"> — {q.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Приглашение в мессенджер: ссылку кидают откликнувшимся на площадках */}
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        {!invite ? (
          <button onClick={loadInvite} className="text-[12px] font-semibold text-blue-600">📨 Текст приглашения на интервью</button>
        ) : (
          <>
            <a href={invite.whatsapp} target="_blank" rel="noreferrer"
              className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5">WhatsApp</a>
            <a href={invite.telegram} target="_blank" rel="noreferrer"
              className="text-[12px] font-semibold text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5">Telegram</a>
            <button onClick={() => { navigator.clipboard?.writeText(invite.text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="text-[12px] font-semibold text-gray-600 bg-gray-100 rounded-lg px-3 py-1.5">
              {copied ? 'Скопировано ✓' : 'Копировать текст'}
            </button>
          </>
        )}
      </div>

      <div className="max-h-[46vh] overflow-y-auto">
        {(data.messages || []).length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-gray-400">Интервью ещё не начиналось.</div>
        ) : (data.messages || []).map((m: any) => (
          <div key={m.id} className={`px-4 py-2 border-b border-gray-50 ${m.role === 'ai' ? '' : 'bg-blue-50/30'}`}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
              {m.role === 'ai' ? `ИИ · вопрос ${m.question_no}` : `Кандидат${m.answer_ms ? ` · ${Math.round(m.answer_ms / 1000)} сек` : ''}`}
            </div>
            <div className="text-[13px] text-gray-800">{m.text}</div>
            {m.translated && m.translated !== m.text && (
              <div className="text-[11.5px] text-gray-400 mt-0.5">{m.translated}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ───────────── Редактор вакансии ───────────── */

function VacancyEditor({ vacancy, onSaved }: { vacancy: any | null; onSaved: () => void }) {
  const [f, setF] = useState<any>(() => vacancy ? {
    ...vacancy,
    duties: (vacancy.duties || []).join('\n'), requirements: (vacancy.requirements || []).join('\n'),
    offers: (vacancy.offers || []).join('\n'), scenarios: (vacancy.scenarios || []).join('\n'),
    payFix: vacancy.pay_fix, payKpi: vacancy.pay_kpi, questions: vacancy.questions_count,
    weights: vacancy.weights || {},
    langs: Array.isArray(vacancy.langs) && vacancy.langs.length ? vacancy.langs : [vacancy.lang],
  } : {
    slug: '', title: '', lang: 'ru', region: '', location: '', schedule: '', intro: '',
    duties: '', requirements: '', offers: '', payFix: '', payKpi: '', currency: 'UZS',
    questions: 8, scenarios: '', threshold: 65, shadow: true, langs: ['ru'],
    weights: { experience: 30, product: 25, expectations: 20, motivation: 15, red_flags: 10 },
  })
  const [saving, setSaving] = useState(false)
  const [savedUrl, setSavedUrl] = useState('')

  const save = async () => {
    setSaving(true)
    try {
      const r = await apiPost<any>('/hiring', {
        action: 'vacancy', id: f.id, slug: f.slug, title: f.title, lang: f.lang,
        region: f.region, location: f.location, schedule: f.schedule, intro: f.intro,
        duties: String(f.duties).split('\n').map((s: string) => s.trim()).filter(Boolean),
        requirements: String(f.requirements).split('\n').map((s: string) => s.trim()).filter(Boolean),
        offers: String(f.offers).split('\n').map((s: string) => s.trim()).filter(Boolean),
        scenarios: String(f.scenarios).split('\n').map((s: string) => s.trim()).filter(Boolean),
        payFix: Number(String(f.payFix).replace(/\s/g, '')) || 0,
        payKpi: Number(String(f.payKpi).replace(/\s/g, '')) || 0,
        currency: f.currency, questions: Number(f.questions) || 8,
        threshold: Number(f.threshold) || 65, shadow: !!f.shadow, weights: f.weights,
        langs: f.langs || [],
      })
      if (r?.url) setSavedUrl(r.url)
      onSaved()
    } catch (e: any) { alert(e?.message || 'Не удалось сохранить') } finally { setSaving(false) }
  }

  const inp = 'w-full text-[13px] border border-gray-200 rounded-lg px-2.5 py-2'
  const lbl = 'text-[11px] font-semibold uppercase tracking-wide text-gray-400 mt-3 mb-1 block'
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }))

  return (
    <Card title={vacancy ? `Вакансия · ${vacancy.title}` : 'Новая вакансия'}
      sub="публичная ссылка: gfsupport.uz/jobs/<адрес> · интервью и лендинг — на языке вакансии, скоринг — на русском">
      <div className="px-4 pb-4 grid md:grid-cols-2 gap-x-6">
        <div>
          <label className={lbl}>Название</label>
          <input className={inp} value={f.title} onChange={set('title')} placeholder="Satış Meneceri" />
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Адрес (slug)</label>
              <input className={inp} value={f.slug} onChange={set('slug')} placeholder="baku-sales" /></div>
            <div><label className={lbl}>Основной язык</label>
              <select className={inp} value={f.lang} onChange={set('lang')}>
                <option value="ru">Русский</option><option value="az">Азербайджанский</option>
                <option value="uz">Узбекский</option><option value="kz">Казахский</option>
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Город</label>
              <input className={inp} value={f.location || ''} onChange={set('location')} placeholder="Bakı" /></div>
            <div><label className={lbl}>График</label>
              <input className={inp} value={f.schedule || ''} onChange={set('schedule')} placeholder="Пн–Пт, 09:00–18:00" /></div>
          </div>
          <label className={lbl}>Языки страницы (кандидат выбирает сам · переводы сделает ИИ)</label>
          <div className="flex gap-3 flex-wrap text-[12.5px] text-gray-700 py-1">
            {([['ru', 'Русский'], ['az', 'Azərbaycanca'], ['uz', 'O‘zbekcha'], ['kz', 'Қазақша']] as const).map(([code, label]) => (
              <label key={code} className="flex items-center gap-1.5">
                <input type="checkbox"
                  checked={code === f.lang || (f.langs || []).includes(code)}
                  disabled={code === f.lang}
                  onChange={e => setF((x: any) => ({
                    ...x,
                    langs: e.target.checked
                      ? [...(x.langs || []), code]
                      : (x.langs || []).filter((l: string) => l !== code),
                  }))} />
                {label}
              </label>
            ))}
          </div>
          <label className={lbl}>Вступление (пара предложений о компании)</label>
          <textarea className={inp} rows={2} value={f.intro || ''} onChange={set('intro')} />
          <div className="grid grid-cols-3 gap-2">
            <div><label className={lbl}>Фикс</label>
              <input className={inp} value={f.payFix || ''} onChange={set('payFix')} /></div>
            <div><label className={lbl}>KPI</label>
              <input className={inp} value={f.payKpi || ''} onChange={set('payKpi')} /></div>
            <div><label className={lbl}>Валюта</label>
              <input className={inp} value={f.currency} onChange={set('currency')} /></div>
          </div>
        </div>
        <div>
          <label className={lbl}>Обязанности (по строке)</label>
          <textarea className={inp} rows={3} value={f.duties} onChange={set('duties')} />
          <label className={lbl}>Требования (по строке)</label>
          <textarea className={inp} rows={3} value={f.requirements} onChange={set('requirements')} />
          <label className={lbl}>Что предлагаем (по строке)</label>
          <textarea className={inp} rows={2} value={f.offers} onChange={set('offers')} />
          <label className={lbl}>Сценарии на понимание продукта (по строке, ИИ выберет один)</label>
          <textarea className={inp} rows={2} value={f.scenarios} onChange={set('scenarios')}
            placeholder="Ресторан говорит: агрегатор берёт 30% комиссии, но своей доставки боится — что предложите?" />
          <div className="grid grid-cols-3 gap-2">
            <div><label className={lbl}>Вопросов</label>
              <input className={inp} value={f.questions} onChange={set('questions')} /></div>
            <div><label className={lbl}>Порог</label>
              <input className={inp} value={f.threshold} onChange={set('threshold')} /></div>
            <div><label className={lbl}>Режим</label>
              <select className={inp} value={f.shadow ? '1' : '0'}
                onChange={e => setF((x: any) => ({ ...x, shadow: e.target.value === '1' }))}>
                <option value="1">Тень (калибровка)</option>
                <option value="0">Боевой</option>
              </select></div>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !f.title || !f.slug}
          className="text-[13px] font-semibold text-white bg-blue-600 rounded-lg px-4 py-2 disabled:opacity-50">
          {saving ? 'Сохраняем…' : 'Сохранить вакансию'}
        </button>
        {vacancy && (
          <button
            onClick={async () => {
              if (!confirm('Архивировать вакансию? Публичная страница погаснет, кандидаты и история останутся.')) return
              try { await apiPost('/hiring', { action: 'vacancy_delete', id: f.id }); onSaved() }
              catch (e: any) { alert(e?.message || 'Не получилось') }
            }}
            className="text-[13px] font-semibold text-red-600 bg-red-50 rounded-lg px-4 py-2">
            Архивировать
          </button>
        )}
        {savedUrl && (
          <span className="text-[12.5px] text-emerald-600">
            Опубликована: <a className="underline" href={savedUrl} target="_blank" rel="noreferrer">{savedUrl}</a>
          </span>
        )}
      </div>
    </Card>
  )
}

/* ───────────── Страница ───────────── */

export function HiringPage() {
  const [params, setParams] = useSearchParams()
  const [vacancies, setVacancies] = useState<any[] | null>(null)
  const [vacancyId, setVacancyId] = useState('')
  const [board, setBoard] = useState<any>(null)
  const [openCand, setOpenCand] = useState<string | null>(params.get('c'))
  const [editVacancy, setEditVacancy] = useState<any | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadVacancies = useCallback(() => {
    apiGet<any>('/hiring?action=vacancies', false)
      .then(d => { setVacancies(d.vacancies || []); setError(null) })
      .catch(e => setError(e?.message || 'Нет доступа'))
  }, [])
  const loadBoard = useCallback(() => {
    apiGet<any>(`/hiring?action=board&vacancyId=${vacancyId}`, false)
      .then(setBoard).catch(() => {})
  }, [vacancyId])

  useEffect(() => { loadVacancies() }, [loadVacancies])
  useEffect(() => { loadBoard() }, [loadBoard])
  useEffect(() => {
    const c = params.get('c')
    if (c) setOpenCand(c)
  }, [params])

  if (error) return <div className="p-6 text-sm text-gray-500">{error}</div>
  if (!vacancies) return <Skeleton rows={5} />

  const byStage = (s: string) => (board?.candidates || []).filter((c: any) => c.stage === s)

  return (
    <PageShell header={
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[17px] font-bold text-gray-900">Наём</h1>
          <div className="text-[11.5px] text-gray-400">ИИ проводит скрининг и ранжирует · решения принимает человек</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={vacancyId} onChange={e => setVacancyId(e.target.value)}
            className="text-[12.5px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Все вакансии</option>
            {vacancies.map(v => <option key={v.id} value={v.id}>{v.title} · {v.location || v.region || ''}</option>)}
          </select>
          <button onClick={() => setEditVacancy(vacancyId ? vacancies.find(v => v.id === vacancyId) : 'new')}
            className="text-[12px] font-semibold text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5">
            {vacancyId ? 'Настроить вакансию' : '+ Вакансия'}
          </button>
        </div>
      </div>
    }>
      {editVacancy && (
        <VacancyEditor vacancy={editVacancy === 'new' ? null : editVacancy}
          onSaved={() => { setEditVacancy(null); loadVacancies() }} />
      )}

      {/* Карточка — оверлей поверх доски: раньше она вставала над колонками,
          выталкивала их за экран, и изменения этапов происходили «за кадром» */}
      {openCand && (
        <div
          className="fixed inset-0 z-50 bg-black/30 overflow-y-auto p-3 md:p-6"
          onClick={() => { setOpenCand(null); setParams({}) }}
        >
          <div className="max-w-3xl mx-auto" onClick={e => e.stopPropagation()}>
            <CandidateCard id={openCand} onClose={() => { setOpenCand(null); setParams({}) }} onChanged={loadBoard} />
          </div>
        </div>
      )}

      {vacancies.length === 0 && !editVacancy ? (
        <Card title="Вакансий пока нет">
          <div className="p-5 text-[13px] text-gray-500">
            Создайте первую — появится публичная ссылка, которую можно вставлять в объявления
            и отправлять откликнувшимся кандидатам.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-start">
          {BOARD_STAGES.map(s => (
            <div key={s}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
                {STAGE_LABELS[s]} <span className="text-gray-500 tabular-nums">{byStage(s).length}</span>
              </div>
              {byStage(s).map((c: any) => (
                <button key={c.id} onClick={() => setOpenCand(c.id)}
                  className="w-full text-left bg-white border border-gray-200 rounded-xl px-3 py-2.5 mb-2 hover:border-blue-300">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-[13px] text-gray-900 truncate">{c.name}</b>
                    <GradeChip grade={c.grade} />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                    {c.score != null ? `${c.score} · ` : ''}
                    {c.stage === 'interview' ? `вопрос ${c.question_no}` : (c.city || '')}
                    {' · '}{fmtAgo(c.created_at)}
                  </div>
                </button>
              ))}
              {byStage(s).length === 0 && <div className="text-[11.5px] text-gray-300 px-1">пусто</div>}
            </div>
          ))}
        </div>
      )}

      {(board?.candidates || []).some((c: any) => ['reserve', 'rejected'].includes(c.stage)) && (
        <Card title="Резерв и отказы">
          <div className="divide-y divide-gray-50">
            {(board.candidates || []).filter((c: any) => ['reserve', 'rejected'].includes(c.stage)).map((c: any) => (
              <button key={c.id} onClick={() => setOpenCand(c.id)}
                className="w-full text-left px-4 py-2 flex items-center justify-between hover:bg-gray-50">
                <span className="text-[12.5px]"><GradeChip grade={c.grade} /> <b className="ml-2">{c.name}</b>
                  <span className="text-gray-400"> · {STAGE_LABELS[c.stage]}</span></span>
                <span className="text-[11px] text-gray-400">{fmtAgo(c.created_at)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </PageShell>
  )
}

export default HiringPage
