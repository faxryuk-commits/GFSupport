import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, MoreHorizontal, Pin, Archive, User, Tag, Phone, Video, AlertCircle } from 'lucide-react'
import { Avatar, EmptyState, Modal, ConfirmDialog, LoadingState } from '@/shared/ui'
import { ChannelListItem, type ChannelItemData } from '@/features/channels/ui'
import { MessageBubble, ChatInput, type MessageData, type AttachedFile } from '@/features/messages/ui'
import { fetchChannels, fetchMessages, sendMessage, markChannelRead } from '@/shared/api'
import type { Channel } from '@/entities/channel'
import type { Message } from '@/entities/message'

// Преобразование данных канала из API в формат UI компонента
function mapChannelToUI(channel: Channel): ChannelItemData {
  const getRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffMins < 1) return 'только что'
    if (diffMins < 60) return `${diffMins}м`
    if (diffHours < 24) return `${diffHours}ч`
    return `${diffDays}д`
  }

  return {
    id: channel.id,
    name: channel.name || channel.companyName || `Канал ${channel.id.slice(0, 6)}`,
    avatar: channel.photoUrl,
    lastMessage: channel.lastMessageText || 'Нет сообщений',
    time: getRelativeTime(channel.lastMessageAt),
    unread: channel.unreadCount || 0,
    status: channel.awaitingReply ? 'open' : 'resolved',
    priority: (channel.unreadCount || 0) > 3 ? 'high' : undefined,
    isPinned: false,
    isArchived: !channel.isActive,
  }
}

// Преобразование сообщения из API в формат UI компонента  
function mapMessageToUI(message: Message): MessageData {
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  // Маппинг типа медиа
  const getMediaType = (mediaType?: string): 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' => {
    switch (mediaType) {
      case 'photo': return 'image'
      case 'video': return 'video'
      case 'video_note': return 'video'
      case 'voice': return 'voice'
      case 'audio': return 'audio'
      case 'sticker': return 'sticker'
      case 'document': return 'document'
      default: return 'document'
    }
  }

  return {
    id: message.id,
    senderName: message.senderName || 'Пользователь',
    senderAvatarUrl: message.senderPhotoUrl,
    text: message.text || '',
    time: formatTime(message.createdAt),
    isClient: message.senderRole === 'client',
    status: message.isRead ? 'read' : 'delivered',
    attachments: message.mediaUrl ? [{
      type: getMediaType(message.mediaType),
      url: message.mediaUrl,
      name: message.mediaType === 'document' ? 'Документ' : undefined,
    }] : undefined,
  }
}

const quickReplies = [
  { id: '1', label: 'Приветствие', text: 'Здравствуйте! Спасибо за обращение. Чем могу помочь?' },
  { id: '2', label: 'Статус заказа', text: 'Сейчас проверю статус вашего заказа. Одну минуту.' },
  { id: '3', label: 'Завершение', text: 'Рад был помочь! Хорошего дня!' },
]

