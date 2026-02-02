import { useState, useRef } from 'react'
import { Send, Paperclip, Image, Smile, X } from 'lucide-react'

interface MessageComposerProps {
  channelId: string
  onSend: (text: string, attachments?: File[]) => Promise<void>
  placeholder?: string
  disabled?: boolean
  replyTo?: { id: string; text: string } | null
  onCancelReply?: () => void
}

export function MessageComposer({ 
  channelId,
  onSend, 
  placeholder = 'Написать сообщение...',
  disabled,
  replyTo,
  onCancelReply
}: MessageComposerProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!text.trim() && attachments.length === 0) return
    if (sending || disabled) return

    setSending(true)
    try {
      await onSend(text.trim(), attachments.length > 0 ? attachments : undefined)
      setText('')
      setAttachments([])
      onCancelReply?.()
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setAttachments(prev => [...prev, ...files])
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
          <div className="w-1 h-8 bg-blue-500 rounded-full" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-blue-600 font-medium">Ответ на сообщение</p>
            <p className="text-sm text-slate-600 truncate">{replyTo.text}</p>
          </div>
          <button 
            onClick={onCancelReply}
            className="p-1 hover:bg-slate-200 rounded"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto">
          {attachments.map((file, index) => (
            <div 
              key={index}
              className="relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-slate-100"
            >
              {file.type.startsWith('image/') ? (
                <img 
                  src={URL.createObjectURL(file)} 
                  alt={file.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-slate-500 text-center px-1 truncate">
                    {file.name}
                  </span>
                </div>
              )}
              <button
                onClick={() => removeAttachment(index)}
                className="absolute top-1 right-1 p-0.5 bg-black/50 rounded-full hover:bg-black/70"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-4">
        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          disabled={disabled}
        >
          <Paperclip className="w-5 h-5 text-slate-500" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={1}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl resize-none
              focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
              disabled:opacity-50 disabled:cursor-not-allowed
              max-h-32 overflow-y-auto"
            style={{ minHeight: '42px' }}
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={(!text.trim() && attachments.length === 0) || sending || disabled}
          className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-500"
        >
          <Send className={`w-5 h-5 ${sending ? 'animate-pulse' : ''}`} />
        </button>
      </form>
    </div>
  )
}
