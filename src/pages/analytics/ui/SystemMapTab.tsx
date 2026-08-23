/**
 * Живая карта системы — утверждённый прототип v5, переведённый на боевые данные.
 *
 * Топология фиксированная (она и есть архитектура), живое — поверх:
 *  - /system/map (раз в 15 сек): счётчик дня + последнее событие по узлу;
 *  - /system/journal (раз в 10 сек): новые события → импульсы по рёбрам,
 *    вспышки узлов, лента правым бортом.
 * Заменяет вкладку «Модули»: карточки модулей стали паспортами узлов.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiGet } from '@/shared/services/api.service'

type NodeDef = {
  id: string; x: number; y: number; name: string; tag: string
  kind: 'flow' | 'ai' | 'ok' | 'warn' | 'crit'
  hero?: boolean; mem?: boolean; quiet?: boolean; sched?: string
  desc: string; inp: string[]; out: string[]
  /** максимум минут тишины для живого узла, прежде чем ставим жёлтый бейдж */
  quietLimitMin?: number
}

const NODES: NodeDef[] = [
  { id: 'wa', x: 30, y: 60, name: 'WhatsApp-мост', tag: 'Railway · группы ресторанов', kind: 'flow', quietLimitMin: 60,
    desc: 'Мост держит сессию WhatsApp и шлёт вебхук на каждое сообщение в группах ресторанов. Основной канал поддержки.',
    inp: ['WhatsApp-группы ресторанов'], out: ['Ингест сообщений'] },
  { id: 'tg', x: 30, y: 195, name: 'Telegram-бот', tag: '@delever_sales_bot · чаты', kind: 'flow', quietLimitMin: 180,
    desc: 'Сидит в ресторанных Telegram-чатах, вебхуком отдаёт каждое сообщение и file_id медиа.',
    inp: ['Telegram-чаты ресторанов'], out: ['Ингест сообщений'] },
  { id: 'feed', x: 30, y: 330, name: 'Канал ошибок', tag: 'фид Жамолиддина · сбои заказов', kind: 'crit', quietLimitMin: 120,
    desc: 'Сюда валятся все ошибки заказов платформы: 65К+ за 60 дней по 255 ресторанам. Сырьё для сводки аварий и знаний агента.',
    inp: ['Ошибки платформы Delever'], out: ['Сводка аварий'] },
  { id: 'amo', x: 30, y: 700, name: 'AmoCRM', tag: 'сделки отдела продаж', kind: 'flow', quiet: true, sched: 'по работе команды',
    desc: 'Боевой аккаунт продаж. Синк забирает изменения этапов по курсору.',
    inp: ['Работа команды продаж в Amo'], out: ['Синк Amo'] },
  { id: 'ingest', x: 320, y: 48, name: 'Ингест сообщений', tag: 'вебхуки → нормализация', kind: 'flow', quietLimitMin: 60,
    desc: 'Принимает вебхуки WA/TG: определяет отправителя (сотрудник или клиент), заливает медиа в Blob, пишет сообщение в базу, снимает «непрочитано» при ответе команды.',
    inp: ['WhatsApp-мост', 'Telegram-бот'], out: ['Postgres', 'Vercel Blob'] },
  { id: 'agent', x: 320, y: 178, name: 'AI-агент', tag: 'gpt-4o · режим помощника', kind: 'ai', hero: true, quietLimitMin: 180,
    desc: 'На каждое клиентское сообщение: скипы (свои, служебные реплики, команда уже в диалоге) → знания (аварии + ошибки ресторана + примеры команды) → решение → подавитель попугая → санитария тега. Сам никому не пишет — только предлагает.',
    inp: ['Postgres: контекст и знания'], out: ['Журнал решений', '✨ черновик в чатах', 'кейсы и теги'] },
  { id: 'incidents', x: 320, y: 308, name: 'Сводка аварий', tag: 'крон */2 мин', kind: 'crit', quietLimitMin: 26 * 60,
    desc: 'Индексирует фид ошибок, ловит спайки (≥8 повторов, ≥2 ресторана / 15 мин), сканирует партнёрские группы на «iiko лежит», сторожит живость самого агента.',
    inp: ['Канал ошибок', 'партнёрские группы'], out: ['Инциденты → знания агента', 'Хроника'] },
  { id: 'teacher', x: 320, y: 438, name: 'Учитель', tag: 'крон */30 мин', kind: 'ok', quietLimitMin: 26 * 60,
    desc: 'Собирает свежие пары «вопрос клиента → ответ команды» в базу примеров. Фильтры: без рассылок, без ссылок, ответ ≤2ч.',
    inp: ['Postgres: новые ответы команды'], out: ['База примеров → знания агента'] },
  { id: 'sla', x: 320, y: 568, name: 'SLA-страж', tag: 'пропущенные клиенты', kind: 'warn', quiet: true, sched: 'по алертам',
    desc: 'Следит, чтобы клиент не остался без ответа: скан сессий, алерты по игнору и просроченным обещаниям.',
    inp: ['Postgres: сессии, сообщения'], out: ['Алерты → Хроника'] },
  { id: 'work', x: 320, y: 698, name: 'Учётчик работы', tag: 'фантомные задачи · 21:00', kind: 'flow', quiet: true, sched: 'вечером',
    desc: 'Из кейсов делает фантомные задачи и вечером переспрашивает исполнителя в боте. Выработка — только по подтверждённому.',
    inp: ['Кейсы, активность сотрудников'], out: ['work_items', 'вечерний переспрос в боте'] },
  { id: 'amosync', x: 320, y: 828, name: 'Синк Amo', tag: 'курсор + отметка живости', kind: 'flow', quiet: true, sched: '*/15 мин',
    desc: 'Тянет изменения сделок из Amo по курсору, двигает этапы в CRM, пишет след в хронику.',
    inp: ['AmoCRM'], out: ['sales_* в Postgres', 'Хроника'] },
  { id: 'db', x: 650, y: 330, name: 'Neon Postgres', tag: 'Франкфурт · единая память', kind: 'ok', mem: true, quietLimitMin: 60,
    desc: 'Сообщения, ошибки заказов, примеры команды, решения агента, инциденты, кейсы, сделки, хроника. Всё, что знает система — здесь.',
    inp: ['Все обработчики'], out: ['Агент, страницы, аналитика'] },
  { id: 'blob', x: 650, y: 570, name: 'Vercel Blob', tag: 'медиа tg/ и wa/', kind: 'ok', mem: true, quietLimitMin: 12 * 60,
    desc: 'Фото и файлы из чатов: заливаются при ингесте, отдаются в интерфейс и на анализ медиа.',
    inp: ['Ингест сообщений'], out: ['Чаты, анализ медиа'] },
  { id: 'chats', x: 1000, y: 60, name: 'Чаты', tag: '✨ черновик со знаниями', kind: 'ai', quietLimitMin: 120,
    desc: 'Рабочее место сотрудника. Кнопка ✨ собирает черновик из знаний. Отправка — только рукой человека.',
    inp: ['Postgres', 'AI-агент'], out: ['Ответ клиенту — рукой сотрудника'] },
  { id: 'cases', x: 1000, y: 195, name: 'Кейсы и теги', tag: 'тикеты, эскалации', kind: 'warn', quiet: true, sched: 'по решениям',
    desc: 'Решения агента и работа команды: кейсы с приоритетом, теги достижимым сотрудникам (онлайн + пишет в группе).',
    inp: ['AI-агент', 'команда'], out: ['Доска кейсов, уведомления'] },
  { id: 'chronicle', x: 1000, y: 330, name: 'Хроника', tag: 'лента всех автоматов', kind: 'flow', quietLimitMin: 120,
    desc: 'Единая лента: решения агента, SLA-страж, инциденты, учитель, сверка задач, синк Amo.',
    inp: ['Все автоматы через Postgres'], out: ['Глаза владельца'] },
  { id: 'analytics', x: 1000, y: 465, name: 'Аналитика', tag: 'Pulse · метрики · ошибки', kind: 'flow', quiet: true, sched: 'по запросу',
    desc: 'FRT/SLA, таксономия обращений, фид ошибок с разбором. Карта заменила здесь вкладку «Модули».',
    inp: ['Postgres'], out: ['Решения руководителя'] },
  { id: 'tgbot', x: 1000, y: 640, name: 'Бот-переспрос', tag: 'вечерняя сверка задач · 21:00', kind: 'ok', quiet: true, sched: 'вечером',
    desc: 'Вечером спрашивает сотрудника про фантомные задачи: подтверждено → в выработку.',
    inp: ['Учётчик работы'], out: ['Подтверждения в Postgres'] },
]

