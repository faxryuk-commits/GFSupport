import { Pin } from 'lucide-react'
import { Avatar } from '@/shared/ui'

export interface ChannelItemData {
  id: string
  name: string
  avatar?: string
  lastMessage: string
  time: string
  unread: number
  status: 'open' | 'pending' | 'resolved'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  assignee?: string
  tags?: string[]
  isPinned?: boolean
  isArchived?: boolean
}

interface ChannelListItemProps {
  channel: ChannelItemData
  isSelected: boolean
  onClick: () => void
}

const statusColors = {
  open: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  resolved: 'bg-slate-100 text-slate-600',
}

const priorityColors = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
}

export function ChannelListItem({ channel, isSelected, onClick }: ChannelListItemProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 transition-colors ${
        isSelected 
          ? 'bg-blue-50 border-l-2 border-l-blue-500' 
          : 'hover:bg-slate-50'
      }`}
    >
      <div className="relative">
        <Avatar name={channel.name} src={channel.avatar} size="md" status={channel.status === 'open' ? 'online' : 'offline'} />
        {channel.isPinned && (
          <Pin className="absolute -top-1 -right-1 w-3.5 h-3.5 text-blue-500 fill-blue-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-medium truncate ${channel.unread > 0 ? 'text-slate-900' : 'text-slate-700'}`}>
            {channel.name}
          </span>
          <span className="text-xs text-slate-400 flex-shrink-0">{channel.time}</span>
        </div>
        <p className={`text-sm truncate mt-0.5 ${channel.unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
          {channel.lastMessage}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusColors[channel.status]}`}>
            {channel.status}
          </span>
          {channel.priority && (
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priorityColors[channel.priority]}`}>
              {channel.priority}
            </span>
          )}
          {channel.tags?.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded">
              {tag}
            </span>
          ))}
        </div>
      </div>
      {channel.unread > 0 && (
        <span className="w-5 h-5 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center flex-shrink-0">
          {channel.unread}
        </span>
      )}
    </div>
  )
}
