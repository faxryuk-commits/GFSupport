import { Bot, User, Loader2, AlertCircle } from 'lucide-react'
import type { InsightsMessage } from '../model/types'
import { ToolCallCard } from './ToolCallCard'

export function MessageBubble({ message }: { message: InsightsMessage }) {
  if (message.role === 'tool') {
    // Историческое tool-сообщение из БД (просмотр прошлой сессии).
    return (
      <div className="ml-9">
        <ToolCallCard
          call={{
            id: message.id,
            name: message.toolName || 'tool',
            args: message.toolArgs,
            result: message.toolResult,
            durationMs: 0,
          }}
        />
      </div>
    )
  }

  const isUser = message.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? 'bg-slate-900 text-white'
            : 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white'
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`max-w-3xl inline-block px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-slate-900 text-white rounded-tr-sm'
              : message.error
              ? 'bg-rose-50 border border-rose-200 text-rose-700 rounded-tl-sm'
              : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
          }`}
        >
          {message.pending ? (
            <span className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              думаю и собираю данные…
            </span>
          ) : message.error ? (
            <span className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              {message.content}
            </span>
          ) : (
            message.content
          )}
        </div>
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5 max-w-3xl">
            {message.toolCalls.map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
