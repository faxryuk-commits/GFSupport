import { useState, useRef, useEffect } from 'react'
import { 
  Check, CheckCheck, Reply, Copy, Forward, 
  Image as ImageIcon, File, Play, Pause, Download,
  Volume2, X, Maximize2, FileText, Film, Music,
  Trash2, Pin, MessageSquare, MoreHorizontal
} from 'lucide-react'
import { Avatar } from '@/shared/ui'

export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'
  url: string
  name?: string
  size?: string
  duration?: number // для аудио/видео в секундах
  thumbnail?: string // превью для видео
  mimeType?: string
}

export interface MessageReaction {
  emoji: string
  count: number
  users?: string[] // usernames/names who reacted
  isOwn?: boolean // did current user react
}

export interface MessageData {
  id: string
  telegramMessageId?: number
  senderName: string
  senderAvatarUrl?: string | null
  text: string
  time: string
  isClient: boolean
  status?: 'sent' | 'delivered' | 'read'
  replyTo?: { id: string; telegramMessageId?: number; text: string; sender: string }
  attachments?: MediaAttachment[]
  reactions?: MessageReaction[]
}

interface MessageBubbleProps {
  message: MessageData
  onReply: () => void
  onCopy: () => void
  onForward?: () => void
  onDelete?: () => void
  onPin?: () => void
  onReaction?: (emoji: string) => void
}

// Быстрые реакции
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']

// Lightbox для просмотра изображений
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div 
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      <img 
        src={src} 
        alt="Preview" 
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <a
        href={src}
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
      >
        <Download className="w-4 h-4" />
        Скачать
      </a>
    </div>
  )
}

// Компонент для изображений
function ImageAttachment({ attachment, isClient }: { attachment: MediaAttachment; isClient: boolean }) {
  const [showLightbox, setShowLightbox] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isClient ? 'bg-white/80' : 'bg-white/20'}`}>
        <ImageIcon className="w-5 h-5 opacity-50" />
        <span className="text-sm opacity-70">Изображение недоступно</span>
      </div>
    )
  }

  return (
    <>
      <div 
        className="relative cursor-pointer group rounded-lg overflow-hidden"
        onClick={() => setShowLightbox(true)}
      >
        {!loaded && (
          <div className="w-48 h-32 bg-slate-200 animate-pulse rounded-lg" />
        )}
        <img 
          src={attachment.url}
          alt={attachment.name || 'Image'}
          className={`max-w-xs max-h-64 rounded-lg object-cover ${loaded ? '' : 'hidden'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Maximize2 className="w-6 h-6 text-white drop-shadow-lg" />
        </div>
      </div>
      {showLightbox && (
        <ImageLightbox src={attachment.url} onClose={() => setShowLightbox(false)} />
      )}
    </>
  )
}

// Компонент для видео
function VideoAttachment({ attachment, isClient }: { attachment: MediaAttachment; isClient: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false)

  const formatDuration = (seconds?: number) => {
    if (!seconds) return ''
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="relative rounded-lg overflow-hidden max-w-xs">
      <video
        src={attachment.url}
        poster={attachment.thumbnail}
        controls
        className="max-w-full max-h-64 rounded-lg"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      {attachment.duration && !isPlaying && (
        <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 text-white text-xs rounded">
          {formatDuration(attachment.duration)}
        </div>
      )}
    </div>
  )
}

