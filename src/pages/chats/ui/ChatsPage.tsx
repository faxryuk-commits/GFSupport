import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, MoreHorizontal, Pin, Archive, User, Tag, Phone, Video, AlertCircle, Sparkles, Brain, ClipboardList } from 'lucide-react'
import { Avatar, EmptyState, Modal, ConfirmDialog, LoadingState, useNotification } from '@/shared/ui'
import { ChannelListItem, type ChannelItemData } from '@/features/channels/ui'
import { MessageBubble, ChatInput, type MessageData, type AttachedFile, type MentionUser, type MessageReaction } from '@/features/messages/ui'
import { AIContextPanel } from '@/features/ai-assistant/ui'
import { CommitmentsPanel } from '@/features/commitments/ui'
import { fetchChannels, fetchMessages, sendMessage, markChannelRead, fetchAIContext, getQuickSuggestions, fetchAgents, type AISuggestion, type AIContext } from '@/shared/api'
import { useAuth } from '@/shared/hooks/useAuth'
import type { Channel } from '@/entities/channel'
import type { Message } from '@/entities/message'
import type { Agent } from '@/entities/agent'

// Форматирование размера файла
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Форматирование даты для разделителя (Сегодня, Вчера, дата)
function formatDateDivider(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  const isToday = date.toDateString() === today.toDateString()
  const isYesterday = date.toDateString() === yesterday.toDateString()
  
  if (isToday) return 'Сегодня'
  if (isYesterday) return 'Вчера'
  
  return date.toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  })
}

// Получить дату без времени для группировки
function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString()
}

// Компонент разделителя по дате
function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-center my-4">
      <div className="px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-full shadow-sm">
        {formatDateDivider(date)}
      </div>
    </div>
  )
}

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
    // Use proxy URL to avoid expired Telegram URLs
    avatar: channel.id ? `/api/support/media/photo?channelId=${channel.id}` : channel.photoUrl,
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

  // Преобразование реакций из { emoji: [users] } в MessageReaction[]
  const mapReactions = (reactions?: Record<string, string[]>): MessageReaction[] | undefined => {
    if (!reactions || typeof reactions !== 'object') return undefined
    const result: MessageReaction[] = []
    for (const [emoji, users] of Object.entries(reactions)) {
      if (Array.isArray(users) && users.length > 0) {
        result.push({
          emoji,
          count: users.length,
          users,
          isOwn: users.includes('Support') || users.includes('Вы')
        })
      }
    }
    return result.length > 0 ? result : undefined
  }

  return {
    id: message.id,
    telegramMessageId: message.telegramMessageId,
    senderName: message.senderName || 'Пользователь',
    senderAvatarUrl: message.senderPhotoUrl,
    text: message.text || '',
    time: formatTime(message.createdAt),
    date: message.createdAt, // ISO date для группировки по дням
    isClient: message.senderRole === 'client',
    status: message.isRead ? 'read' : 'delivered',
    // Reply/цитирование
    replyTo: message.replyToMessageId && message.replyToText ? {
      id: String(message.replyToMessageId),
      telegramMessageId: message.replyToMessageId,
      text: message.replyToText,
      sender: message.replyToSender || 'Пользователь'
    } : undefined,
    attachments: message.mediaUrl ? [{
      type: getMediaType(message.mediaType),
      url: message.mediaUrl,
      name: message.mediaType === 'document' ? 'Документ' : undefined,
    }] : undefined,
    reactions: mapReactions(message.reactions as Record<string, string[]>),
  }
}

// Default quick replies (fallback)
const defaultQuickReplies = [
  { id: '1', label: 'Приветствие', text: 'Здравствуйте! Спасибо за обращение. Чем могу помочь?', source: 'template' as const },
  { id: '2', label: 'Статус заказа', text: 'Сейчас проверю статус вашего заказа. Одну минуту.', source: 'template' as const },
  { id: '3', label: 'Завершение', text: 'Рад был помочь! Хорошего дня!', source: 'template' as const },
]

