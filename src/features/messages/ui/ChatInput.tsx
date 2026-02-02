import { useRef } from 'react'
import { Send, Paperclip, Smile, Mic, StopCircle, Sparkles, X, Reply } from 'lucide-react'

interface ReplyData {
  id: string
  text: string
  sender: string
}

interface QuickReply {
  id: string
  label: string
  text: string
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  replyingTo: ReplyData | null
  onCancelReply: () => void
  quickReplies?: QuickReply[]
  showQuickReplies?: boolean
  onToggleQuickReplies?: () => void
  onUseQuickReply?: (text: string) => void
  isRecording?: boolean
  onToggleRecording?: () => void
  disabled?: boolean
}

export function ChatInput({
  value,
  onChange,
  onSend,
  replyingTo,
  onCancelReply,
  quickReplies = [],
  showQuickReplies = false,
  onToggleQuickReplies,
  onUseQuickReply,
  isRecording = false,
  onToggleRecording,
  disabled = false,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="border-t border-slate-200">
      {/* Reply preview */}
      {replyingTo && (
        <div className="px-4 py-2 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Reply className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <div className="text-sm min-w-0">
              <span className="font-medium text-slate-700">Ответ на {replyingTo.sender}</span>
              <p className="text-slate-500 truncate">{replyingTo.text}</p>
            </div>
          </div>
          <button onClick={onCancelReply} className="p-1 hover:bg-slate-200 rounded flex-shrink-0">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Введите сообщение..."
              rows={1}
              disabled={disabled}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none min-h-[48px] max-h-32 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-1">
            {quickReplies.length > 0 && onToggleQuickReplies && (
              <div className="relative">
                <button 
                  onClick={onToggleQuickReplies}
                  className="p-3 hover:bg-slate-100 rounded-xl transition-colors" 
                  title="Быстрые ответы"
                >
                  <Sparkles className="w-5 h-5 text-purple-500" />
                </button>
                {showQuickReplies && onUseQuickReply && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-10">
                    <p className="px-4 py-1 text-xs font-medium text-slate-500">Быстрые ответы</p>
                    {quickReplies.map(qr => (
                      <button
                        key={qr.id}
                        onClick={() => onUseQuickReply(qr.text)}
                        className="w-full text-left px-4 py-2 hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium text-slate-700">{qr.label}</span>
                        <p className="text-xs text-slate-500 truncate">{qr.text}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="p-3 hover:bg-slate-100 rounded-xl transition-colors" title="Прикрепить">
              <Paperclip className="w-5 h-5 text-slate-500" />
            </button>
            <button className="p-3 hover:bg-slate-100 rounded-xl transition-colors" title="Эмодзи">
              <Smile className="w-5 h-5 text-slate-500" />
            </button>
            {onToggleRecording && (
              <button
                onClick={onToggleRecording}
                className={`p-3 rounded-xl transition-colors ${isRecording ? 'bg-red-100 text-red-500' : 'hover:bg-slate-100 text-slate-500'}`}
                title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}
              >
                {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}
            <button 
              onClick={onSend}
              disabled={!value.trim() || disabled}
              className="p-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