const EDGES: Array<[string, string, boolean?]> = [
  ['wa', 'ingest', true], ['tg', 'ingest', true], ['feed', 'incidents', true], ['amo', 'amosync'],
  ['ingest', 'db', true], ['ingest', 'blob'], ['incidents', 'db'], ['teacher', 'db'],
  ['sla', 'db'], ['work', 'db'], ['amosync', 'db'],
  ['db', 'agent', true], ['agent', 'db'],
  ['agent', 'chats', true], ['agent', 'cases'],
  ['db', 'chats'], ['db', 'chronicle'], ['db', 'analytics'], ['work', 'tgbot'],
]
const KIND_COLOR: Record<string, string> = { flow: '#2563eb', ai: '#7c3aed', warn: '#d97706', crit: '#e11d48', ok: '#059669' }
const NW = 212, NH = 104, SW = 1280, SH = 950

/** актор хроники → узел карты и рёбра его импульса */
const ACTOR_MAP: Record<string, { node: string; kind: string; edges: string[] }> = {
  'AI-агент': { node: 'agent', kind: 'ai', edges: ['db→agent', 'agent→db', 'agent→chats'] },
  'Сводка аварий': { node: 'incidents', kind: 'crit', edges: ['feed→incidents', 'incidents→db'] },
  'Учитель': { node: 'teacher', kind: 'ok', edges: ['teacher→db', 'db→agent'] },
  'SLA-страж': { node: 'sla', kind: 'warn', edges: ['sla→db', 'db→chronicle'] },
  'Сверка задач': { node: 'work', kind: 'flow', edges: ['work→db', 'work→tgbot'] },
  'Синк Amo': { node: 'amosync', kind: 'flow', edges: ['amo→amosync', 'amosync→db'] },
  'Сторож': { node: 'incidents', kind: 'crit', edges: ['incidents→db'] },
}
const ACTOR_CLS: Record<string, string> = {
  'AI-агент': 'text-violet-600', 'Сводка аварий': 'text-rose-600', 'Учитель': 'text-emerald-600',
  'SLA-страж': 'text-amber-600', 'Сверка задач': 'text-pink-600', 'Синк Amo': 'text-sky-700', 'Ингест': 'text-blue-600',
}

