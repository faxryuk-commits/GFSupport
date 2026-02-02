import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, MoreVertical, Phone, Video, Info } from 'lucide-react'
import { MessageItem, type Message } from '@/entities/message'
import { MessageComposer } from '@/features/messages'
import type { Channel } from '@/entities/channel'

interface ChatPanelProps {
  channel: Channel
  messages: Message[]
  onBack?: () => void
  onSendMessage: (text: string, attachments?: File[]) => Promise<void>
  onLoadMore?: () => void
  loading?: boolean
  hasMore?: boolean
}

export function ChatPanel({
  channel,
  messages,
  onBack,
  onSendMessage,
  onLoadMore,
  loading,
  hasMore
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Infinite scroll
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container || loading || !hasMore) return
    
    if (container.scrollTop < 100) {
      onLoadMore?.()
    }
  }

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages)

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 -ml-2 hover:bg-slate-100 rounded-lg lg:hidden"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
        )}

        {/* Avatar */}
        {channel.photoUrl ? (
          <img 
            src={channel.photoUrl} 
            alt={channel.name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-medium">
            {channel.name.charAt(0)}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h2 className="font-medium text-slate-800 truncate">{channel.name}</h2>
          <p className="text-xs text-slate-500">
            {channel.companyName} • {channel.messagesCount} сообщений
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-slate-100 rounded-lg">
            <Info className="w-5 h-5 text-slate-500" />
          </button>
          <button className="p-2 hover:bg-slate-100 rounded-lg">
            <MoreVertical className="w-5 h-5 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 bg-slate-50"
      >
        {/* Load more indicator */}
        {loading && (
          <div className="text-center py-4">
            <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Messages grouped by date */}
        {groupedMessages.map(group => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex items-center justify-center my-4">
              <span className="px-3 py-1 text-xs text-slate-500 bg-white rounded-full shadow-sm">
                {formatDateHeader(group.date)}
              </span>
            </div>

            {/* Messages */}
            {group.messages.map((message, index) => {
              const prevMessage = group.messages[index - 1]
              const showSender = !prevMessage || 
                prevMessage.senderName !== message.senderName ||
                prevMessage.isFromTeam !== message.isFromTeam

              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  showSender={showSender}
                  onReply={() => setReplyTo({ id: message.id, text: message.text })}
                />
              )
            })}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <MessageComposer
        channelId={channel.id}
        onSend={onSendMessage}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  )
}

interface MessageGroup {
  date: string
  messages: Message[]
}

function groupMessagesByDate(messages: Message[]): MessageGroup[] {
  const groups: Map<string, Message[]> = new Map()
  
  messages.forEach(msg => {
    const date = new Date(msg.createdAt).toDateString()
    if (!groups.has(date)) {
      groups.set(date, [])
    }
    groups.get(date)!.push(msg)
  })

  return Array.from(groups.entries()).map(([date, msgs]) => ({
    date,
    messages: msgs
  }))
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня'
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера'
  }
  
  return date.toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  })
}
