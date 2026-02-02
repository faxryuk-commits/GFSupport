import { useState, useRef, useEffect } from 'react'
import { 
  Search, Send, Paperclip, Smile, MoreHorizontal, Sparkles, Phone, Video, 
  Archive, Pin, Trash2, User, Clock, CheckCheck, Check, Image, File,
  Star, Flag, Tag, Copy, Reply, Forward, X, AlertCircle, Mic, StopCircle
} from 'lucide-react'
import { Avatar, Badge, EmptyState, Modal, ConfirmDialog } from '@/shared/ui'

// Types
interface Message {
  id: string
  senderId: string
  senderName: string
  senderAvatar?: string
  text: string
  time: string
  isClient: boolean
  status?: 'sent' | 'delivered' | 'read'
  replyTo?: { id: string; text: string; sender: string }
  attachments?: { type: 'image' | 'file'; name: string; url: string; size?: string }[]
  reactions?: { emoji: string; count: number; reacted: boolean }[]
}

interface Channel {
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

// Mock data
const mockChannels: Channel[] = [
  { id: '1', name: 'Brasserie x Delever', lastMessage: 'Hi, we need help with our latest order...', time: '2m ago', unread: 1, status: 'open', priority: 'high', isPinned: true, tags: ['VIP', 'Orders'] },
  { id: '2', name: 'TechCorp Solutions', lastMessage: 'Order #12345 issue', time: '5m ago', unread: 3, status: 'open', priority: 'urgent', tags: ['Technical'] },
  { id: '3', name: 'Global Finance', lastMessage: 'Payment not going through', time: '1h ago', unread: 0, status: 'pending', assignee: 'Sarah J.' },
  { id: '4', name: 'StartupXYZ', lastMessage: 'Thanks for your help!', time: '2h ago', unread: 0, status: 'resolved' },
  { id: '5', name: 'Enterprise Inc', lastMessage: 'We have a question about billing', time: '3h ago', unread: 2, status: 'open', priority: 'normal' },
  { id: '6', name: 'Local Café', lastMessage: 'Menu update request', time: '5h ago', unread: 0, status: 'open' },
  { id: '7', name: 'City Hospital', lastMessage: 'Urgent delivery needed', time: 'Yesterday', unread: 0, status: 'resolved', isArchived: true },
]

const mockMessages: Message[] = [
  { 
    id: '1', 
    senderId: 'client', 
    senderName: 'Brasserie x Delever', 
    text: 'Hello, I was wondering if I could get an update on the status of our order #98765. It was supposed to arrive yesterday.', 
    time: '10:15 AM', 
    isClient: true 
  },
  { 
    id: '2', 
    senderId: 'agent', 
    senderName: 'Sarah Jenkins', 
    text: "Hi there! I'd be happy to help you with that. Let me just pull up your order details.", 
    time: '10:16 AM', 
    isClient: false,
    status: 'read'
  },
  { 
    id: '3', 
    senderId: 'client', 
    senderName: 'Brasserie x Delever', 
    text: 'Thanks, Sarah. We are eagerly waiting for it. Our customers are asking about the special menu items.', 
    time: '10:17 AM', 
    isClient: true 
  },
  { 
    id: '4', 
    senderId: 'agent', 
    senderName: 'Sarah Jenkins', 
    text: 'I see it here. It looks like there was a slight delay at the shipping center due to weather conditions. The good news is that it is now out for delivery and should arrive by 2 PM today.', 
    time: '10:18 AM', 
    isClient: false,
    status: 'read'
  },
  {
    id: '5',
    senderId: 'client',
    senderName: 'Brasserie x Delever',
    text: 'That\'s a relief! Can you send me the tracking link?',
    time: '10:19 AM',
    isClient: true
  },
  {
    id: '6',
    senderId: 'agent',
    senderName: 'Sarah Jenkins',
    text: 'Of course! Here\'s the tracking information for your order:',
    time: '10:20 AM',
    isClient: false,
    status: 'delivered',
    attachments: [
      { type: 'file', name: 'tracking_info.pdf', url: '#', size: '24 KB' }
    ]
  }
]

const suggestedResponses = [
  "I understand your concern. Let me check on that for you.",
  "Thank you for your patience. I'm looking into this right now.",
  "I apologize for any inconvenience. Here's what I can do to help...",
  "Is there anything else I can assist you with today?",
]

const quickReplies = [
  { id: '1', label: 'Greeting', text: 'Hello! Thank you for contacting support. How can I help you today?' },
  { id: '2', label: 'Order Status', text: 'Let me check the status of your order. One moment please.' },
  { id: '3', label: 'Closing', text: 'Is there anything else I can help you with? Have a great day!' },
  { id: '4', label: 'Escalation', text: 'I understand. Let me escalate this to our senior team for faster resolution.' },
]

export function ChatsPage() {
  const [channels, setChannels] = useState(mockChannels)
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(mockChannels[0])
  const [messages, setMessages] = useState(mockMessages)
  const [filter, setFilter] = useState<'all' | 'unread' | 'open' | 'pending' | 'resolved'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [messageText, setMessageText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showChannelActions, setShowChannelActions] = useState(false)
  const [showMessageActions, setShowMessageActions] = useState<string | null>(null)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [isTagModalOpen, setIsTagModalOpen] = useState(false)
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Filter channels
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

    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'agent',
      senderName: 'You',
      text: messageText,
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      isClient: false,
      status: 'sent',
      replyTo: replyingTo ? { id: replyingTo.id, text: replyingTo.text, sender: replyingTo.senderName } : undefined
    }