type MapData = {
  kpi: { msgsHour: number; decisions: number; incidentsOpen: number; examples: number }
  nodes: Record<string, { count: string; sub: string; last: string | null; open?: number; extra?: [string, string][] }>
}
type JEvent = { at: string; actor: string; action: string; summary: string }

function edgePath(a: string, b: string): string {
  const na = NODES.find(n => n.id === a)!, nb = NODES.find(n => n.id === b)!
  const fwd = nb.x > na.x
  const x1 = fwd ? na.x + NW : na.x, y1 = na.y + NH / 2
  const x2 = fwd ? nb.x : nb.x + NW, y2 = nb.y + NH / 2
  const dx = Math.abs(x2 - x1) * 0.45
  return `M${x1},${y1} C${x1 + (fwd ? dx : -dx)},${y1} ${x2 + (fwd ? -dx : dx)},${y2} ${x2},${y2}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
      .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
  } catch { return '—' }
}
function ageMin(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z').getTime()
  return Math.max(0, Math.round((Date.now() - t) / 60000))
}

export function SystemMapTab() {
  const [data, setData] = useState<MapData | null>(null)
  const [events, setEvents] = useState<JEvent[]>([])
  const [selected, setSelected] = useState<NodeDef | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [scale, setScale] = useState(0.8)

  const vpRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const sparkRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const sparkState = useRef<Record<string, { buf: number[]; spike: number }>>({})
  const seenRef = useRef<Set<string>>(new Set())
  const pausedRef = useRef(false)
  pausedRef.current = paused

  // масштаб: карта целиком в отведённой площади, по центру
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const fit = () => setScale(Math.min((el.clientWidth - 20) / SW, (el.clientHeight - 12) / SH, 1.05))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // спарклайны: фоновый шум + затухающие всплески от событий
  useEffect(() => {
    for (const n of NODES) sparkState.current[n.id] ||= { buf: new Array(93).fill(0), spike: 0 }
    let raf = 0
    let lastFrame = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - lastFrame < 90) return
      lastFrame = t
      for (const n of NODES) {
        const cv = sparkRefs.current[n.id]; if (!cv) continue
        const s = sparkState.current[n.id]
        s.buf.shift(); s.buf.push((Math.random() - .5) * .8 + s.spike * 10); s.spike *= .5
        const ctx = cv.getContext('2d'); if (!ctx) continue
        ctx.clearRect(0, 0, 186, 16)
        ctx.strokeStyle = KIND_COLOR[n.kind]; ctx.globalAlpha = .85; ctx.lineWidth = 1.2; ctx.beginPath()
        for (let i = 0; i < s.buf.length; i++) { const x = i * 2, y = 12.5 - s.buf[i]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
        ctx.stroke()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const pulse = useCallback((edgeKey: string, kind = 'flow', flashNode?: string) => {
    const svg = svgRef.current
    const path = svg?.querySelector<SVGPathElement>(`[data-edge="${edgeKey}"]`)
    if (svg && path) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('r', '3.4')
      dot.setAttribute('fill', KIND_COLOR[kind] || KIND_COLOR.flow)
      svg.appendChild(dot)
      const len = path.getTotalLength(), t0 = performance.now(), dur = 1100
      const step = (t: number) => {
        const k = Math.min((t - t0) / dur, 1)
        const pt = path.getPointAtLength(len * k)
        dot.setAttribute('cx', String(pt.x)); dot.setAttribute('cy', String(pt.y))
        if (k < 1) requestAnimationFrame(step); else dot.remove()
      }
      requestAnimationFrame(step)
    }
    if (flashNode) {
      const el = nodeRefs.current[flashNode]
      const s = sparkState.current[flashNode]
      if (s) s.spike = 1
      if (el) {
        el.style.borderColor = KIND_COLOR[kind] || KIND_COLOR.flow
        el.style.boxShadow = `0 0 0 1.5px ${KIND_COLOR[kind] || KIND_COLOR.flow}`
        setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = '' }, 900)
      }
    }
  }, [])

  // поллинг: карта (15 сек) + хроника (10 сек); новые события → импульсы
  useEffect(() => {
    let dead = false
    const loadMap = () => apiGet<MapData>('/system/map').then(d => { if (!dead) setData(d) }).catch(() => {})
    const loadJournal = () => apiGet<{ events: JEvent[] }>('/system/journal?limit=60').then(d => {
      if (dead || !d?.events) return
      const fresh: JEvent[] = []
      for (const e of d.events) {
        const key = `${e.at}|${e.actor}|${(e.summary || '').slice(0, 60)}`
        if (!seenRef.current.has(key)) { seenRef.current.add(key); fresh.push(e) }
      }
      if (seenRef.current.size > 600) seenRef.current = new Set([...seenRef.current].slice(-400))
      if (fresh.length) {
        setEvents(prev => [...fresh, ...prev].slice(0, 60))
        if (!pausedRef.current) {
          // первый заход — вся история сразу, без светового шоу
          const isInitial = fresh.length > 15
          for (const e of fresh.slice(0, isInitial ? 0 : 6)) {
            const m = ACTOR_MAP[e.actor]
            if (m) m.edges.forEach((edge, i) => setTimeout(() => pulse(edge, m.kind, i === 0 ? m.node : undefined), i * 450))
          }
        }
      }
    }).catch(() => {})
    loadMap(); loadJournal()
    const t1 = setInterval(loadMap, 15000)
    const t2 = setInterval(loadJournal, 10000)
    return () => { dead = true; clearInterval(t1); clearInterval(t2) }
  }, [pulse])

  // импульс ингеста: счётчик сообщений вырос между обновлениями карты
  const prevMsgs = useRef<number | null>(null)
  useEffect(() => {
    if (!data) return
    const cur = parseInt(String(data.nodes.ingest?.count || '0').replace(/\D/g, ''), 10)
    if (prevMsgs.current !== null && cur > prevMsgs.current && !pausedRef.current) {
      pulse('wa→ingest', 'flow', 'ingest')
      setTimeout(() => pulse('ingest→db', 'flow', 'db'), 450)
    }
    prevMsgs.current = cur
  }, [data, pulse])

  const adjacent = (id: string) => {
    const set = new Set<string>()
    for (const [a, b] of EDGES) { if (a === id) set.add(b); if (b === id) set.add(a) }
    return set
  }
  const hoverAdj = hovered ? adjacent(hovered) : null

  const health = (n: NodeDef): { cls: 'ok' | 'warn' | 'crit' | 'sched'; label: string } => {
    const live = data?.nodes[n.id]
    if (n.id === 'incidents' && (live?.open || 0) > 0) return { cls: 'crit', label: `${live!.open} открыт` }
    if (n.quiet) return { cls: 'sched', label: n.sched || 'по расписанию' }
    const age = ageMin(live?.last || null)
    if (age !== null && n.quietLimitMin && age > n.quietLimitMin)
      return { cls: 'warn', label: `тихо ${age >= 120 ? Math.round(age / 60) + 'ч' : age + ' мин'}` }
    return { cls: 'ok', label: '' }
  }

  const kpi = data?.kpi
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 218px)', minHeight: 520 }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {[
          { v: kpi ? String(kpi.msgsHour) : '…', l: 'сообщ / час', c: 'text-blue-600' },
          { v: kpi ? String(kpi.decisions) : '…', l: 'решений ИИ сегодня', c: 'text-slate-800' },
          { v: kpi ? String(kpi.incidentsOpen) : '…', l: 'инцидентов открыто', c: kpi?.incidentsOpen ? 'text-amber-600' : 'text-emerald-600' },
          { v: kpi ? kpi.examples.toLocaleString('ru-RU') : '…', l: 'примеров в базе', c: 'text-slate-800' },
        ].map(k => (
          <div key={k.l} className="bg-white border border-[#e3e9f2] rounded-lg px-3 py-1 flex items-baseline gap-2 shadow-sm">
            <b className={`font-mono text-sm font-semibold tabular-nums ${k.c}`}>{k.v}</b>
            <span className="text-[9px] text-slate-500 uppercase tracking-wide">{k.l}</span>
          </div>
        ))}
        <span className="text-[11px] text-slate-400 ml-auto">обновляется само · карта раз в 15 сек, лента раз в 10</span>
      </div>

      <div className="flex gap-2.5 flex-1 min-h-0">
        {/* сцена */}
        <div ref={vpRef} className="flex-1 min-w-0 flex items-center justify-center overflow-hidden border border-[#e3e9f2] rounded-2xl shadow-sm"
          style={{ background: '#f8fafd' }}>
          <div className="relative flex-none" style={{
            width: SW, height: SH, transform: `scale(${scale})`, transformOrigin: 'center center',
            backgroundImage: 'radial-gradient(circle,#d9e2ef 1px,transparent 1px)', backgroundSize: '22px 22px',
          }}>
            {[['Источники', 36], ['Обработка', 330], ['Память', 660], ['Выходы', 1000]].map(([l, x]) => (
              <span key={l} className="absolute top-3.5 font-mono text-[10.5px] text-slate-400 tracking-[.16em] uppercase" style={{ left: x as number }}>{l}</span>
            ))}
            <svg ref={svgRef} className="absolute inset-0 pointer-events-none" width={SW} height={SH}>
              <defs><marker id="maparr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto">
                <path d="M0,0.6 L7.4,4 L0,7.4 Z" fill="#a8b8cf" /></marker></defs>
              {EDGES.map(([a, b, main]) => {
                const related = hovered && (a === hovered || b === hovered)
                return <path key={a + b} data-edge={`${a}→${b}`} d={edgePath(a, b)} fill="none"
                  stroke={related ? '#7ea4e8' : '#c9d5e6'} strokeWidth={main ? 2.6 : 1.5}
                  opacity={hovered ? (related ? 1 : .15) : 1} markerEnd="url(#maparr)"
                  style={{ transition: 'opacity .25s, stroke .25s' }} />
              })}
            </svg>
            {NODES.map(n => {
              const live = data?.nodes[n.id]
              const h = health(n)
              const dim = hovered && hovered !== n.id && !hoverAdj?.has(n.id)
              return (
                <div key={n.id} ref={el => { nodeRefs.current[n.id] = el }}
                  onClick={() => setSelected(n)}
                  onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)}
                  className={`absolute rounded-xl border bg-white px-3 pt-2 pb-1.5 cursor-pointer shadow-sm transition-all
                    ${n.hero ? 'border-violet-300' : n.mem ? 'border-emerald-100' : 'border-[#e3e9f2]'}
                    ${selected?.id === n.id ? 'ring-1.5 ring-blue-500 border-blue-500' : 'hover:border-blue-400'}`}
                  style={{
                    left: n.x, top: n.y, width: NW, height: NH, opacity: dim ? .35 : 1,
                    background: n.hero ? 'linear-gradient(165deg,#faf7ff 0%,#fff 55%)' : n.mem ? 'linear-gradient(165deg,#f2fbf9 0%,#fff 60%)' : undefined,
                  }}>
                  <h3 className={`text-[12.5px] font-bold flex items-center gap-1.5 whitespace-nowrap ${n.hero ? 'text-violet-900' : 'text-slate-800'}`}>
                    <span className={`w-2 h-2 rounded-full flex-none ${h.cls === 'crit' ? 'bg-rose-500' : h.cls === 'sched' ? 'bg-slate-300' : h.cls === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span className="overflow-hidden text-ellipsis">{n.name}</span>
                    {h.label && (
                      <span className={`ml-auto flex-none font-mono text-[8.5px] font-semibold rounded-full px-1.5 py-px
                        ${h.cls === 'crit' ? 'bg-rose-50 text-rose-600' : h.cls === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>{h.label}</span>
                    )}
                  </h3>
                  <div className="text-[10px] text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">{n.tag}</div>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <b className="font-mono text-[15px] font-semibold tabular-nums text-slate-900">{live?.count ?? '…'}</b>
                    <span className="text-[9.5px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">{live?.sub ?? ''}</span>
                  </div>
                  <canvas ref={el => { sparkRefs.current[n.id] = el }} width={186} height={16} className="w-full block mt-0.5" style={{ height: 16 }} />
                  <div className="font-mono text-[9px] text-slate-400 mt-0.5 tabular-nums">посл. событие {fmtTime(live?.last || null)}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* живая лента правым бортом */}
        <aside className="w-[280px] flex-none bg-white border border-[#e3e9f2] rounded-2xl shadow-sm flex flex-col min-h-0">
          <div className="px-3.5 pt-2.5 pb-2 border-b border-[#e3e9f2]">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] text-slate-400 uppercase tracking-[.13em] font-semibold">Живая лента</h4>
              <button onClick={() => setPaused(p => !p)}
                className="text-[10px] text-slate-500 border border-[#e3e9f2] rounded-md px-2 py-px hover:text-slate-800">
                {paused ? '▶ поток' : '⏸ пауза'}
              </button>
            </div>
            <div className="flex gap-2 flex-wrap mt-1.5 text-[9.5px] text-slate-500">
              {[['#2563eb', 'поток'], ['#7c3aed', 'решения ИИ'], ['#d97706', 'алерты'], ['#e11d48', 'инциденты']].map(([c, l]) => (
                <span key={l}><i className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: c }} />{l}</span>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3.5 py-1.5">
            {events.length === 0 && <p className="text-[11.5px] text-slate-400 py-2">загружаю хронику…</p>}
            {events.map((e, i) => (
              <div key={i} className="py-1.5 border-b border-slate-50 last:border-none">
                <div className="flex gap-2 items-baseline">
                  <time className="font-mono text-[10px] text-slate-400 tabular-nums">{fmtTime(e.at)}</time>
                  <span className={`text-[11.5px] font-semibold ${ACTOR_CLS[e.actor] || 'text-slate-600'}`}>{e.actor}</span>
                </div>
                <div className="text-[11.5px] text-slate-500 leading-snug mt-px">{(e.summary || e.action || '').slice(0, 140)}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* паспорт узла */}
      {selected && (() => {
        const live = data?.nodes[selected.id]
        const h = health(selected)
        const nodeEvents = events.filter(e => ACTOR_MAP[e.actor]?.node === selected.id).slice(0, 6)
        return (
          <div className="fixed inset-y-0 right-0 w-[380px] bg-white border-l border-[#e3e9f2] shadow-2xl z-50 p-5 overflow-y-auto">
            <button onClick={() => setSelected(null)}
              className="absolute top-4 right-4 w-7 h-7 border border-[#e3e9f2] rounded-lg text-slate-400 hover:text-slate-700">✕</button>
            <h2 className="text-[17px] font-bold text-slate-900">{selected.name}</h2>
            <div className="text-xs text-slate-500 mb-2.5">{selected.tag}</div>
            <div className={`text-xs rounded-lg px-3 py-2 mb-3
              ${h.cls === 'crit' ? 'bg-rose-50 text-rose-600' : h.cls === 'warn' ? 'bg-amber-50 text-amber-700'
                : h.cls === 'sched' ? 'bg-slate-50 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
              {h.cls === 'crit' ? `⛔ ${h.label} — открытый инцидент виден агенту и хронике`
                : h.cls === 'warn' ? `⏱ ${h.label} — дольше обычного ритма`
                  : h.cls === 'sched' ? `⏸ тихо — работает по расписанию: ${selected.sched}`
                    : '✓ живой — события идут в обычном ритме'}
            </div>
            <p className="text-[13px] text-slate-600">{selected.desc}</p>
            <div className="grid grid-cols-2 gap-2 my-3">
              <div className="bg-slate-50 border border-[#e3e9f2] rounded-lg px-3 py-2">
                <b className="block font-mono text-[16px] font-semibold tabular-nums">{live?.count ?? '…'}</b>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">{live?.sub ?? ''}</span>
              </div>
              {(live?.extra || []).map(([v, l]) => l && (
                <div key={l} className="bg-slate-50 border border-[#e3e9f2] rounded-lg px-3 py-2">
                  <b className="block font-mono text-[16px] font-semibold tabular-nums">{v}</b>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">{l}</span>
                </div>
              ))}
            </div>
            <h4 className="text-[10.5px] text-slate-400 uppercase tracking-[.11em] mt-3 mb-1.5 font-semibold">Принимает</h4>
            {selected.inp.map(i => <div key={i} className="text-[12.5px] text-slate-500">← <b className="text-slate-800 font-semibold">{i}</b></div>)}
            <h4 className="text-[10.5px] text-slate-400 uppercase tracking-[.11em] mt-3 mb-1.5 font-semibold">Отдаёт</h4>
            {selected.out.map(o => <div key={o} className="text-[12.5px] text-slate-500">→ <b className="text-slate-800 font-semibold">{o}</b></div>)}
            <h4 className="text-[10.5px] text-slate-400 uppercase tracking-[.11em] mt-3 mb-1.5 font-semibold">Последние события</h4>
            {nodeEvents.length === 0 && <p className="text-xs text-slate-400">свежих событий этого узла в ленте нет</p>}
            {nodeEvents.map((e, i) => (
              <div key={i} className="border-l-2 border-[#e3e9f2] pl-2.5 py-1 mb-1.5">
                <time className="font-mono text-[10px] text-slate-400">{fmtTime(e.at)}</time>
                <p className="text-[12.5px] text-slate-500">{(e.summary || '').slice(0, 160)}</p>
              </div>
            ))}
            <a href={`/analytics?tab=chronicle`} className="inline-block mt-2 text-[12.5px] font-semibold text-blue-600">Открыть в Хронике →</a>
          </div>
        )
      })()}
    </div>
  )
}