// Компонент для аудио/голосовых сообщений
function AudioAttachment({ attachment, isClient }: { attachment: MediaAttachment; isClient: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget
    setCurrentTime(audio.currentTime)
    setProgress((audio.currentTime / audio.duration) * 100)
  }

  const isVoice = attachment.type === 'voice'

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-xl min-w-[200px] ${
      isClient ? 'bg-white/80' : 'bg-white/20'
    }`}>
      <audio 
        src={attachment.url}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setProgress(0); setCurrentTime(0) }}
        id={`audio-${attachment.url}`}
      />
      <button
        onClick={() => {
          const audio = document.getElementById(`audio-${attachment.url}`) as HTMLAudioElement
          if (isPlaying) audio.pause()
          else audio.play()
        }}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isClient ? 'bg-blue-500 text-white' : 'bg-white/30 text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isVoice ? (
            <Volume2 className="w-4 h-4 opacity-60" />
          ) : (
            <Music className="w-4 h-4 opacity-60" />
          )}
          <span className="text-xs opacity-70">
            {isVoice ? 'Голосовое сообщение' : (attachment.name || 'Аудио')}
          </span>
        </div>
        <div className="relative h-1 bg-black/10 rounded-full overflow-hidden">
          <div 
            className={`absolute h-full rounded-full transition-all ${isClient ? 'bg-blue-500' : 'bg-white'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] opacity-60 mt-0.5">
          <span>{formatTime(currentTime)}</span>
          <span>{attachment.duration ? formatTime(attachment.duration) : '--:--'}</span>
        </div>
      </div>
    </div>
  )
}

