import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

/**
 * Публичная страница вакансии: лендинг → анкета → ИИ-интервью.
 *
 * Кандидат чаще всего открывает её с телефона из мессенджера, поэтому всё
 * mobile-first, а сессия живёт по токену в URL — прервался и вернулся по той
 * же ссылке. Отвечать можно текстом или голосом: сейлзы говорят лучше,
 * чем пишут, и текстовое поле не должно отсеивать говорящих.
 */

const API = '/api/support/public/jobs'

const T: Record<string, Record<string, string>> = {
  ru: {
    apply: 'Откликнуться', name: 'Имя и фамилия', phone: 'Телефон', city: 'Город',
    exp: 'Опыт работы: где, кем, сколько', salary: 'Ожидания по зарплате',
    consent: 'Согласен(на) на обработку персональных данных',
    start: 'Начать разговор (5–7 минут)', note: 'Дальше — короткий разговор: несколько вопросов, можно отвечать голосом.',
    prep: 'Совет: загляните на delever.io — пара вопросов будет о продукте.',
    typing: 'Печатает…', input: 'Ваш ответ…', duties: 'Что делать', reqs: 'Требования', offer: 'Условия',
    q: 'Вопрос', fix: 'фикс', kpi: 'KPI', voiceStop: 'Остановить запись',
  },
  az: {
    apply: 'Müraciət et', name: 'Ad və soyad', phone: 'Telefon', city: 'Şəhər',
    exp: 'İş təcrübəsi: harada, kim kimi, nə qədər', salary: 'Maaş gözləntisi',
    consent: 'Şəxsi məlumatlarımın emalına razıyam',
    start: 'Söhbətə başla (5–7 dəqiqə)', note: 'Sonra qısa söhbət olacaq: bir neçə sual, cavabları səslə də vermək olar.',
    prep: 'Məsləhət: delever.io saytına baxın — bir neçə sual məhsul haqqında olacaq.',
    typing: 'Yazır…', input: 'Cavabınız…', duties: 'Vəzifə öhdəlikləri', reqs: 'Tələblər', offer: 'Nə təklif edirik',
    q: 'Sual', fix: 'fix', kpi: 'KPI', voiceStop: 'Yazmanı dayandır',
  },
  uz: {
    apply: 'Ariza berish', name: 'Ism va familiya', phone: 'Telefon', city: 'Shahar',
    exp: 'Ish tajribasi: qayerda, kim bo‘lib, qancha', salary: 'Maosh bo‘yicha kutilma',
    consent: 'Shaxsiy ma’lumotlarimni qayta ishlashga roziman',
    start: 'Suhbatni boshlash (5–7 daqiqa)', note: 'Keyin qisqa suhbat bo‘ladi: bir nechta savol, ovozda ham javob berish mumkin.',
    prep: 'Maslahat: delever.io saytiga qarang — bir nechta savol mahsulot haqida bo‘ladi.',
    typing: 'Yozmoqda…', input: 'Javobingiz…', duties: 'Vazifalar', reqs: 'Talablar', offer: 'Shartlar',
    q: 'Savol', fix: 'fix', kpi: 'KPI', voiceStop: 'Yozishni to‘xtatish',
  },
}

