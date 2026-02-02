import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  ChevronLeft, Send, Paperclip, Mic, MoreVertical, 
  Image, File, AlertCircle, Check, CheckCheck, Clock,
  Bot, Sparkles
} from 'lucide-react'
import type { SupportChannel, SupportMessage } from '../types'

interface ChatViewProps {
  channelId: string
  channel: SupportChannel | null
  onBack: () => void
  currentAgentId: string
}

export function ChatView({ channelId, channel, onBack, currentAgentId }: ChatViewProps) {
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [inputText, setInputText] = useState('')
  const [showActions, setShowActions] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  
  // Get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('support_agent_token') || ''
    return {
      'Content-Type': 'application/json',
      'Authorization': token.startsWith('Bearer') ? token : `Bearer ${token}`
    }
  }, [])

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/messages?channelId=${channelId}&limit=100`, {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setIsLoading(false)
    }
  }, [channelId, getAuthHeaders])
  
  // Initial load
  useEffect(() => {
    fetchMessages()
    
    // Poll for new messages every 5 seconds
    const interval = setInterval(fetchMessages, 5000)
    return () => clearInterval(interval)
  }, [fetchMessages])
  
  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  // Mark as read
  useEffect(() => {
    if (channelId && messages.length > 0) {
      fetch(`/api/support/messages/read`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ channelId })
      }).catch(console.error)
    }
  }, [channelId, messages.length, getAuthHeaders])
  
  // Send message
  const handleSend = async () => {
    if (!inputText.trim() || isSending) return
    
    const text = inputText.trim()
    setInputText('')
    setIsSending(true)
    
    try {
      const res = await fetch('/api/support/messages/send', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          channelId,
          text,
          agentId: currentAgentId
        })
      })
      
      if (res.ok) {
        await fetchMessages()
      } else {
        alert('Ошибка отправки сообщения')
        setInputText(text)
      }
    } catch (err) {
      console.error('Failed to send:', err)
      setInputText(text)
    } finally {
      setIsSending(false)
    }
  }
  
  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  // Format time
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }
  
  // Format date header
  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    if (date.toDateString() === today.toDateString()) return 'Сегодня'
    if (date.toDateString() === yesterday.toDateString()) return 'Вчера'
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  }
  
  // Group messages by date
  const groupedMessages = messages.reduce((groups, msg) => {
    const date = new Date(msg.createdAt).toDateString()
    if (!groups[date]) groups[date] = []
    groups[date].push(msg)
    return groups
  }, {} as Record<string, SupportMessage[]>)
  
  // Render message
  const renderMessage = (msg: SupportMessage) => {
    const isOwn = msg.senderRole === 'support' || msg.senderRole === 'team'
    
    return (
      <div
        key={msg.id}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-2`}
      >
        <div
          className={`max-w-[80%] rounded-2xl px-4 py-2 ${
            isOwn 
              ? 'bg-emerald-500 text-white rounded-br-md' 
              : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
          }`}
        >
          {/* Sender name for client messages */}
          {!isOwn && msg.senderName && (
            <p className="text-xs font-medium text-emerald-600 mb-1">
              {msg.senderName}
            </p>
          )}
          
          {/* Media */}
          {msg.mediaUrl && (
            <div className="mb-2">
              {msg.contentType.startsWith('image') || msg.contentType === 'photo' ? (
                <img 
                  src={msg.mediaUrl} 
                  alt="" 
                  className="max-w-full rounded-lg"
                />
              ) : msg.contentType.startsWith('video') ? (
                <video 
                  src={msg.mediaUrl} 
                  controls 
                  className="max-w-full rounded-lg"
                />
              ) : (
                <a 
                  href={msg.mediaUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 ${isOwn ? 'text-white/90' : 'text-blue-600'}`}
                >
                  <File className="w-4 h-4" />
                  <span className="text-sm underline">Файл</span>
                </a>
              )}
            </div>
          )}
          
          {/* Text content */}
          {msg.textContent && (
            <p className="text-sm whitespace-pre-wrap break-words">
              {msg.textContent}
            </p>
          )}
          
          {/* AI suggestion */}
          {msg.aiSuggestion && !isOwn && (
            <div className="mt-2 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-1 text-xs text-purple-600 mb-1">
                <Sparkles className="w-3 h-3" />
                <span>AI подсказка</span>
              </div>
              <p className="text-xs text-slate-600">{msg.aiSuggestion}</p>
            </div>
          )}
          
          {/* Time and status */}
          <div className={`flex items-center justify-end gap-1 mt-1 ${isOwn ? 'text-white/70' : 'text-slate-400'}`}>
            <span className="text-[10px]">{formatTime(msg.createdAt)}</span>
            {isOwn && (
              msg.isRead 
                ? <CheckCheck className="w-3 h-3" />
                : <Check className="w-3 h-3" />
            )}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-2 py-2 flex items-center gap-2 sticky top-0 z-40">
        <button
          onClick={onBack}
          className="p-2 -ml-1 text-slate-600 hover:text-slate-800"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        
        {channel && (
          <>
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white font-medium flex-shrink-0">
              {channel.photoUrl ? (
                <img src={channel.photoUrl} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                channel.name.slice(0, 2).toUpperCase()
              )}
            </div>
            
            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="font-medium text-slate-800 truncate">{channel.name}</h1>
              <p className="text-xs text-slate-500 truncate">
                {channel.companyName || `${channel.messagesCount} сообщений`}
              </p>
            </div>
          </>
        )}
        
        <button
          onClick={() => setShowActions(!showActions)}
          className="p-2 text-slate-500 hover:text-slate-700"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </header>
      
      {/* Messages */}
      <main className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Clock className="w-6 h-6 animate-pulse text-slate-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">Нет сообщений</p>
          </div>
        ) : (
          <>
            {Object.entries(groupedMessages).map(([date, msgs]) => (
              <div key={date}>
                {/* Date header */}
                <div className="flex justify-center my-4">
                  <span className="px-3 py-1 bg-white/80 backdrop-blur-sm text-slate-500 text-xs rounded-full shadow-sm">
                    {formatDateHeader(msgs[0].createdAt)}
                  </span>
                </div>
                
                {/* Messages */}
                {msgs.map(renderMessage)}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>
      
      {/* Input */}
      <footer 
        className="bg-white border-t border-slate-200 p-2 flex items-end gap-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        <button className="p-2 text-slate-500 hover:text-slate-700">
          <Paperclip className="w-5 h-5" />
        </button>
        
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Сообщение..."
            rows={1}
            className="w-full px-4 py-2 bg-slate-100 rounded-2xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 max-h-32"
            style={{ minHeight: '40px' }}
          />
        </div>
        
        {inputText.trim() ? (
          <button
            onClick={handleSend}
            disabled={isSending}
            className="p-2 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        ) : (
          <button className="p-2 text-slate-500 hover:text-slate-700">
            <Mic className="w-5 h-5" />
          </button>
        )}
      </footer>
    </div>
  )
}

export default ChatView
