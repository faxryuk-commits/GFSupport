import { useState, useMemo } from 'react'
import { Search, Users, MessageSquare, Clock, ChevronRight, AlertCircle } from 'lucide-react'
import type { SupportChannel } from '../types'

interface ChannelsListProps {
  channels: SupportChannel[]
  onChannelSelect: (channelId: string) => void
  onRefresh: () => void
}

export function ChannelsList({ channels, onChannelSelect, onRefresh }: ChannelsListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread' | 'awaiting'>('all')
  
  // Filter and sort channels
  const filteredChannels = useMemo(() => {
    let result = channels
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(ch => 
        ch.name.toLowerCase().includes(query) ||
        ch.companyName?.toLowerCase().includes(query)
      )
    }
    
    // Apply status filter
    if (filter === 'unread') {
      result = result.filter(ch => ch.unreadCount > 0)
    } else if (filter === 'awaiting') {
      result = result.filter(ch => ch.awaitingReply)
    }
    
    // Sort by last message (newest first)
    return result.sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    )
  }, [channels, searchQuery, filter])
  
  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60 * 60 * 1000) {
      return `${Math.floor(diff / 60000)} мин`
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString('ru-RU', { weekday: 'short' })
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }
  
  // Channel avatar
  const ChannelAvatar = ({ channel }: { channel: SupportChannel }) => {
    if (channel.photoUrl) {
      return (
        <img 
          src={channel.photoUrl} 
          alt={channel.name}
          className="w-12 h-12 rounded-full object-cover"
        />
      )
    }
    
    // Default avatar with initials
    const initials = channel.name.slice(0, 2).toUpperCase()
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 
      'bg-orange-500', 'bg-pink-500', 'bg-teal-500'
    ]
    const colorIndex = channel.name.charCodeAt(0) % colors.length
    
    return (
      <div className={`w-12 h-12 rounded-full ${colors[colorIndex]} flex items-center justify-center text-white font-medium`}>
        {initials}
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск каналов..."
            className="w-full pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>
      
      {/* Filter tabs */}
      <div className="flex gap-2 px-3 py-2 bg-white border-b border-slate-100 overflow-x-auto">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            filter === 'all' 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Все ({channels.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            filter === 'unread' 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Непрочитанные ({channels.filter(c => c.unreadCount > 0).length})
        </button>
        <button
          onClick={() => setFilter('awaiting')}
          className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
            filter === 'awaiting' 
              ? 'bg-orange-100 text-orange-700' 
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Ждут ответа ({channels.filter(c => c.awaitingReply).length})
        </button>
      </div>
      
      {/* Channel list */}
      <div className="flex-1 overflow-auto">
        {filteredChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">Каналы не найдены</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredChannels.map(channel => (
              <button
                key={channel.id}
                onClick={() => onChannelSelect(channel.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left"
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <ChannelAvatar channel={channel} />
                  {channel.awaitingReply && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                      <Clock className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium truncate ${channel.unreadCount > 0 ? 'text-slate-900' : 'text-slate-700'}`}>
                      {channel.name}
                    </span>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {formatTime(channel.lastMessageAt)}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-sm truncate ${channel.unreadCount > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                      {channel.lastSenderName && (
                        <span className="text-slate-400">{channel.lastSenderName}: </span>
                      )}
                      {channel.lastMessagePreview || 'Нет сообщений'}
                    </p>
                    
                    {channel.unreadCount > 0 && (
                      <span className="flex-shrink-0 px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">
                        {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                      </span>
                    )}
                  </div>
                  
                  {/* Company name */}
                  {channel.companyName && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {channel.companyName}
                    </p>
                  )}
                </div>
                
                <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChannelsList
