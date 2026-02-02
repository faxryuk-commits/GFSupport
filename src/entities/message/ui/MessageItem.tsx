import { Check, CheckCheck, FileText, Mic, Play } from 'lucide-react'
import type { Message } from '../model'

interface MessageItemProps {
  message: Message
  showSender?: boolean
  onReply?: () => void
  onReact?: (emoji: string) => void
}

export function MessageItem({ message, showSender = true, onReply: _onReply, onReact }: MessageItemProps) {
  const isFromTeam = message.isFromTeam
  
  return (
    <div className={`flex ${isFromTeam ? 'justify-end' : 'justify-start'} mb-2`}>
      <div 
        className={`max-w-[70%] rounded-2xl px-4 py-2 ${
          isFromTeam 
            ? 'bg-blue-500 text-white rounded-br-md' 
            : 'bg-white border border-slate-200 rounded-bl-md'
        }`}
      >
        {/* Sender name */}
        {showSender && !isFromTeam && (
          <div className="text-xs font-medium text-blue-600 mb-1">
            {message.senderName}
          </div>
        )}

        {/* Media */}
        {message.mediaType && message.mediaUrl && (
          <div className="mb-2">
            {renderMedia(message.mediaType, message.mediaUrl)}
          </div>
        )}

        {/* Text */}
        {message.text && (
          <p className={`text-sm whitespace-pre-wrap ${isFromTeam ? 'text-white' : 'text-slate-800'}`}>
            {message.text}
          </p>
        )}

        {/* Footer */}
        <div className={`flex items-center justify-end gap-1 mt-1 ${
          isFromTeam ? 'text-blue-100' : 'text-slate-400'
        }`}>
          <span className="text-xs">
            {formatTime(message.createdAt)}
          </span>
          {isFromTeam && (
            message.isRead 
              ? <CheckCheck className="w-3.5 h-3.5" />
              : <Check className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Reactions */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(message.reactions).map(([emoji, users]) => (
              <button
                key={emoji}
                onClick={() => onReact?.(emoji)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  isFromTeam 
                    ? 'bg-blue-400 hover:bg-blue-300' 
                    : 'bg-slate-100 hover:bg-slate-200'
                }`}
              >
                {emoji} {users.length}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function renderMedia(type: string, url: string) {
  switch (type) {
    case 'photo':
      return (
        <img 
          src={url} 
          alt="Photo" 
          className="max-w-full rounded-lg cursor-pointer hover:opacity-90"
        />
      )
    case 'video':
      return (
        <div className="relative">
          <video src={url} className="max-w-full rounded-lg" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Play className="w-12 h-12 text-white drop-shadow-lg" />
          </div>
        </div>
      )
    case 'voice':
      return (
        <div className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-2">
          <Mic className="w-4 h-4 text-slate-600" />
          <div className="w-32 h-1 bg-slate-300 rounded-full" />
          <span className="text-xs text-slate-500">0:00</span>
        </div>
      )
    case 'document':
      return (
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 hover:bg-slate-200"
        >
          <FileText className="w-5 h-5 text-slate-600" />
          <span className="text-sm text-slate-700">Документ</span>
        </a>
      )
    default:
      return null
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