export function PublicJobPage() {
  const { slug } = useParams<{ slug: string }>()
  const [params, setParams] = useSearchParams()
  const token = params.get('t') || ''

  const [vacancy, setVacancy] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  // Анкета
  const [form, setForm] = useState({ name: '', phone: '', city: '', experience: '', salary: '', consent: false })
  const [submitting, setSubmitting] = useState(false)
  // Интервью
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([])
  const [progress, setProgress] = useState({ no: 0, total: 8 })
  const [finished, setFinished] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [recording, setRecording] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const lang = vacancy?.lang || 'ru'
  const t = T[lang] || T.ru

  useEffect(() => {
    if (!slug) return
    fetch(`${API}?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { if (d.vacancy) setVacancy(d.vacancy); else setError('Вакансия не найдена') })
      .catch(() => setError('Не удалось загрузить'))
  }, [slug])

  // Возврат в прерванную сессию по токену из URL
  const loadSession = useCallback(() => {
    if (!token) return
    fetch(`${API}?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        setMessages(d.messages || [])
        setProgress({ no: d.questionNo || 0, total: d.total || 8 })
        if (d.finished) setFinished(d.farewell)
        else if (!(d.messages || []).length) askNext(token, '')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
  useEffect(() => { loadSession() }, [loadSession])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, finished])

  const askNext = async (tok: string, text: string, voice?: { audio: string; mime: string }) => {
    setWaiting(true)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voice
          ? { action: 'voice', token: tok, ...voice }
          : { action: 'message', token: tok, text }),
      })
      const d = await res.json()
      if (d.error) { setWaiting(false); return }
      if (voice && d.transcribed) {
        setMessages(m => [...m, { role: 'candidate', text: d.transcribed }])
      }
      if (d.done) { setFinished(d.farewell || '✓'); setWaiting(false); return }
      setMessages(m => [...m, { role: 'ai', text: d.question }])
      setProgress({ no: d.no, total: d.total })
    } finally { setWaiting(false) }
  }

  const submitApply = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', slug, ...form }),
      })
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      setParams({ t: d.token })
    } finally { setSubmitting(false) }
  }

  const send = () => {
    const text = input.trim()
    if (!text || waiting || !token) return
    setMessages(m => [...m, { role: 'candidate', text }])
    setInput('')
    askNext(token, text)
  }

  const toggleVoice = async () => {
    if (recording) {
      recRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size < 1000 || blob.size > 2_500_000) return
        const buf = await blob.arrayBuffer()
        let bin = ''
        const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
        }
        askNext(token, '', { audio: btoa(bin), mime: 'audio/webm' })
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
    } catch { /* нет микрофона — остаётся текст */ }
  }

  if (error && !vacancy) return <div style={S.page}><div style={S.card}>{error}</div></div>
  if (!vacancy) return <div style={S.page}><div style={S.card}>…</div></div>

  // ---- Режим интервью ----
  if (token) {
    return (
      <div style={S.page}>
        <div style={{ ...S.card, maxWidth: 560, display: 'flex', flexDirection: 'column', height: '85vh' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e9f0' }}>
            <b style={{ fontSize: 15 }}>Delever · {vacancy.title}</b>
            {!finished && (
              <span style={{ color: '#8a94a3', fontSize: 12, marginLeft: 8 }}>
                {t.q} {Math.min(progress.no, progress.total)} / {progress.total}
              </span>
            )}
            <div style={{ height: 4, background: '#e5e9f0', borderRadius: 2, marginTop: 8 }}>
              <div style={{
                height: '100%', borderRadius: 2, background: '#2b5cd9', transition: 'width .3s',
                width: `${finished ? 100 : Math.round(progress.no / progress.total * 100)}%`,
              }} />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                maxWidth: '86%', padding: '9px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.45,
                ...(m.role === 'ai'
                  ? { background: '#f3f5f9', border: '1px solid #e5e9f0', alignSelf: 'flex-start', borderBottomLeftRadius: 4 }
                  : { background: '#2b5cd9', color: '#fff', alignSelf: 'flex-end', borderBottomRightRadius: 4 }),
              }}>{m.text}</div>
            ))}
            {waiting && <div style={{ color: '#8a94a3', fontSize: 12.5 }}>{t.typing}</div>}
            {finished && (
              <div style={{
                background: '#e3f2ec', border: '1px solid #0e7a52', color: '#0e7a52',
                borderRadius: 10, padding: '12px 14px', fontSize: 14, marginTop: 6,
              }}>{finished}</div>
            )}
            <div ref={bottomRef} />
          </div>
          {!finished && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 14px 14px' }}>
              <input
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send() }}
                placeholder={t.input} disabled={waiting || recording}
                style={{ flex: 1, border: '1px solid #d7dde6', borderRadius: 10, padding: '10px 13px', fontSize: 14, minWidth: 0 }}
              />
              <button onClick={toggleVoice} disabled={waiting} title={recording ? t.voiceStop : 'Voice'} style={{
                ...S.btn, background: recording ? '#bc3a2e' : '#eef2fa',
                color: recording ? '#fff' : '#2b5cd9', minWidth: 44,
              }}>{recording ? '■' : '🎙'}</button>
              <button onClick={send} disabled={waiting || !input.trim()} style={{ ...S.btn, minWidth: 44 }}>→</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- Лендинг + анкета ----
  const inp = (k: keyof typeof form, ph: string, wide = false) => (
    <input
      value={String(form[k])} placeholder={ph}
      onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
      style={{
        border: '1px solid #d7dde6', borderRadius: 10, padding: '11px 13px', fontSize: 14,
        flex: wide ? '1 1 100%' : '1 1 45%', minWidth: 160,
      }}
    />
  )

  return (
    <div style={S.page}>
      <div style={{ ...S.card, maxWidth: 640, padding: '26px 26px 30px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: '#2b5cd9', textTransform: 'uppercase' }}>
          Delever{vacancy.location ? ` · ${vacancy.location}` : ''}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, margin: '4px 0 2px' }}>{vacancy.title}</h1>
        {vacancy.schedule && <div style={{ color: '#8a94a3', fontSize: 13 }}>{vacancy.schedule}</div>}
        {vacancy.intro && <p style={{ fontSize: 14, color: '#4b5768', marginTop: 10 }}>{vacancy.intro}</p>}

        {(vacancy.payFix > 0 || vacancy.payKpi > 0) && (
          <div style={{ display: 'flex', gap: 1, background: '#e5e9f0', border: '1px solid #e5e9f0', borderRadius: 10, overflow: 'hidden', margin: '14px 0' }}>
            <div style={S.pay}><div style={S.payV}>{vacancy.payFix.toLocaleString('ru-RU')} {vacancy.currency}</div><div style={S.payL}>{t.fix}</div></div>
            <div style={S.pay}><div style={S.payV}>{vacancy.payKpi.toLocaleString('ru-RU')} {vacancy.currency}</div><div style={S.payL}>{t.kpi}</div></div>
          </div>
        )}

        {[[t.duties, vacancy.duties], [t.reqs, vacancy.requirements], [t.offer, vacancy.offers]].map(([title, items]: any) => (
          items?.length ? (
            <div key={title}>
              <h4 style={S.h4}>{title}</h4>
              <ul style={{ paddingLeft: 18, fontSize: 13.5, color: '#4b5768', margin: 0 }}>
                {items.map((it: string, i: number) => <li key={i} style={{ margin: '4px 0' }}>{it}</li>)}
              </ul>
            </div>
          ) : null
        ))}

        <h4 style={S.h4}>{t.apply}</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {inp('name', t.name)}{inp('phone', t.phone)}
          {inp('city', t.city)}{inp('salary', t.salary)}
          {inp('experience', t.exp, true)}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: '#4b5768', margin: '12px 0' }}>
          <input type="checkbox" checked={form.consent}
            onChange={e => setForm(f => ({ ...f, consent: e.target.checked }))} />
          {t.consent}
        </label>
        {error && <div style={{ color: '#bc3a2e', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <button
          onClick={submitApply}
          disabled={submitting || !form.consent || !form.name.trim() || form.phone.replace(/\D/g, '').length < 9}
          style={{ ...S.btn, width: '100%', padding: '13px', fontSize: 15, opacity: (!form.consent || !form.name.trim()) ? .5 : 1 }}
        >{submitting ? '…' : t.start}</button>
        <div style={{ color: '#8a94a3', fontSize: 12, marginTop: 8 }}>{t.note}</div>
        <div style={{ color: '#4b5768', fontSize: 12, marginTop: 4 }}>
          {t.prep?.split('delever.io')[0]}
          <a href="https://delever.io" target="_blank" rel="noreferrer" style={{ color: '#2b5cd9' }}>delever.io</a>
          {t.prep?.split('delever.io')[1]}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#f6f7fa', display: 'flex', alignItems: 'flex-start',
    justifyContent: 'center', padding: '24px 12px',
    fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif', color: '#101623',
  },
  card: { background: '#fff', border: '1px solid #e5e9f0', borderRadius: 14, width: '100%' },
  btn: {
    border: 'none', borderRadius: 10, background: '#2b5cd9', color: '#fff',
    fontWeight: 600, fontSize: 14, padding: '10px 14px', cursor: 'pointer',
  },
  pay: { flex: 1, background: '#fff', padding: '10px 14px', textAlign: 'center' },
  payV: { fontSize: 18, fontWeight: 700 },
  payL: { fontSize: 11.5, color: '#8a94a3' },
  h4: {
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
    color: '#8a94a3', margin: '18px 0 6px',
  },
}

export default PublicJobPage