// Компонент для документов
function DocumentAttachment({ attachment, isClient }: { attachment: MediaAttachment; isClient: boolean }) {
  const getFileIcon = () => {
    const ext = attachment.name?.split('.').pop()?.toLowerCase()
    if (['pdf'].includes(ext || '')) return <FileText className="w-5 h-5" />
    if (['mp4', 'mov', 'avi'].includes(ext || '')) return <Film className="w-5 h-5" />
    if (['mp3', 'wav', 'ogg'].includes(ext || '')) return <Music className="w-5 h-5" />
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return <ImageIcon className="w-5 h-5" />
    return <File className="w-5 h-5" />
  }

  return (
    <a
      href={attachment.url}
      download={attachment.name}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        isClient 
          ? 'bg-white/80 hover:bg-white' 
          : 'bg-white/20 hover:bg-white/30'
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
        isClient ? 'bg-blue-100 text-blue-600' : 'bg-white/20 text-white'
      }`}>
        {getFileIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{attachment.name || 'Документ'}</p>
        {attachment.size && (
          <p className="text-xs opacity-60">{attachment.size}</p>
        )}
      </div>
      <Download className="w-4 h-4 opacity-50" />
    </a>
  )
}

// Компонент для стикеров
function StickerAttachment({ attachment }: { attachment: MediaAttachment }) {
  return (
    <img 
      src={attachment.url}
      alt="Sticker"
      className="w-32 h-32 object-contain"
    />
  )
}

// Рендер медиа вложения
function MediaRenderer({ attachment, isClient }: { attachment: MediaAttachment; isClient: boolean }) {
  switch (attachment.type) {
    case 'image':
      return <ImageAttachment attachment={attachment} isClient={isClient} />
    case 'video':
      return <VideoAttachment attachment={attachment} isClient={isClient} />
    case 'audio':
    case 'voice':
      return <AudioAttachment attachment={attachment} isClient={isClient} />
    case 'sticker':
      return <StickerAttachment attachment={attachment} />
    case 'document':
    default:
      return <DocumentAttachment attachment={attachment} isClient={isClient} />
  }
}

export function MessageBubble({ message, onReply, onCopy, onForward, onDelete, onPin, onReaction }: MessageBubbleProps) {
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const reactionRef = useRef<HTMLDivElement>(null)
  
  const isSticker = message.attachments?.length === 1 && message.attachments[0].type === 'sticker'

  // Закрытие reaction picker
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (reactionRef.current && !reactionRef.current.contains(e.target as Node)) {
        setShowReactionPicker(false)
      }
    }
    if (showReactionPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showReactionPicker])

  // Обработка реакции
  const handleReaction = (emoji: string) => {
    onReaction?.(emoji)
    setShowReactionPicker(false)
    setShowContextMenu(false)
  }

  // Закрытие контекстного меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false)
      }
    }
    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showContextMenu])

  // Двойной клик — ответить
  const handleDoubleClick = () => {
    onReply()
  }

  // Правый клик — контекстное меню
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }

  // Копирование текста
  const handleCopy = () => {
    if (message.text) {
      navigator.clipboard.writeText(message.text)
    }
    onCopy()
    setShowContextMenu(false)
  }

  // Действие из меню
  const handleMenuAction = (action: () => void) => {
    action()
    setShowContextMenu(false)
  }

  return (
    <>
      <div 
        className={`flex ${message.isClient ? 'justify-start' : 'justify-end'} group`}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="max-w-[70%]">
          {message.isClient && (
            <div className="flex items-center gap-2 mb-1">
              <Avatar src={message.senderAvatarUrl} name={message.senderName} size="sm" />
              <span className="text-sm font-medium text-slate-700">{message.senderName}</span>
              <span className="text-xs text-slate-400">{message.time}</span>
            </div>
          )}
          
          {/* Reply preview - стиль как в Telegram */}
          {message.replyTo && (
            <div className={`flex gap-2 px-3 py-2 mb-1 rounded-lg cursor-pointer hover:opacity-80 ${
              message.isClient ? 'bg-slate-100/80' : 'bg-blue-400/30'
            }`}>
              <div className={`w-0.5 rounded-full flex-shrink-0 ${
                message.isClient ? 'bg-blue-500' : 'bg-white'
              }`} />
              <div className="min-w-0 flex-1">
                <span className={`text-xs font-semibold block ${
                  message.isClient ? 'text-blue-600' : 'text-white'
                }`}>
                  {message.replyTo.sender}
                </span>
                <p className={`text-xs truncate ${
                  message.isClient ? 'text-slate-600' : 'text-white/80'
                }`}>
                  {message.replyTo.text || '[медиа]'}
                </p>
              </div>
            </div>
          )}

          <div className="relative">
            {/* Стикеры показываем без bubble */}
            {isSticker ? (
              <MediaRenderer attachment={message.attachments![0]} isClient={message.isClient} />
            ) : (
              <div className={`rounded-2xl overflow-hidden cursor-pointer select-none ${
                message.isClient 
                  ? 'bg-slate-100 text-slate-800 rounded-tl-md' 
                  : 'bg-blue-500 text-white rounded-tr-md'
              }`}>
                {/* Медиа вложения */}
                {message.attachments && message.attachments.length > 0 && (
                  <div className={`${message.text ? 'p-1 pb-0' : 'p-1'}`}>
                    {message.attachments.length === 1 ? (
                      <MediaRenderer attachment={message.attachments[0]} isClient={message.isClient} />
                    ) : (
                      <div className="grid grid-cols-2 gap-1">
                        {message.attachments.map((att, i) => (
                          <MediaRenderer key={i} attachment={att} isClient={message.isClient} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Текст сообщения */}
                {message.text && (
                  <div className="px-4 py-3">
                    <p className="text-sm whitespace-pre-wrap select-text">{message.text}</p>
                  </div>
                )}
              </div>
            )}

            {/* Отображение реакций */}
            {message.reactions && message.reactions.length > 0 && (
              <div className={`flex flex-wrap gap-1 mt-1 ${message.isClient ? '' : 'justify-end'}`}>
                {message.reactions.map((reaction, i) => (
                  <button
                    key={i}
                    onClick={() => handleReaction(reaction.emoji)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all ${
                      reaction.isOwn
                        ? 'bg-blue-100 border border-blue-300 text-blue-700'
                        : 'bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200'
                    }`}
                    title={reaction.users?.join(', ')}
                  >
                    <span className="text-sm">{reaction.emoji}</span>
                    {reaction.count > 1 && <span>{reaction.count}</span>}
                  </button>
                ))}
                {onReaction && (
                  <button
                    onClick={() => setShowReactionPicker(true)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs transition-colors"
                  >
                    +
                  </button>
                )}
              </div>
            )}

            {/* Hover actions */}
            <div className={`absolute top-0 ${message.isClient ? 'right-0 translate-x-full' : 'left-0 -translate-x-full'} px-2 opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg shadow-sm p-1">
                {/* Quick reaction button */}
                {onReaction && (
                  <div className="relative" ref={reactionRef}>
                    <button 
                      onClick={() => setShowReactionPicker(!showReactionPicker)}
                      className="p-1.5 hover:bg-slate-100 rounded" 
                      title="Реакция"
                    >
                      <span className="text-sm">😊</span>
                    </button>
                    {/* Reaction picker popup */}
                    {showReactionPicker && (
                      <div className={`absolute ${message.isClient ? 'left-0' : 'right-0'} top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-20`}>
                        <div className="flex gap-1">
                          {QUICK_REACTIONS.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(emoji)}
                              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={onReply} className="p-1.5 hover:bg-slate-100 rounded" title="Ответить (двойной клик)">
                  <Reply className="w-3.5 h-3.5 text-slate-500" />
                </button>
                <button onClick={handleCopy} className="p-1.5 hover:bg-slate-100 rounded" title="Копировать">
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                </button>
                {onForward && (
                  <button onClick={onForward} className="p-1.5 hover:bg-slate-100 rounded" title="Переслать">
                    <Forward className="w-3.5 h-3.5 text-slate-500" />
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleContextMenu(e) }}
                  className="p-1.5 hover:bg-slate-100 rounded" 
                  title="Ещё"
                >
                  <MoreHorizontal className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
            </div>
          </div>

          {!message.isClient && (
            <div className="flex items-center justify-end gap-2 mt-1">
              <span className="text-xs text-slate-500">{message.time}</span>
              {message.status === 'sent' && <Check className="w-3.5 h-3.5 text-slate-400" />}
              {message.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5 text-slate-400" />}
              {message.status === 'read' && <CheckCheck className="w-3.5 h-3.5 text-blue-500" />}
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div 
          ref={contextMenuRef}
          className="fixed bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-2 min-w-[220px] overflow-hidden"
          style={{ 
            left: Math.min(contextMenuPos.x, window.innerWidth - 240),
            top: Math.min(contextMenuPos.y, window.innerHeight - 350)
          }}
        >
          {/* Quick reactions row */}
          {onReaction && (
            <>
              <div className="px-3 py-2 flex justify-center gap-1">
                {QUICK_REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="w-8 h-8 flex items-center justify-center text-lg hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-100 my-1" />
            </>
          )}
          <button
            onClick={() => handleMenuAction(onReply)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
          >
            <Reply className="w-4 h-4 text-slate-400" />
            <span>Ответить</span>
            <span className="ml-auto text-xs text-slate-400">2x клик</span>
          </button>
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
          >
            <Copy className="w-4 h-4 text-slate-400" />
            <span>Копировать</span>
          </button>
          {onForward && (
            <button
              onClick={() => handleMenuAction(onForward)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
            >
              <Forward className="w-4 h-4 text-slate-400" />
              <span>Переслать</span>
            </button>
          )}
          {onPin && (
            <button
              onClick={() => handleMenuAction(onPin)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
            >
              <Pin className="w-4 h-4 text-slate-400" />
              <span>Закрепить</span>
            </button>
          )}
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={() => setShowContextMenu(false)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 text-left"
          >
            <MessageSquare className="w-4 h-4 text-slate-400" />
            <span>Цитировать</span>
          </button>
          {onDelete && (
            <>
              <div className="border-t border-slate-100 my-1" />
              <button
                onClick={() => handleMenuAction(onDelete)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 text-left text-red-600"
              >
                <Trash2 className="w-4 h-4" />
                <span>Удалить</span>
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