    setMessages(prev => [...prev, newMessage])
    setMessageText('')
    setReplyingTo(null)
    
    // Simulate delivery
    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === newMessage.id ? { ...m, status: 'delivered' } : m))
    }, 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handlePinChannel = (channelId: string) => {
    setChannels(prev => prev.map(ch => 
      ch.id === channelId ? { ...ch, isPinned: !ch.isPinned } : ch
    ))
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

  const handleMarkAsRead = (channelId: string) => {
    setChannels(prev => prev.map(ch => 
      ch.id === channelId ? { ...ch, unread: 0 } : ch
    ))
  }

  const handleChangeStatus = (status: Channel['status']) => {
    if (selectedChannel) {
      setChannels(prev => prev.map(ch => 
        ch.id === selectedChannel.id ? { ...ch, status } : ch
      ))
      setSelectedChannel(prev => prev ? { ...prev, status } : null)
    }
  }

  const handleUseSuggestion = (text: string) => {
    setMessageText(text)
    inputRef.current?.focus()
  }

  const handleUseQuickReply = (text: string) => {
    setMessageText(text)
    setShowQuickReplies(false)
    inputRef.current?.focus()
  }

  const priorityColors = {
    low: 'bg-slate-100 text-slate-600',
    normal: 'bg-blue-100 text-blue-600',
    high: 'bg-orange-100 text-orange-600',
    urgent: 'bg-red-100 text-red-600',
  }

  const statusColors = {
    open: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    resolved: 'bg-slate-100 text-slate-600',
  }

  return (
    <>
      <div className="flex h-[calc(100vh-0px)] bg-slate-50">
        {/* Channels List */}
        <div className="w-[360px] bg-white border-r border-slate-200 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-800">Conversations</h2>
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                {channels.filter(c => c.unread > 0).length} unread
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-1 px-4 py-2 border-b border-slate-100 overflow-x-auto">
            {(['all', 'unread', 'open', 'pending', 'resolved'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  filter === f 
                    ? 'bg-blue-500 text-white' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'unread' && channels.filter(c => c.unread > 0).length > 0 && (
                  <span className="ml-1">({channels.filter(c => c.unread > 0).length})</span>
                )}
              </button>
            ))}
          </div>

          {/* Channels */}
          <div className="flex-1 overflow-y-auto">
            {filteredChannels.length === 0 ? (
              <EmptyState 
                variant="search"
                title="No conversations found"
                description="Try adjusting your filters or search query"
                size="sm"
              />
            ) : (
              filteredChannels.map(channel => (
                <div
                  key={channel.id}
                  onClick={() => { setSelectedChannel(channel); handleMarkAsRead(channel.id) }}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 transition-colors ${
                    selectedChannel?.id === channel.id 
                      ? 'bg-blue-50 border-l-2 border-l-blue-500' 
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="relative">
                    <Avatar name={channel.name} size="md" status={channel.status === 'open' ? 'online' : 'offline'} />
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
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        {selectedChannel ? (
          <div className="flex-1 flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Avatar name={selectedChannel.name} size="md" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-800">{selectedChannel.name}</h2>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[selectedChannel.status]}`}>
                      {selectedChannel.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {selectedChannel.assignee ? `Assigned to ${selectedChannel.assignee}` : 'Unassigned'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handlePinChannel(selectedChannel.id)}
                  className={`p-2 rounded-lg transition-colors ${selectedChannel.isPinned ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}
                  title={selectedChannel.isPinned ? 'Unpin' : 'Pin'}
                >
                  <Pin className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Call">
                  <Phone className="w-4 h-4 text-slate-500" />
                </button>
                <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Video">
                  <Video className="w-4 h-4 text-slate-500" />
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setShowChannelActions(!showChannelActions)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4 text-slate-500" />
                  </button>
                  {showChannelActions && (
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                      <button onClick={() => setIsAssignModalOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <User className="w-4 h-4" /> Assign to...
                      </button>
                      <button onClick={() => setIsTagModalOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <Tag className="w-4 h-4" /> Add tags
                      </button>
                      <button onClick={() => handleChangeStatus('pending')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <Clock className="w-4 h-4" /> Mark as pending
                      </button>
                      <button onClick={() => handleChangeStatus('resolved')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-600 hover:bg-green-50">
                        <CheckCheck className="w-4 h-4" /> Resolve
                      </button>
                      <hr className="my-1" />
                      <button onClick={() => setIsArchiveDialogOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                        <Archive className="w-4 h-4" /> Archive
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Date separator */}
              <div className="flex items-center justify-center">
                <span className="px-3 py-1 text-xs text-slate-500 bg-slate-100 rounded-full">Today</span>
              </div>

              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.isClient ? 'justify-start' : 'justify-end'} group`}>
                  <div className={`max-w-[70%] ${msg.isClient ? '' : ''}`}>
                    {msg.isClient && (
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar name={msg.senderName} size="sm" />
                        <span className="text-sm font-medium text-slate-700">{msg.senderName}</span>
                        <span className="text-xs text-slate-400">{msg.time}</span>
                      </div>
                    )}
                    
                    {/* Reply preview */}
                    {msg.replyTo && (
                      <div className={`px-3 py-1.5 mb-1 border-l-2 ${msg.isClient ? 'border-slate-300 bg-slate-50' : 'border-blue-300 bg-blue-50/50'} rounded text-xs`}>
                        <span className="font-medium">{msg.replyTo.sender}</span>
                        <p className="text-slate-600 truncate">{msg.replyTo.text}</p>
                      </div>
                    )}

                    <div className="relative">
                      <div className={`px-4 py-3 rounded-2xl ${
                        msg.isClient 
                          ? 'bg-slate-100 text-slate-800 rounded-tl-md' 
                          : 'bg-blue-500 text-white rounded-tr-md'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                        
                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {msg.attachments.map((att, i) => (
                              <a 
                                key={i}
                                href={att.url}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                                  msg.isClient ? 'bg-white' : 'bg-blue-400/30'
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
                      <div className={`absolute top-0 ${msg.isClient ? 'right-0 translate-x-full' : 'left-0 -translate-x-full'} px-2 opacity-0 group-hover:opacity-100 transition-opacity`}>
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg shadow-sm p-1">
                          <button onClick={() => setReplyingTo(msg)} className="p-1.5 hover:bg-slate-100 rounded" title="Reply">
                            <Reply className="w-3.5 h-3.5 text-slate-500" />
                          </button>
                          <button className="p-1.5 hover:bg-slate-100 rounded" title="Copy">
                            <Copy className="w-3.5 h-3.5 text-slate-500" />
                          </button>
                          <button className="p-1.5 hover:bg-slate-100 rounded" title="Forward">
                            <Forward className="w-3.5 h-3.5 text-slate-500" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {!msg.isClient && (
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <span className="text-xs text-slate-500">{msg.time}</span>
                        {msg.status === 'sent' && <Check className="w-3.5 h-3.5 text-slate-400" />}
                        {msg.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5 text-slate-400" />}
                        {msg.status === 'read' && <CheckCheck className="w-3.5 h-3.5 text-blue-500" />}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex items-center gap-2">
                  <Avatar name={selectedChannel.name} size="sm" />
                  <div className="px-4 py-3 bg-slate-100 rounded-2xl">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* AI Suggestions */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-slate-600">AI Suggestions</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {suggestedResponses.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleUseSuggestion(suggestion)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs text-slate-700 hover:bg-slate-100 whitespace-nowrap transition-colors"
                  >
                    {suggestion.slice(0, 40)}...
                  </button>
                ))}
              </div>
            </div>

            {/* Reply preview */}
            {replyingTo && (
              <div className="px-6 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2">
                  <Reply className="w-4 h-4 text-slate-400" />
                  <div className="text-sm">
                    <span className="font-medium text-slate-700">Replying to {replyingTo.senderName}</span>
                    <p className="text-slate-500 truncate">{replyingTo.text}</p>
                  </div>
                </div>
                <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-slate-200 rounded">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
            )}

            {/* Input */}
            <div className="p-4 border-t border-slate-200">
              <div className="flex items-end gap-3">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    rows={1}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none min-h-[48px] max-h-32"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <button 
                      onClick={() => setShowQuickReplies(!showQuickReplies)}
                      className="p-3 hover:bg-slate-100 rounded-xl transition-colors" 
                      title="Quick replies"
                    >
                      <Sparkles className="w-5 h-5 text-purple-500" />
                    </button>
                    {showQuickReplies && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-2">
                        <p className="px-4 py-1 text-xs font-medium text-slate-500">Quick Replies</p>
                        {quickReplies.map(qr => (
                          <button
                            key={qr.id}
                            onClick={() => handleUseQuickReply(qr.text)}
                            className="w-full text-left px-4 py-2 hover:bg-slate-50"
                          >
                            <span className="text-sm font-medium text-slate-700">{qr.label}</span>
                            <p className="text-xs text-slate-500 truncate">{qr.text}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="p-3 hover:bg-slate-100 rounded-xl transition-colors" title="Attach file">
                    <Paperclip className="w-5 h-5 text-slate-500" />
                  </button>
                  <button className="p-3 hover:bg-slate-100 rounded-xl transition-colors" title="Emoji">
                    <Smile className="w-5 h-5 text-slate-500" />
                  </button>
                  <button
                    onClick={() => setIsRecording(!isRecording)}
                    className={`p-3 rounded-xl transition-colors ${isRecording ? 'bg-red-100 text-red-500' : 'hover:bg-slate-100 text-slate-500'}`}
                    title={isRecording ? 'Stop recording' : 'Voice message'}
                  >
                    {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={handleSendMessage}
                    disabled={!messageText.trim()}
                    className="p-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <EmptyState
              title="Select a conversation"
              description="Choose a conversation from the list to start chatting"
            />
          </div>
        )}
      </div>

      {/* Assign Modal */}
      <Modal isOpen={isAssignModalOpen} onClose={() => setIsAssignModalOpen(false)} title="Assign Conversation" size="sm">
        <div className="space-y-3">
          {['Sarah Jenkins', 'Mike Chen', 'Emily Patel', 'Unassigned'].map(agent => (
            <button
              key={agent}
              onClick={() => {
                if (selectedChannel) {
                  setChannels(prev => prev.map(ch => 
                    ch.id === selectedChannel.id ? { ...ch, assignee: agent === 'Unassigned' ? undefined : agent } : ch
                  ))
                }
                setIsAssignModalOpen(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 rounded-lg transition-colors"
            >
              {agent !== 'Unassigned' && <Avatar name={agent} size="sm" />}
              {agent === 'Unassigned' && <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center"><User className="w-4 h-4 text-slate-400" /></div>}
              <span className="font-medium text-slate-700">{agent}</span>
              {selectedChannel?.assignee === agent && <Check className="w-4 h-4 text-blue-500 ml-auto" />}
            </button>
          ))}
        </div>
      </Modal>

      {/* Tags Modal */}
      <Modal isOpen={isTagModalOpen} onClose={() => setIsTagModalOpen(false)} title="Manage Tags" size="sm">
        <div className="space-y-3">
          {['VIP', 'Orders', 'Technical', 'Billing', 'Urgent', 'Follow-up'].map(tag => (
            <label key={tag} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 rounded-lg cursor-pointer">
              <input 
                type="checkbox" 
                defaultChecked={selectedChannel?.tags?.includes(tag)}
                className="w-4 h-4 text-blue-500 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">{tag}</span>
            </label>
          ))}
          <button className="w-full py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors">
            Save Tags
          </button>
        </div>
      </Modal>

      {/* Archive Dialog */}
      <ConfirmDialog
        isOpen={isArchiveDialogOpen}
        onClose={() => setIsArchiveDialogOpen(false)}
        onConfirm={handleArchiveChannel}
        title="Archive Conversation"
        message="Are you sure you want to archive this conversation? You can find it later in the archived section."
        confirmText="Archive"
        variant="warning"
      />
    </>
  )
}
