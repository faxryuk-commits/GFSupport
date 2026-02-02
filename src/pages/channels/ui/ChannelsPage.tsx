import { useState } from 'react'
import { useChannels, useMessages } from '@/shared/hooks'
import { ChannelsList } from '@/features/channels'
import { ChatPanel } from '@/widgets/chat-panel'
import type { Channel } from '@/entities/channel'

export function ChannelsPage() {
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  
  const { 
    channels, 
    loading: channelsLoading, 
    refresh: refreshChannels,
    markAsRead 
  } = useChannels()
  
  const { 
    messages, 
    loading: messagesLoading,
    hasMore,
    loadMore,
    send: sendMessage 
  } = useMessages(selectedChannel?.id || null)

  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel)
    if (channel.unreadCount > 0) {
      markAsRead(channel.id)
    }
  }

  const handleSendMessage = async (text: string, attachments?: File[]) => {
    await sendMessage(text, attachments)
  }

  return (
    <div className="flex h-full">
      {/* Channels list */}
      <div className={`w-80 border-r border-slate-200 bg-white flex-shrink-0 
        ${selectedChannel ? 'hidden lg:flex lg:flex-col' : 'flex flex-col'}`}
      >
        <ChannelsList
          channels={channels}
          selectedId={selectedChannel?.id}
          onSelect={handleSelectChannel}
          onRefresh={refreshChannels}
          loading={channelsLoading}
        />
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col">
        {selectedChannel ? (
          <ChatPanel
            channel={selectedChannel}
            messages={messages}
            onBack={() => setSelectedChannel(null)}
            onSendMessage={handleSendMessage}
            onLoadMore={loadMore}
            loading={messagesLoading}
            hasMore={hasMore}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-200 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-700">Выберите канал</h3>
              <p className="text-sm text-slate-500 mt-1">
                Выберите канал из списка слева, чтобы начать общение
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