export function ChatsPage() {
  const { id: channelIdFromPath } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { agent } = useAuth()
  const { showNotification } = useNotification()
  
  // Channel ID можно передать через URL path (/chats/:id) или query param (?channel=xxx)
  const channelIdFromUrl = channelIdFromPath || searchParams.get('channel') || undefined
  
  // Имя текущего агента для отправки сообщений
  const currentAgentName = agent?.name || 'Support'

  // Данные
  const [channels, setChannels] = useState<ChannelItemData[]>([])
  const [selectedChannel, setSelectedChannel] = useState<ChannelItemData | null>(null)
  const [messages, setMessages] = useState<MessageData[]>([])
  const [aiContext, setAiContext] = useState<AIContext | null>(null)
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>(defaultQuickReplies)
  const [agents, setAgents] = useState<Agent[]>([])
  
  // Состояния загрузки
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isLoadingAI, setIsLoadingAI] = useState(false)
  
  // Lazy loading состояния
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const MESSAGES_LIMIT = 100
  
  // Ошибки
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  
  // Участники для @ упоминаний
  const [channelMembers, setChannelMembers] = useState<MentionUser[]>([])
  
  // UI состояния
  const [filter, setFilter] = useState<'all' | 'unread' | 'open' | 'pending' | 'resolved'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [messageText, setMessageText] = useState('')
  const [replyingTo, setReplyingTo] = useState<{ id: string; telegramMessageId?: number; text: string; sender: string } | null>(null)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showChannelActions, setShowChannelActions] = useState(false)
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [showCommitmentsPanel, setShowCommitmentsPanel] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [isTagModalOpen, setIsTagModalOpen] = useState(false)
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Загрузка каналов
  const loadChannels = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsLoadingChannels(true)
        setChannelsError(null)
      }
      
      const channelsData = await fetchChannels()
      const mappedChannels = channelsData.map(mapChannelToUI)
      setChannels(mappedChannels)
    } catch (error) {
      if (!silent) {
        console.error('Ошибка загрузки каналов:', error)
        setChannelsError('Не удалось загрузить каналы')
      }
    } finally {
      if (!silent) setIsLoadingChannels(false)
    }
  }, [])

  // Загрузка каналов и агентов при монтировании
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoadingChannels(true)
        setChannelsError(null)
        
        // Load channels and agents in parallel
        const [channelsData, agentsData] = await Promise.all([
          fetchChannels(),
          fetchAgents().catch(() => []) // Don't fail if agents can't load
        ])
        
        const mappedChannels = channelsData.map(mapChannelToUI)
        setChannels(mappedChannels)
        setAgents(agentsData)
      } catch (error) {
        console.error('Ошибка загрузки каналов:', error)
        setChannelsError('Не удалось загрузить каналы')
      } finally {
        setIsLoadingChannels(false)
      }
    }

    loadData()
  }, [])

  // Запрос разрешения на browser notifications
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Real-time polling: обновление каналов каждые 3 секунды
  useEffect(() => {
    const pollChannels = async () => {
      try {
        const channelsData = await fetchChannels()
        const mappedChannels = channelsData.map(mapChannelToUI)
        
        // Проверяем появились ли новые непрочитанные (для уведомления)
        const oldTotalUnread = channels.reduce((sum, ch) => sum + (ch.unread || 0), 0)
        const newTotalUnread = mappedChannels.reduce((sum, ch) => sum + (ch.unread || 0), 0)
        
        if (newTotalUnread > oldTotalUnread && document.visibilityState === 'hidden') {
          // Browser notification когда вкладка скрыта
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Новые сообщения', {
              body: `У вас ${newTotalUnread - oldTotalUnread} новых сообщений`,
              icon: '/favicon.ico',
              tag: 'unread-channels',
            })
          }
        }
        
        setChannels(mappedChannels)
      } catch (error) {
        console.error('Polling channels error:', error)
      }
    }

    // При возврате на вкладку - мгновенное обновление
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollChannels()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const pollInterval = setInterval(pollChannels, 3000)

    return () => {
      clearInterval(pollInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [channels])

  // Глобальный обработчик Escape - выход из режима ответа/цитирования
  useEffect(() => {
    const handleGlobalEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (replyingTo) {
          setReplyingTo(null)
        }
        if (showQuickReplies) {
          setShowQuickReplies(false)
        }
        if (showChannelActions) {
          setShowChannelActions(false)
        }
      }
    }
    
    document.addEventListener('keydown', handleGlobalEscape)
    return () => document.removeEventListener('keydown', handleGlobalEscape)
  }, [replyingTo, showQuickReplies, showChannelActions])

  // Real-time polling: обновление сообщений каждые 2 секунды при открытом чате
  useEffect(() => {
    if (!selectedChannel) return
    if (messages.length === 0) return // Ждем первичной загрузки

    const pollMessages = async () => {
      try {
        // Получаем timestamp последнего сообщения для запроса только новых
        const lastMessage = messages[messages.length - 1]
        const since = lastMessage?.date // ISO timestamp

        // Запрашиваем только новые сообщения после последнего
        const { messages: newData } = await fetchMessages(
          selectedChannel.id, 
          50, // меньший лимит для polling
          { since }
        )
        
        if (newData.length > 0) {
          const newMappedMessages = newData.map(mapMessageToUI)
          
          // Фильтруем только реально новые сообщения (которых нет в текущем списке)
          const existingIds = new Set(messages.map(m => m.id))
          const trulyNewMessages = newMappedMessages.filter(m => !existingIds.has(m.id))
          
          if (trulyNewMessages.length > 0) {
            // Показываем уведомления о новых сообщениях от клиентов
            const clientMessages = trulyNewMessages.filter(m => m.isClient)
            
            if (clientMessages.length > 0) {
              // In-app уведомление
              clientMessages.forEach(msg => {
                showNotification({
                  type: 'message',
                  title: 'Новое сообщение',
                  message: msg.text || '[Медиа]',
                  senderName: msg.senderName,
                  senderAvatar: msg.senderAvatarUrl || undefined,
                  channelName: selectedChannel.name,
                  channelId: selectedChannel.id,
                  onClick: () => {
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }
                })
              })
              
              // Browser notification когда вкладка скрыта
              if (document.visibilityState === 'hidden' && 
                  'Notification' in window && Notification.permission === 'granted') {
                clientMessages.forEach(msg => {
                  new Notification(`${selectedChannel.name}: ${msg.senderName}`, {
                    body: msg.text || '[Медиа]',
                    icon: '/favicon.ico',
                    tag: `msg-${msg.id}`,
                  })
                })
              }
            }

            // Добавляем новые сообщения в конец
            setMessages(prev => [...prev, ...trulyNewMessages])
            
            // Прокрутка к новому сообщению если вкладка активна
            if (document.visibilityState === 'visible') {
              setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
              }, 100)
            }
          }
        }
      } catch (error) {
        console.error('Polling messages error:', error)
      }
    }

    // При возврате на вкладку - мгновенное обновление
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollMessages()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Быстрый polling каждые 2 секунды для актуальности данных
    const pollInterval = setInterval(pollMessages, 2000)

    return () => {
      clearInterval(pollInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [selectedChannel, messages, showNotification])

  // Загрузка AI контекста для канала
  const loadAIContext = useCallback(async (channelId: string) => {
    try {
      setIsLoadingAI(true)
      const context = await fetchAIContext(channelId)
      setAiContext(context)
      
      // Обновляем подсказки
      if (context?.suggestions && context.suggestions.length > 0) {
        setAiSuggestions(context.suggestions)
      } else {
        // Получаем подсказки по категории последнего сообщения
        const lastMessage = messages[messages.length - 1]
        const category = (lastMessage as any)?.aiCategory
        setAiSuggestions(getQuickSuggestions(category))
      }
    } catch (error) {
      console.error('Ошибка загрузки AI контекста:', error)
      setAiSuggestions(defaultQuickReplies)
    } finally {
      setIsLoadingAI(false)
    }
  }, [messages])

  // Загрузка сообщений при выборе канала (последние сообщения)
  const loadMessages = useCallback(async (channelId: string) => {
    try {
      setIsLoadingMessages(true)
      setMessagesError(null)
      setHasMoreMessages(true)
      
      const { messages: data, hasMore } = await fetchMessages(channelId, MESSAGES_LIMIT)
      const mappedMessages = data.map(mapMessageToUI)
      setMessages(mappedMessages)
      setHasMoreMessages(hasMore ?? data.length >= MESSAGES_LIMIT)
      
      // Загружаем AI контекст параллельно (не блокируем UI)
      loadAIContext(channelId)
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error)
      setMessagesError('Не удалось загрузить сообщения')
    } finally {
      setIsLoadingMessages(false)
    }
  }, [loadAIContext])

  // Загрузка старых сообщений при скролле вверх (cursor-based)
  const loadMoreMessages = useCallback(async () => {
    if (!selectedChannel || isLoadingMore || !hasMoreMessages || messages.length === 0) return
    
    try {
      setIsLoadingMore(true)
      
      // Получаем timestamp самого старого сообщения
      const oldestMessage = messages[0]
      const before = oldestMessage?.date // ISO timestamp
      
      const { messages: data, hasMore } = await fetchMessages(
        selectedChannel.id, 
        MESSAGES_LIMIT,
        { before }
      )
      
      if (data.length > 0) {
        const mappedMessages = data.map(mapMessageToUI)
        // Добавляем старые сообщения в начало
        setMessages(prev => [...mappedMessages, ...prev])
      }
      
      setHasMoreMessages(hasMore ?? data.length >= MESSAGES_LIMIT)
    } catch (error) {
      console.error('Ошибка загрузки старых сообщений:', error)
    } finally {
      setIsLoadingMore(false)
    }
  }, [selectedChannel, isLoadingMore, hasMoreMessages, messages])

  // Обработчик скролла для lazy loading
  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget
    // Если прокрутили близко к верху (< 100px) - загружаем старые сообщения
    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
      loadMoreMessages()
    }
  }, [hasMoreMessages, isLoadingMore, loadMoreMessages])

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
    const hasFiles = files && files.length > 0
    const textToSend = messageText.trim()
    const replyToTgId = replyingTo?.telegramMessageId
    
    // Очищаем поле ввода сразу
    setMessageText('')
    setReplyingTo(null)
    
    try {
      setIsSending(true)
      
      // Если есть файлы — отправляем их
      if (hasFiles) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const isLastFile = i === files.length - 1
          const caption = isLastFile ? textToSend : '' // Текст только с последним файлом
          
          // Временное сообщение для файла
          const tempFileId = `temp-file-${Date.now()}-${i}`
          const tempFileMessage: MessageData = {
            id: tempFileId,
            senderName: currentAgentName,
            text: caption || `[${file.type === 'image' ? 'Изображение' : 'Файл'}]`,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toISOString(),
            isClient: false,
            status: 'sent',
            attachments: [{
              type: file.type as any,
              url: file.preview || '',
              name: file.file.name,
              size: formatFileSize(file.file.size)
            }]
          }
          
          setMessages(prev => [...prev, tempFileMessage])
          
          // Отправляем файл
          const { sendMediaMessage } = await import('@/shared/api/messages')
          const sentMessage = await sendMediaMessage(
            selectedChannel.id,
            file.file,
            caption,
            currentAgentName
          )
          
          // Заменяем временное сообщение на реальное
          setMessages(prev => prev.map(m => 
            m.id === tempFileId ? mapMessageToUI(sentMessage) : m
          ))
        }
      } else if (textToSend) {
        // Только текст без файлов
        const tempMessage: MessageData = {
          id: tempId,
          senderName: currentAgentName,
          text: textToSend,
          time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString(),
          isClient: false,
          status: 'sent',
          replyTo: replyingTo || undefined
        }
        
        setMessages(prev => [...prev, tempMessage])
        
        const sentMessage = await sendMessage(
          selectedChannel.id, 
          textToSend, 
          replyToTgId,
          currentAgentName
        )
        
        setMessages(prev => prev.map(m => 
          m.id === tempId ? mapMessageToUI(sentMessage) : m
        ))
      }
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error)
      // Удаляем временные сообщения при ошибке
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')))
      setMessageText(textToSend)
      alert('Ошибка отправки. Попробуйте ещё раз.')
    } finally {
      setIsSending(false)
    }
  }

  const handleSelectChannel = async (channel: ChannelItemData) => {
    setSelectedChannel(channel)
    setMessages([])
    setChannelMembers([])
    
    // Обновляем URL для возможности шаринга/закладок
    navigate(`/chats/${channel.id}`, { replace: true })
    
    // Загружаем сообщения и участников параллельно
    const [, membersResult] = await Promise.all([
      loadMessages(channel.id),
      // Загрузка участников для @ упоминаний
      fetch(`/api/support/channels/members?channelId=${channel.id}`)
        .then(r => r.json())
        .catch(() => ({ members: [] }))
    ])
    
    console.log('[ChatsPage] Members result:', membersResult)
    if (membersResult?.members && Array.isArray(membersResult.members)) {
      const mapped = membersResult.members.map((m: any) => ({
        id: m.id,
        name: m.name,
        username: m.username,
        role: m.role,
        avatarUrl: m.avatarUrl
      }))
      console.log('[ChatsPage] Setting channel members:', mapped.length, 'users')
      setChannelMembers(mapped)
    } else {
      console.log('[ChatsPage] No members in result or invalid format')
    }
    
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
          <>
          <div className="flex-1 flex flex-col bg-white min-w-0">
            {/* Заголовок */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar src={selectedChannel.avatar} name={selectedChannel.name} size="md" />
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
                <button 
                  onClick={() => setShowAIPanel(!showAIPanel)} 
                  className={`p-2 rounded-lg transition-colors ${showAIPanel ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}
                  title="AI Контекст"
                >
                  <Brain className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setShowCommitmentsPanel(!showCommitmentsPanel)} 
                  className={`p-2 rounded-lg transition-colors ${showCommitmentsPanel ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}
                  title="Обязательства"
                >
                  <ClipboardList className="w-4 h-4" />
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
            <div 
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-6 space-y-4"
              onScroll={handleMessagesScroll}
            >
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
                  {/* Индикатор загрузки старых сообщений */}
                  {hasMoreMessages && (
                    <div className="flex items-center justify-center py-2">
                      {isLoadingMore ? (
                        <div className="flex items-center gap-2 text-slate-500 text-sm">
                          <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                          Загрузка истории...
                        </div>
                      ) : (
                        <button
                          onClick={loadMoreMessages}
                          className="px-4 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors"
                        >
                          Загрузить старые сообщения
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-center">
                    <span className="px-3 py-1 text-xs text-slate-500 bg-slate-100 rounded-full">
                      {messages.length} сообщений за 90 дней
                    </span>
                  </div>

                  {/* Сообщения с разделителями по датам */}
                  {messages.map((msg, index) => {
                    // Показываем разделитель если это первое сообщение или дата изменилась
                    const prevMsg = index > 0 ? messages[index - 1] : null
                    const showDateDivider = !prevMsg || (msg.date && prevMsg.date && getDateKey(msg.date) !== getDateKey(prevMsg.date))
                    
                    return (
                      <div key={msg.id} id={`message-${msg.id}`} className="transition-all duration-300 rounded-lg">
                        {showDateDivider && msg.date && <DateDivider date={msg.date} />}
                        <MessageBubble
                          message={msg}
                          onReply={() => setReplyingTo({ 
                            id: msg.id, 
                            telegramMessageId: msg.telegramMessageId,
                            text: msg.text, 
                            sender: msg.senderName 
                          })}
                          onCopy={() => navigator.clipboard.writeText(msg.text)}
                          onReaction={async (emoji) => {
                        if (!selectedChannel) return
                        try {
                          const token = localStorage.getItem('support_agent_token') || ''
                          await fetch('/api/support/messages/reaction', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                            },
                            body: JSON.stringify({ 
                              messageId: msg.id, 
                              emoji,
                              channelId: selectedChannel.id 
                            })
                          })
                          // Оптимистичное обновление
                          setMessages(prev => prev.map(m => {
                            if (m.id !== msg.id) return m
                            const reactions = [...(m.reactions || [])]
                            const existing = reactions.find(r => r.emoji === emoji)
                            if (existing) {
                              if (existing.isOwn) {
                                // Remove own reaction
                                existing.count--
                                existing.isOwn = false
                                if (existing.count <= 0) {
                                  return { ...m, reactions: reactions.filter(r => r.emoji !== emoji) }
                                }
                              } else {
                                // Add own reaction
                                existing.count++
                                existing.isOwn = true
                              }
                            } else {
                              reactions.push({ emoji, count: 1, isOwn: true, users: ['Support'] })
                            }
                            return { ...m, reactions }
                          }))
                        } catch (e) {
                          console.error('Ошибка реакции:', e)
                        }
                      }}
                      onDelete={async () => {
                        if (!confirm('Удалить сообщение?')) return
                        try {
                          const token = localStorage.getItem('support_agent_token') || ''
                          await fetch('/api/support/messages/delete', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`
                            },
                            body: JSON.stringify({ messageId: msg.id })
                          })
                          setMessages(prev => prev.filter(m => m.id !== msg.id))
                        } catch (e) {
                          console.error('Ошибка удаления:', e)
                        }
                      }}
                      onScrollToMessage={(targetId) => {
                        // Найти элемент сообщения и прокрутить к нему
                        const targetMsg = messages.find(m => m.id === targetId)
                        if (targetMsg) {
                          const element = document.getElementById(`message-${targetId}`)
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            // Подсветка сообщения
                            element.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2')
                            setTimeout(() => {
                              element.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2')
                            }, 2000)
                          }
                        }
                      }}
                        />
                      </div>
                    )
                  })}
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
              quickReplies={aiSuggestions}
              showQuickReplies={showQuickReplies}
              onToggleQuickReplies={() => setShowQuickReplies(!showQuickReplies)}
              onUseQuickReply={(text) => { setMessageText(text); setShowQuickReplies(false) }}
              isLoadingAI={isLoadingAI}
              disabled={isSending}
              mentionUsers={channelMembers.length > 0 ? channelMembers : agents.map(a => ({
                id: a.id,
                name: a.name,
                username: a.username,
                role: 'support' as const,
              }))}
            />
          </div>

          {/* Боковые панели AI и Обязательства */}
          {(showAIPanel || showCommitmentsPanel) && (
            <div className="w-80 flex-shrink-0 flex flex-col border-l border-slate-200 bg-white overflow-hidden">
              {showAIPanel && (
                <AIContextPanel
                  channelId={selectedChannel.id}
                  isOpen={showAIPanel}
                  onClose={() => setShowAIPanel(false)}
                  className="flex-1"
                />
              )}
              {showCommitmentsPanel && !showAIPanel && (
                <CommitmentsPanel
                  channelId={selectedChannel.id}
                  className="flex-1 overflow-y-auto"
                />
              )}
            </div>
          )}
        </>
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

