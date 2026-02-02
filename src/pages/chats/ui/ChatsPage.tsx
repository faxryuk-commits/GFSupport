import { useState, useRef, useEffect } from 'react'
import { Search, MoreHorizontal, Pin, Archive, User, Tag, Phone, Video } from 'lucide-react'
import { Avatar, EmptyState, Modal, ConfirmDialog } from '@/shared/ui'
import { ChannelListItem, type ChannelItemData } from '@/features/channels/ui'
import { MessageBubble, ChatInput, type MessageData } from '@/features/messages/ui'

// Mock data
const mockChannels: ChannelItemData[] = [
  { id: '1', name: 'Brasserie x Delever', lastMessage: 'Нужна помощь с заказом...', time: '2м', unread: 1, status: 'open', priority: 'high', isPinned: true, tags: ['VIP', 'Заказы'] },
  { id: '2', name: 'TechCorp Solutions', lastMessage: 'Проблема с заказом #12345', time: '5м', unread: 3, status: 'open', priority: 'urgent', tags: ['Технические'] },
  { id: '3', name: 'Global Finance', lastMessage: 'Платёж не проходит', time: '1ч', unread: 0, status: 'pending', assignee: 'Sarah J.' },
  { id: '4', name: 'StartupXYZ', lastMessage: 'Спасибо за помощь!', time: '2ч', unread: 0, status: 'resolved' },
  { id: '5', name: 'Enterprise Inc', lastMessage: 'Вопрос по биллингу', time: '3ч', unread: 2, status: 'open', priority: 'normal' },
]

const mockMessages: MessageData[] = [
  { id: '1', senderName: 'Brasserie x Delever', text: 'Здравствуйте, можно узнать статус заказа #98765?', time: '10:15', isClient: true },
  { id: '2', senderName: 'Sarah Jenkins', text: 'Добрый день! Сейчас проверю информацию по вашему заказу.', time: '10:16', isClient: false, status: 'read' },
  { id: '3', senderName: 'Brasserie x Delever', text: 'Спасибо, ждём. Клиенты спрашивают про специальное меню.', time: '10:17', isClient: true },
  { id: '4', senderName: 'Sarah Jenkins', text: 'Вижу заказ. Была небольшая задержка из-за погодных условий. Хорошая новость - заказ уже в пути и будет доставлен сегодня до 14:00.', time: '10:18', isClient: false, status: 'read' },
  { id: '5', senderName: 'Brasserie x Delever', text: 'Отлично! Можете прислать ссылку для отслеживания?', time: '10:19', isClient: true },
]

const quickReplies = [
  { id: '1', label: 'Приветствие', text: 'Здравствуйте! Спасибо за обращение. Чем могу помочь?' },
  { id: '2', label: 'Статус заказа', text: 'Сейчас проверю статус вашего заказа. Одну минуту.' },
  { id: '3', label: 'Завершение', text: 'Рад был помочь! Хорошего дня!' },
]

export function ChatsPage() {
  const [channels, setChannels] = useState(mockChannels)
  const [selectedChannel, setSelectedChannel] = useState<ChannelItemData | null>(mockChannels[0])
  const [messages, setMessages] = useState(mockMessages)
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

  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedChannel) return

    const newMessage: MessageData = {
      id: Date.now().toString(),
      senderName: 'Вы',
      text: messageText,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      isClient: false,
      status: 'sent',
      replyTo: replyingTo || undefined
    }

    setMessages(prev => [...prev, newMessage])
    setMessageText('')
    setReplyingTo(null)
    
    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === newMessage.id ? { ...m, status: 'delivered' } : m))
    }, 1000)
  }

  const handleSelectChannel = (channel: ChannelItemData) => {
    setSelectedChannel(channel)
    setChannels(prev => prev.map(ch => ch.id === channel.id ? { ...ch, unread: 0 } : ch))
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
        {/* Channels List */}
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
            {filteredChannels.length === 0 ? (
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

        {/* Chat Area */}
        {selectedChannel ? (
          <div className="flex-1 flex flex-col bg-white min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={selectedChannel.name} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-800 truncate">{selectedChannel.name}</h2>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[selectedChannel.status]}`}>
                      {selectedChannel.status}
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

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
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
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <EmptyState title="Выберите чат" description="Выберите канал из списка" />
          </div>
        )}
      </div>

      {/* Modals */}
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
