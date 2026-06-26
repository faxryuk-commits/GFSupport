import { useState, useMemo } from 'react'
import { Loader2, Send, AlertCircle, Check, Users, MessageSquare } from 'lucide-react'
import { Modal } from '@/shared/ui'
import { createBroadcast } from '@/shared/api'
import type { CustomerHealthRow } from '@/shared/api'
import { BroadcastResponsesModal } from './BroadcastResponsesModal'

interface OutreachModalProps {
  isOpen: boolean
  onClose: () => void
  selectedChannels: CustomerHealthRow[]
}

const TEMPLATES: Array<{ key: string; label: string; text: string }> = [
  {
    key: 'check_in',
    label: 'Стандартный check-in',
    text:
      'Здравствуйте! Хотели поинтересоваться, как у вас дела с использованием платформы. Всё ли в порядке? Если нужна помощь или есть вопросы — мы здесь, напишите.',
  },
  {
    key: 're_engagement',
    label: 'Re-engagement (давно не было активности)',
    text:
      'Здравствуйте! Заметили, что в последнее время от вас давно не было сообщений. Хотели убедиться, что всё работает корректно. Если что-то не так или есть вопросы — дайте знать.',
  },
  {
    key: 'critical',
    label: 'Critical (потенциальный отток)',
    text:
      'Добрый день. Хотим убедиться, что у вас всё хорошо с платформой. Если есть критические проблемы, предложения по улучшению или сомнения — мы готовы их обсудить. Что мы можем сделать, чтобы стало лучше?',
  },
  {
    key: 'sentiment',
    label: 'Sentiment (видим недовольство)',
    text:
      'Здравствуйте! Видим, что в последних обращениях что-то идёт не так. Расскажите, пожалуйста, что вас сейчас беспокоит больше всего — попробуем оперативно решить.',
  },
  {
    key: 'custom',
    label: 'Свой текст',
    text: '',
  },
]

export function OutreachModal({ isOpen, onClose, selectedChannels }: OutreachModalProps) {
  const [templateKey, setTemplateKey] = useState('check_in')
  const [text, setText] = useState(TEMPLATES[0].text)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; id?: string } | null>(null)
  const [responsesModalOpen, setResponsesModalOpen] = useState(false)

  const channelIds = useMemo(() => selectedChannels.map((c) => c.channelId), [selectedChannels])

  function onPickTemplate(key: string) {
    setTemplateKey(key)
    const t = TEMPLATES.find((x) => x.key === key)
    if (t && t.text) setText(t.text)
    if (key === 'custom') setText('')
  }

  async function send() {
    if (!text.trim()) {
      setResult({ ok: false, message: 'Текст сообщения пустой' })
      return
    }
    if (channelIds.length === 0) {
      setResult({ ok: false, message: 'Не выбрано ни одного канала' })
      return
    }
    setSending(true)
    setResult(null)
    try {
      const r = await createBroadcast({
        messageText: text.trim(),
        filterType: 'selected',
        selectedChannels: channelIds,
        sendNow: true,
        messageType: 'outreach',
        notificationType: 'outreach',
        senderType: 'agent',
        senderName: 'Delever Support',
      })
      setResult({
        ok: true,
        id: r.id,
        message: `Запущена рассылка на ${r.recipientsCount || channelIds.length} каналов. ID: ${r.id}`,
      })
    } catch (e: unknown) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : 'Не удалось запустить рассылку',
      })
    } finally {
      setSending(false)
    }
  }

  const previewNames = selectedChannels.slice(0, 5).map((c) => c.channelName || c.channelId)
  const overflow = selectedChannels.length - previewNames.length

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (sending) return
        setResult(null)
        onClose()
      }}
      title={`Outreach · ${selectedChannels.length} ${plural(selectedChannels.length, 'канал', 'канала', 'каналов')}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Получатели */}
        <section className="bg-slate-50 border border-[#e8edf3] rounded-md p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-2">
            <Users className="w-3.5 h-3.5" />
            Получатели
          </div>
          <div className="text-xs text-slate-600 flex flex-wrap gap-1.5">
            {previewNames.map((n, i) => (
              <span key={i} className="inline-block bg-white border border-[#e8edf3] px-2 py-0.5 rounded">
                {n}
              </span>
            ))}
            {overflow > 0 && (
              <span className="inline-block text-slate-500">… и ещё {overflow}</span>
            )}
          </div>
        </section>

        {/* Шаблон */}
        <section>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Шаблон сообщения
          </label>
          <select
            value={templateKey}
            onChange={(e) => onPickTemplate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </section>

        {/* Текст */}
        <section>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Текст сообщения
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-[ui-sans-serif] leading-relaxed"
            placeholder="Введите текст…"
          />
          <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
            <span>{text.length} / 8000</span>
            <span>Отправка через основной Telegram-бот организации</span>
          </div>
        </section>

        {/* Результат */}
        {result && (
          <div
            className={`p-3 rounded-md ${
              result.ok
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-start gap-2 text-sm">
              {result.ok ? (
                <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              )}
              <div>{result.message}</div>
            </div>
            {result.ok && result.id && (
              <button
                onClick={() => setResponsesModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 underline"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Посмотреть, кто ответит (можно вернуться позже)
              </button>
            )}
          </div>
        )}

        <BroadcastResponsesModal
          isOpen={responsesModalOpen}
          onClose={() => setResponsesModalOpen(false)}
          broadcastId={result?.id ?? null}
        />

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-[#e8edf3]">
          <button
            onClick={() => {
              if (sending) return
              setResult(null)
              onClose()
            }}
            disabled={sending}
            className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
          >
            {result?.ok ? 'Закрыть' : 'Отмена'}
          </button>
          {!result?.ok && (
            <button
              onClick={send}
              disabled={sending || !text.trim() || channelIds.length === 0}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Отправить {channelIds.length}{' '}
              {plural(channelIds.length, 'каналу', 'каналам', 'каналам')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