export function ChatsPage() {
  const { id: channelIdFromUrl } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Данные
  const [channels, setChannels] = useState<ChannelItemData[]>([])
  const [selectedChannel, setSelectedChannel] = useState<ChannelItemData | null>(null)
  const [messages, setMessages] = useState<MessageData[]>([])
  
  // Состояния загрузки
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  
  // Ошибки
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  
  // UI состояния
  const [filter, setFilter] = useState<'all' | 'unread' | 'open' | 'pending' | 'resolved'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [messageText, setMessageText] = useState('')
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; sender: string } | null>(null)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showChannelActions, setShowChannelActions] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [isTagModalOpen, setIsTagModalOpen] = useState(false)
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Загрузка каналов при монтировании
  useEffect(() => {
    const loadChannels = async () => {
      try {
        setIsLoadingChannels(true)
        setChannelsError(null)
        const data = await fetchChannels()
        const mappedChannels = data.map(mapChannelToUI)
        setChannels(mappedChannels)
      } catch (error) {
        console.error('Ошибка загрузки каналов:', error)
        setChannelsError('Не удалось загрузить каналы')
      } finally {
        setIsLoadingChannels(false)
      }
    }

    loadChannels()
  }, [])

  // Загрузка сообщений при выборе канала
  const loadMessages = useCallback(async (channelId: string) => {
    try {
      setIsLoadingMessages(true)
      setMessagesError(null)
      const { messages: data } = await fetchMessages(channelId)
      const mappedMessages = data.map(mapMessageToUI)
      setMessages(mappedMessages)
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error)
      setMessagesError('Не удалось загрузить сообщения')
    } finally {
      setIsLoadingMessages(false)
    }
  }, [])

  // Автовыбор канала по ID из URL (для прямых ссылок)
  useEffect(() => {
    if (channelIdFromUrl && channels.length > 0 && !selectedChannel) {
      const channel = channels.find(ch => ch.id === channelIdFromUrl)
      if (channel) {
        setSelectedChannel(channel)
        loadMessages(channel.id)
        // Отмечаем как прочитанный
        if (channel.unread > 0) {
          markChannelRead(channel.id).catch(console.error)
        }
      }
    }
  }, [channelIdFromUrl, channels, selectedChannel, loadMessages])

  // Прокрутка к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const filteredChannels = channels.filter(ch => {
    if (ch.isArchived && filter !== 'all') return false
    const matchesSearch = ch.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filter === 'all' || 
      (filter === 'unread' && ch.unread > 0) ||
      (filter === 'open' && ch.status === 'open') ||
      (filter === 'pending' && ch.status === 'pending') ||
      (filter === 'resolved' && ch.status === 'resolved')
    return matchesSearch && matchesFilter
  }).sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return 0
  })

  const handleSendMessage = async (files?: AttachedFile[]) => {
    // Проверяем что есть текст или файлы
    if ((!messageText.trim() && (!files || files.length === 0)) || !selectedChannel || isSending) return

    const tempId = `temp-${Date.now()}`
    const tempMessage: MessageData = {
      id: tempId,
      senderName: 'Вы',
      text: messageText,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      isClient: false,
      status: 'sent',
      replyTo: replyingTo || undefined
    }

    // Оптимистичное обновление UI
    setMessages(prev => [...prev, tempMessage])
    const textToSend = messageText
    const replyToId = replyingTo?.id
    setMessageText('')
    setReplyingTo(null)
    
    try {
      setIsSending(true)
      
      // Если есть файлы — отправляем с медиа (TODO: реализовать)
      // Пока отправляем только текст
      const sentMessage = await sendMessage(
        selectedChannel.id, 
        textToSend || (files ? '[Файл]' : ''), 
        replyToId ? parseInt(replyToId) : undefined
      )
      
      // Заменяем временное сообщение на реальное
      setMessages(prev => prev.map(m => 
        m.id === tempId ? mapMessageToUI(sentMessage) : m
      ))
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error)
      // Удаляем временное сообщение при ошибке
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setMessageText(textToSend)
      alert('Ошибка отправки сообщения. Попробуйте ещё раз.')
    } finally {
      setIsSending(false)
    }
  }

  const handleSelectChannel = async (channel: ChannelItemData) => {
    setSelectedChannel(channel)
    setMessages([])
    
    // Обновляем URL для возможности шаринга/закладок
    navigate(`/chats/${channel.id}`, { replace: true })
    
    // Загружаем сообщения для выбранного канала
    await loadMessages(channel.id)
    
    // Отмечаем канал как прочитанный
    if (channel.unread > 0) {
      try {
        await markChannelRead(channel.id)
        setChannels(prev => prev.map(ch => 
          ch.id === channel.id ? { ...ch, unread: 0 } : ch
        ))
      } catch (error) {
        console.error('Ошибка отметки канала как прочитанного:', error)
      }
    }
  }

  const handlePinChannel = () => {
    if (selectedChannel) {
      setChannels(prev => prev.map(ch => 
        ch.id === selectedChannel.id ? { ...ch, isPinned: !ch.isPinned } : ch
      ))
      setSelectedChannel(prev => prev ? { ...prev, isPinned: !prev.isPinned } : null)
    }
  }

  const handleArchiveChannel = () => {
    if (selectedChannel) {
      setChannels(prev => prev.map(ch => 
        ch.id === selectedChannel.id ? { ...ch, isArchived: true } : ch
      ))
      setSelectedChannel(null)
      setIsArchiveDialogOpen(false)
    }
  }

  const statusColors = {
    open: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    resolved: 'bg-slate-100 text-slate-600',
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-slate-50">
        {/* Список каналов */}
        <div className="w-[360px] bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-800">Чаты</h2>
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                {channels.filter(c => c.unread > 0).length} непрочитанных
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-1 px-4 py-2 border-b border-slate-100 overflow-x-auto">
            {(['all', 'unread', 'open', 'pending', 'resolved'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  filter === f ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f === 'all' ? 'Все' : f === 'unread' ? 'Непрочитанные' : f === 'open' ? 'Открытые' : f === 'pending' ? 'Ожидают' : 'Решённые'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoadingChannels ? (
              <LoadingState text="Загрузка каналов..." size="md" />
            ) : channelsError ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
                <p className="text-sm text-red-600 text-center">{channelsError}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-3 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  Попробовать снова
                </button>
              </div>
            ) : filteredChannels.length === 0 ? (
              <EmptyState variant="search" title="Не найдено" description="Измените фильтры" size="sm" />
            ) : (
              filteredChannels.map(channel => (
                <ChannelListItem
                  key={channel.id}
                  channel={channel}
                  isSelected={selectedChannel?.id === channel.id}
                  onClick={() => handleSelectChannel(channel)}
                />
              ))
            )}
          </div>
        </div>

        {/* Область чата */}
        {selectedChannel ? (
          <div className="flex-1 flex flex-col bg-white min-w-0">
            {/* Заголовок */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={selectedChannel.name} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-800 truncate">{selectedChannel.name}</h2>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[selectedChannel.status]}`}>
                      {selectedChannel.status === 'open' ? 'Открыт' : selectedChannel.status === 'pending' ? 'Ожидает' : 'Решён'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {selectedChannel.assignee ? `Назначен: ${selectedChannel.assignee}` : 'Не назначен'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handlePinChannel} className={`p-2 rounded-lg transition-colors ${selectedChannel.isPinned ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}>
                  <Pin className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-slate-100 rounded-lg"><Phone className="w-4 h-4 text-slate-500" /></button>
                <button className="p-2 hover:bg-slate-100 rounded-lg"><Video className="w-4 h-4 text-slate-500" /></button>
                <div className="relative">
                  <button onClick={() => setShowChannelActions(!showChannelActions)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <MoreHorizontal className="w-4 h-4 text-slate-500" />
                  </button>
                  {showChannelActions && (
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                      <button onClick={() => setIsAssignModalOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <User className="w-4 h-4" /> Назначить
                      </button>
                      <button onClick={() => setIsTagModalOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <Tag className="w-4 h-4" /> Теги
                      </button>
                      <hr className="my-1" />
                      <button onClick={() => setIsArchiveDialogOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                        <Archive className="w-4 h-4" /> Архивировать
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Сообщения */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {isLoadingMessages ? (
                <LoadingState text="Загрузка сообщений..." size="md" />
              ) : messagesError ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
                  <p className="text-sm text-red-600">{messagesError}</p>
                  <button 
                    onClick={() => loadMessages(selectedChannel.id)}
                    className="mt-3 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    Попробовать снова
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <EmptyState title="Нет сообщений" description="Начните диалог" size="sm" />
              ) : (
                <>
                  <div className="flex items-center justify-center">
                    <span className="px-3 py-1 text-xs text-slate-500 bg-slate-100 rounded-full">Сегодня</span>
                  </div>

                  {messages.map(msg => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onReply={() => setReplyingTo({ id: msg.id, text: msg.text, sender: msg.senderName })}
                      onCopy={() => navigator.clipboard.writeText(msg.text)}
                    />
                  ))}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Ввод сообщения */}
            <ChatInput
              value={messageText}
              onChange={setMessageText}
              onSend={handleSendMessage}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              quickReplies={quickReplies}
              showQuickReplies={showQuickReplies}
              onToggleQuickReplies={() => setShowQuickReplies(!showQuickReplies)}
              onUseQuickReply={(text) => { setMessageText(text); setShowQuickReplies(false) }}
              disabled={isSending}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <EmptyState title="Выберите чат" description="Выберите канал из списка" />
          </div>
        )}
      </div>

      {/* Модальные окна */}
      <Modal isOpen={isAssignModalOpen} onClose={() => setIsAssignModalOpen(false)} title="Назначить" size="sm">
        <div className="space-y-3">
          {['Sarah Jenkins', 'Mike Chen', 'Emily Patel', 'Без назначения'].map(agent => (
            <button key={agent} onClick={() => setIsAssignModalOpen(false)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 rounded-lg">
              {agent !== 'Без назначения' && <Avatar name={agent} size="sm" />}
              {agent === 'Без назначения' && <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center"><User className="w-4 h-4 text-slate-400" /></div>}
              <span className="font-medium text-slate-700">{agent}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal isOpen={isTagModalOpen} onClose={() => setIsTagModalOpen(false)} title="Теги" size="sm">
        <div className="space-y-3">
          {['VIP', 'Заказы', 'Технические', 'Биллинг', 'Срочно'].map(tag => (
            <label key={tag} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 rounded-lg cursor-pointer">
              <input type="checkbox" defaultChecked={selectedChannel?.tags?.includes(tag)} className="w-4 h-4 text-blue-500 rounded" />
              <span className="text-sm text-slate-700">{tag}</span>
            </label>
          ))}
          <button onClick={() => setIsTagModalOpen(false)} className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">
            Сохранить
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={isArchiveDialogOpen}
        onClose={() => setIsArchiveDialogOpen(false)}
        onConfirm={handleArchiveChannel}
        title="Архивировать чат"
        message="Вы уверены? Чат будет перемещён в архив."
        confirmText="Архивировать"
        variant="warning"
      />
    </>
  )
}

