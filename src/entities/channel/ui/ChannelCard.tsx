import { MessageSquare, Clock, AlertCircle } from 'lucide-react'
import type { Channel } from '../model'

interface ChannelCardProps {
  channel: Channel
  isSelected?: boolean
  onClick?: () => void
}

export function ChannelCard({ channel, isSelected, onClick }: ChannelCardProps) {
  const waitingTime = channel.lastClientMessageAt 
    ? getWaitingTime(channel.lastClientMessageAt)
    : null

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected 
          ? 'bg-blue-50 border-blue-200 border' 
          : 'hover:bg-slate-50 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative">
          {channel.photoUrl ? (
            <img 
              src={channel.photoUrl} 
              alt={channel.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-slate-500" />
            </div>
          )}
          {channel.awaitingReply && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-800 truncate">{channel.name}</h3>
            {channel.unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-500 text-white rounded-full">
                {channel.unreadCount}
              </span>
            )}
          </div>
          
          <p className="text-sm text-slate-500 truncate mt-0.5">
            {channel.lastMessageText || 'Нет сообщений'}
          </p>

          <div className="flex items-center gap-2 mt-1">
            {/* Type badge */}
            <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeBadgeColor(channel.type)}`}>
              {getTypeLabel(channel.type)}
            </span>

            {/* Waiting time */}
            {channel.awaitingReply && waitingTime && (
              <span className={`text-xs flex items-center gap-1 ${
                waitingTime.isOverdue ? 'text-red-600' : 'text-orange-600'
              }`}>
                <Clock className="w-3 h-3" />
                {waitingTime.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function getTypeBadgeColor(type: Channel['type']): string {
  switch (type) {
    case 'client': return 'bg-blue-100 text-blue-700'
    case 'partner': return 'bg-purple-100 text-purple-700'
    case 'internal': return 'bg-slate-100 text-slate-700'
    default: return 'bg-slate-100 text-slate-700'
  }
}

function getTypeLabel(type: Channel['type']): string {
  switch (type) {
    case 'client': return 'Клиент'
    case 'partner': return 'Партнёр'
    case 'internal': return 'Внутр.'
    default: return type
  }
}

function getWaitingTime(lastClientMessageAt: string): { text: string; isOverdue: boolean } {
  const diff = Date.now() - new Date(lastClientMessageAt).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  
  const isOverdue = minutes > 5 // SLA: 5 минут
  
  if (hours > 0) {
    return { text: `${hours}ч ${minutes % 60}м`, isOverdue }
  }
  return { text: `${minutes}м`, isOverdue }
}
