import { useRef, useState, useCallback, useEffect } from 'react'
import { 
  Send, Paperclip, Smile, Mic, StopCircle, Sparkles, X, Reply,
  Image as ImageIcon, File, Film, Music, FileText, Trash2
} from 'lucide-react'

interface ReplyData {
  id: string
  text: string
  sender: string
}

interface QuickReply {
  id: string
  label: string
  text: string
}

export interface AttachedFile {
  id: string
  file: File
  preview?: string
  type: 'image' | 'video' | 'audio' | 'document'
}

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: (files?: AttachedFile[]) => void
  replyingTo: ReplyData | null
  onCancelReply: () => void
  quickReplies?: QuickReply[]
  showQuickReplies?: boolean
  onToggleQuickReplies?: () => void
  onUseQuickReply?: (text: string) => void
  isRecording?: boolean
  onToggleRecording?: () => void
  disabled?: boolean
}

// Определение типа файла
function getFileType(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

// Эмодзи пикер
const EMOJI_CATEGORIES = [
  { name: 'Часто используемые', emojis: ['👍', '❤️', '😊', '😂', '🙏', '👋', '🔥', '✅', '👌', '💪', '🎉', '😍'] },
  { name: 'Смайлы', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝'] },
  { name: 'Жесты', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜'] },
  { name: 'Символы', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '⭐', '🌟', '✨', '💫', '🔥', '💥'] },
  { name: 'Объекты', emojis: ['📱', '💻', '🖥️', '📷', '📹', '🎥', '📞', '📧', '📨', '📝', '📄', '📋', '📁', '📂', '🗂️', '📅', '📆', '🗓️', '📌', '📍', '📎', '🔗', '✂️', '🔧'] },
]

function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState(0)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={pickerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-3 rounded-xl transition-colors ${isOpen ? 'bg-amber-100 text-amber-600' : 'hover:bg-slate-100 text-slate-500'}`}
        title="Эмодзи"
      >
        <Smile className="w-5 h-5" />
      </button>
      
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
          {/* Category tabs */}
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {EMOJI_CATEGORIES.map((cat, i) => (
              <button
                key={cat.name}
                onClick={() => setActiveCategory(i)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  activeCategory === i 
                    ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {cat.emojis[0]} {cat.name.split(' ')[0]}
              </button>
            ))}
          </div>
          
          {/* Emojis grid */}
          <div className="p-2 max-h-48 overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                <button
                  key={i}
                  onClick={() => { onSelect(emoji); setIsOpen(false) }}
                  className="w-8 h-8 flex items-center justify-center text-xl hover:bg-slate-100 rounded-lg transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// Форматирование размера файла
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Иконка по типу файла
function FileTypeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'image': return <ImageIcon className={className} />
    case 'video': return <Film className={className} />
    case 'audio': return <Music className={className} />
    default: return <FileText className={className} />
  }
}

// Компонент превью файла
function FilePreview({ 
  file, 
  onRemove 
}: { 
  file: AttachedFile
  onRemove: () => void 
}) {
  return (
    <div className="relative group">
      {file.type === 'image' && file.preview ? (
        <div className="relative w-20 h-20 rounded-lg overflow-hidden">
          <img 
            src={file.preview} 
            alt={file.file.name}
            className="w-full h-full object-cover"
          />
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        </div>
      ) : file.type === 'video' && file.preview ? (
        <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-900">
          <video 
            src={file.preview}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Film className="w-6 h-6 text-white/70" />
          </div>
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        </div>
      ) : (
        <div className="relative flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg max-w-[200px]">
          <FileTypeIcon type={file.type} className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700 truncate">{file.file.name}</p>
            <p className="text-xs text-slate-400">{formatFileSize(file.file.size)}</p>
          </div>
          <button
            onClick={onRemove}
            className="p-1 hover:bg-slate-200 rounded flex-shrink-0"
          >
            <X className="w-3 h-3 text-slate-500" />
          </button>
        </div>
      )}
    </div>
  )
}

export function ChatInput({
  value,
  onChange,
  onSend,
  replyingTo,
  onCancelReply,
  quickReplies = [],
  showQuickReplies = false,
  onToggleQuickReplies,
  onUseQuickReply,
  isRecording = false,
  onToggleRecording,
  disabled = false,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!value.trim() && attachedFiles.length === 0) return
    onSend(attachedFiles.length > 0 ? attachedFiles : undefined)
    setAttachedFiles([])
  }

  const processFiles = useCallback((files: FileList | File[]) => {
    const newFiles: AttachedFile[] = []
    
    Array.from(files).forEach(file => {
      const type = getFileType(file)
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      
      const attachedFile: AttachedFile = { id, file, type }
      
      // Создаём превью для изображений и видео
      if (type === 'image' || type === 'video') {
        attachedFile.preview = URL.createObjectURL(file)
      }
      
      newFiles.push(attachedFile)
    })
    
    setAttachedFiles(prev => [...prev, ...newFiles])
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files)
      e.target.value = '' // Сброс для повторного выбора того же файла
    }
  }

  const handleRemoveFile = (id: string) => {
    setAttachedFiles(prev => {
      const file = prev.find(f => f.id === id)
      if (file?.preview) {
        URL.revokeObjectURL(file.preview)
      }
      return prev.filter(f => f.id !== id)
    })
  }

  const handleClearAllFiles = () => {
    attachedFiles.forEach(f => {
      if (f.preview) URL.revokeObjectURL(f.preview)
    })
    setAttachedFiles([])
  }

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }

  // Вставка из буфера обмена
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    const files: File[] = []
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) files.push(file)
      }
    }
    
    if (files.length > 0) {
      e.preventDefault()
      processFiles(files)
    }
  }

  return (
    <div 
      className={`border-t border-slate-200 ${isDragging ? 'bg-blue-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Reply preview */}
      {replyingTo && (
        <div className="px-4 py-2 bg-slate-50 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Reply className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <div className="text-sm min-w-0">
              <span className="font-medium text-slate-700">Ответ на {replyingTo.sender}</span>
              <p className="text-slate-500 truncate">{replyingTo.text}</p>
            </div>
          </div>
          <button onClick={onCancelReply} className="p-1 hover:bg-slate-200 rounded flex-shrink-0">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      )}

      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500">
              Прикреплено: {attachedFiles.length}
            </span>
            <button 
              onClick={handleClearAllFiles}
              className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Очистить всё
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map(file => (
              <FilePreview 
                key={file.id} 
                file={file}
                onRemove={() => handleRemoveFile(file.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="px-4 py-8 flex items-center justify-center">
          <div className="text-center">
            <Paperclip className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-blue-600 font-medium">Отпустите для загрузки</p>
          </div>
        </div>
      )}

      {/* Input area */}
      {!isDragging && (
        <div className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Введите сообщение..."
                rows={1}
                disabled={disabled}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none min-h-[48px] max-h-32 disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-1">
              {/* Quick replies */}
              {quickReplies.length > 0 && onToggleQuickReplies && (
                <div className="relative">
                  <button 
                    onClick={onToggleQuickReplies}
                    className="p-3 hover:bg-slate-100 rounded-xl transition-colors" 
                    title="Быстрые ответы"
                  >
                    <Sparkles className="w-5 h-5 text-purple-500" />
                  </button>
                  {showQuickReplies && onUseQuickReply && (
                    <div className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-10">
                      <p className="px-4 py-1 text-xs font-medium text-slate-500">Быстрые ответы</p>
                      {quickReplies.map(qr => (
                        <button
                          key={qr.id}
                          onClick={() => onUseQuickReply(qr.text)}
                          className="w-full text-left px-4 py-2 hover:bg-slate-50"
                        >
                          <span className="text-sm font-medium text-slate-700">{qr.label}</span>
                          <p className="text-xs text-slate-500 truncate">{qr.text}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* File attachment */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-3 hover:bg-slate-100 rounded-xl transition-colors" 
                title="Прикрепить файл"
              >
                <Paperclip className="w-5 h-5 text-slate-500" />
              </button>

              {/* Emoji */}
              <EmojiPicker onSelect={(emoji) => onChange(value + emoji)} />

              {/* Voice recording */}
              {onToggleRecording && (
                <button
                  onClick={onToggleRecording}
                  className={`p-3 rounded-xl transition-colors ${isRecording ? 'bg-red-100 text-red-500' : 'hover:bg-slate-100 text-slate-500'}`}
                  title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}
                >
                  {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}

              {/* Send */}
              <button 
                onClick={handleSend}
                disabled={(!value.trim() && attachedFiles.length === 0) || disabled}
                className="p-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
