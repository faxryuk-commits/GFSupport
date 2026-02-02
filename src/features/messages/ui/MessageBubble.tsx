import { Check, CheckCheck, Reply, Copy, Forward, Image, File } from 'lucide-react'
import { Avatar } from '@/shared/ui'

export interface MessageData {
  id: string
  senderName: string
  senderAvatarUrl?: string | null
  text: string
  time: string
  isClient: boolean
  status?: 'sent' | 'delivered' | 'read'
  replyTo?: { id: string; text: string; sender: string }
  attachments?: { type: 'image' | 'file'; name: string; url: string; size?: string }[]
}

interface MessageBubbleProps {
  message: MessageData
  onReply: () => void
  onCopy: () => void
}

export function MessageBubble({ message, onReply, onCopy }: MessageBubbleProps) {
  return (
    <div className={`flex ${message.isClient ? 'justify-start' : 'justify-end'} group`}>
      <div className="max-w-[70%]">
        {message.isClient && (
          <div className="flex items-center gap-2 mb-1">
            <Avatar src={message.senderAvatarUrl} name={message.senderName} size="sm" />
            <span className="text-sm font-medium text-slate-700">{message.senderName}</span>
            <span className="text-xs text-slate-400">{message.time}</span>
          </div>
        )}
        
        {/* Reply preview */}
        {message.replyTo && (
          <div className={`px-3 py-1.5 mb-1 border-l-2 ${message.isClient ? 'border-slate-300 bg-slate-50' : 'border-blue-300 bg-blue-50/50'} rounded text-xs`}>
            <span className="font-medium">{message.replyTo.sender}</span>
            <p className="text-slate-600 truncate">{message.replyTo.text}</p>
          </div>
        )}

        <div className="relative">
          <div className={`px-4 py-3 rounded-2xl ${
            message.isClient 
              ? 'bg-slate-100 text-slate-800 rounded-tl-md' 
              : 'bg-blue-500 text-white rounded-tr-md'
          }`}>
            <p className="text-sm whitespace-pre-wrap">{message.text}</p>
            
            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.attachments.map((att, i) => (
                  <a 
                    key={i}
                    href={att.url}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                      message.isClient ? 'bg-white' : 'bg-blue-400/30'
                    }`}
                  >
                    {att.type === 'image' ? <Image className="w-4 h-4" /> : <File className="w-4 h-4" />}
                    <span className="text-sm truncate">{att.name}</span>
                    {att.size && <span className="text-xs opacity-70">{att.size}</span>}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Message actions */}
          <div className={`absolute top-0 ${message.isClient ? 'right-0 translate-x-full' : 'left-0 -translate-x-full'} px-2 opacity-0 group-hover:opacity-100 transition-opacity`}>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg shadow-sm p-1">
              <button onClick={onReply} className="p-1.5 hover:bg-slate-100 rounded" title="Ответить">
                <Reply className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button onClick={onCopy} className="p-1.5 hover:bg-slate-100 rounded" title="Копировать">
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button className="p-1.5 hover:bg-slate-100 rounded" title="Переслать">
                <Forward className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {!message.isClient && (
          <div className="flex items-center justify-end gap-2 mt-1">
            <span className="text-xs text-slate-500">{message.time}</span>
            {message.status === 'sent' && <Check className="w-3.5 h-3.5 text-slate-400" />}
            {message.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5 text-slate-400" />}
            {message.status === 'read' && <CheckCheck className="w-3.5 h-3.5 text-blue-500" />}
          </div>
        )}
      </div>
    </div>
  )
}
