import { useState, useRef } from 'react'
import { 
  Check, CheckCheck, FileText, Mic, Play, Pause, 
  Download, X, Maximize2, Film, Music, FileSpreadsheet,
  FileCode, FileArchive, Image as ImageIcon, Volume2,
  File
} from 'lucide-react'
import type { Message } from '../model'

interface MessageItemProps {
  message: Message
  showSender?: boolean
  onReply?: () => void
  onReact?: (emoji: string) => void
}

export function MessageItem({ message, showSender = true, onReply: _onReply, onReact }: MessageItemProps) {
  const isFromTeam = message.isFromTeam
  
  return (
    <div className={`flex ${isFromTeam ? 'justify-end' : 'justify-start'} mb-2`}>
      <div 
        className={`max-w-[70%] rounded-2xl overflow-hidden ${
          isFromTeam 
            ? 'bg-blue-500 text-white rounded-br-md' 
            : 'bg-white border border-slate-200 rounded-bl-md'
        }`}
      >
        {/* Sender name */}
        {showSender && !isFromTeam && (
          <div className="text-xs font-medium text-blue-600 px-4 pt-2">
            {message.senderName}
          </div>
        )}

        {/* Media - full width without padding */}
        {message.mediaType && message.mediaUrl && (
          <MediaRenderer 
            type={message.mediaType} 
            url={message.mediaUrl} 
            isFromTeam={isFromTeam}
            text={message.text}
          />
        )}

        {/* Text */}
        {message.text && (
          <p className={`text-sm whitespace-pre-wrap px-4 py-2 ${isFromTeam ? 'text-white' : 'text-slate-800'}`}>
            {message.text}
          </p>
        )}

        {/* Footer */}
        <div className={`flex items-center justify-end gap-1 px-4 pb-2 ${
          isFromTeam ? 'text-blue-100' : 'text-slate-400'
        }`}>
          <span className="text-xs">
            {formatTime(message.createdAt)}
          </span>
          {isFromTeam && (
            message.isRead 
              ? <CheckCheck className="w-3.5 h-3.5" />
              : <Check className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Reactions */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 px-4 pb-2">
            {Object.entries(message.reactions).map(([emoji, users]) => (
              <button
                key={emoji}
                onClick={() => onReact?.(emoji)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  isFromTeam 
                    ? 'bg-blue-400 hover:bg-blue-300' 
                    : 'bg-slate-100 hover:bg-slate-200'
                }`}
              >
                {emoji} {users.length}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Lightbox для просмотра изображений/видео
function MediaLightbox({ 
  src, 
  type, 
  onClose 
}: { 
  src: string
  type: 'image' | 'video'
  onClose: () => void 
}) {
  return (
    <div 
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors z-10"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      
      {type === 'image' ? (
        <img 
          src={src} 
          alt="Preview" 
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <video 
          src={src} 
          controls 
          autoPlay
          className="max-w-full max-h-full rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      
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

// Компонент для фото
function PhotoMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  const [showLightbox, setShowLightbox] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 m-1 rounded-lg ${
        isFromTeam ? 'bg-blue-400' : 'bg-slate-100'
      }`}>
        <ImageIcon className="w-5 h-5 opacity-50" />
        <span className="text-sm opacity-70">Изображение недоступно</span>
      </div>
    )
  }

  return (
    <>
      <div 
        className="relative cursor-pointer group"
        onClick={() => setShowLightbox(true)}
      >
        {!loaded && (
          <div className="w-full h-48 bg-slate-200 animate-pulse" />
        )}
        <img 
          src={url}
          alt="Photo"
          className={`w-full max-h-80 object-cover ${loaded ? '' : 'hidden'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Maximize2 className="w-8 h-8 text-white drop-shadow-lg" />
        </div>
      </div>
      {showLightbox && (
        <MediaLightbox src={url} type="image" onClose={() => setShowLightbox(false)} />
      )}
    </>
  )
}

// Компонент для видео
function VideoMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  const [showLightbox, setShowLightbox] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <>
      <div className="relative group">
        <video
          ref={videoRef}
          src={url}
          className="w-full max-h-80 object-cover cursor-pointer"
          onClick={() => setShowLightbox(true)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        {!isPlaying && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
            onClick={() => setShowLightbox(true)}
          >
            <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="w-8 h-8 text-slate-800 ml-1" />
            </div>
          </div>
        )}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/60 rounded text-white text-xs">
          <Film className="w-3 h-3" />
          Видео
        </div>
      </div>
      {showLightbox && (
        <MediaLightbox src={url} type="video" onClose={() => setShowLightbox(false)} />
      )}
    </>
  )
}

// Компонент для видеосообщений (кружочки)
function VideoNoteMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  const [showLightbox, setShowLightbox] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }
  }

  return (
    <>
      <div className="p-2 flex justify-center">
        <div 
          className="relative w-48 h-48 rounded-full overflow-hidden cursor-pointer border-4 border-white shadow-lg"
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={url}
            className="w-full h-full object-cover"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            loop
          />
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                <Play className="w-6 h-6 text-slate-800 ml-0.5" />
              </div>
            </div>
          )}
        </div>
      </div>
      {showLightbox && (
        <MediaLightbox src={url} type="video" onClose={() => setShowLightbox(false)} />
      )}
    </>
  )
}

// Компонент для голосовых сообщений
function VoiceMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 m-1 rounded-xl ${
      isFromTeam ? 'bg-blue-400' : 'bg-slate-100'
    }`}>
      <audio 
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setProgress(0); setCurrentTime(0) }}
      />
      <button
        onClick={togglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isFromTeam ? 'bg-white text-blue-500' : 'bg-blue-500 text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Volume2 className={`w-4 h-4 ${isFromTeam ? 'text-blue-100' : 'text-slate-500'}`} />
          <span className={`text-xs ${isFromTeam ? 'text-blue-100' : 'text-slate-500'}`}>
            Голосовое сообщение
          </span>
        </div>
        <div className={`relative h-1.5 rounded-full overflow-hidden ${
          isFromTeam ? 'bg-blue-300' : 'bg-slate-300'
        }`}>
          <div 
            className={`absolute h-full rounded-full transition-all ${
              isFromTeam ? 'bg-white' : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className={`flex justify-between text-[10px] mt-1 ${
          isFromTeam ? 'text-blue-100' : 'text-slate-500'
        }`}>
          <span>{formatTime(currentTime)}</span>
          <span>{duration ? formatTime(duration) : '--:--'}</span>
        </div>
      </div>
    </div>
  )
}

// Компонент для аудио файлов
function AudioMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
    }
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 m-1 rounded-xl ${
      isFromTeam ? 'bg-blue-400' : 'bg-slate-100'
    }`}>
      <audio 
        ref={audioRef}
        src={url}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100)
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setProgress(0) }}
      />
      <button
        onClick={togglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isFromTeam ? 'bg-white text-blue-500' : 'bg-blue-500 text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Music className={`w-4 h-4 ${isFromTeam ? 'text-blue-100' : 'text-slate-500'}`} />
          <span className={`text-xs ${isFromTeam ? 'text-blue-100' : 'text-slate-500'}`}>
            Аудио
          </span>
        </div>
        <div className={`relative h-1.5 rounded-full overflow-hidden ${
          isFromTeam ? 'bg-blue-300' : 'bg-slate-300'
        }`}>
          <div 
            className={`absolute h-full rounded-full transition-all ${
              isFromTeam ? 'bg-white' : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <a 
        href={url} 
        download 
        onClick={e => e.stopPropagation()}
        className={`p-2 rounded-full ${isFromTeam ? 'hover:bg-blue-300' : 'hover:bg-slate-200'}`}
      >
        <Download className={`w-4 h-4 ${isFromTeam ? 'text-white' : 'text-slate-600'}`} />
      </a>
    </div>
  )
}

// Компонент для документов
function DocumentMedia({ url, isFromTeam }: { url: string; isFromTeam: boolean }) {
  // Определяем тип документа по URL
  const getFileInfo = (fileUrl: string) => {
    const ext = fileUrl.split('.').pop()?.toLowerCase() || ''
    const fileName = fileUrl.split('/').pop() || 'Документ'
    
    const icons: Record<string, { icon: typeof FileText; color: string; label: string }> = {
      pdf: { icon: FileText, color: 'text-red-500', label: 'PDF документ' },
      doc: { icon: FileText, color: 'text-blue-500', label: 'Word документ' },
      docx: { icon: FileText, color: 'text-blue-500', label: 'Word документ' },
      xls: { icon: FileSpreadsheet, color: 'text-green-500', label: 'Excel таблица' },
      xlsx: { icon: FileSpreadsheet, color: 'text-green-500', label: 'Excel таблица' },
      ppt: { icon: FileText, color: 'text-orange-500', label: 'Презентация' },
      pptx: { icon: FileText, color: 'text-orange-500', label: 'Презентация' },
      zip: { icon: FileArchive, color: 'text-yellow-600', label: 'Архив ZIP' },
      rar: { icon: FileArchive, color: 'text-yellow-600', label: 'Архив RAR' },
      '7z': { icon: FileArchive, color: 'text-yellow-600', label: 'Архив 7Z' },
      js: { icon: FileCode, color: 'text-yellow-500', label: 'JavaScript' },
      ts: { icon: FileCode, color: 'text-blue-500', label: 'TypeScript' },
      py: { icon: FileCode, color: 'text-green-500', label: 'Python' },
      json: { icon: FileCode, color: 'text-slate-500', label: 'JSON' },
      txt: { icon: FileText, color: 'text-slate-500', label: 'Текстовый файл' },
    }

    const info = icons[ext] || { icon: File, color: 'text-slate-500', label: 'Файл' }
    return { ...info, fileName, ext }
  }

  const fileInfo = getFileInfo(url)
  const IconComponent = fileInfo.icon

  return (
    <a
      href={url}
      download
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 px-4 py-3 m-1 rounded-xl transition-colors ${
        isFromTeam 
          ? 'bg-blue-400 hover:bg-blue-300' 
          : 'bg-slate-100 hover:bg-slate-200'
      }`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
        isFromTeam ? 'bg-white/20' : 'bg-white'
      }`}>
        <IconComponent className={`w-6 h-6 ${isFromTeam ? 'text-white' : fileInfo.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isFromTeam ? 'text-white' : 'text-slate-800'}`}>
          {fileInfo.fileName}
        </p>
        <p className={`text-xs ${isFromTeam ? 'text-blue-100' : 'text-slate-500'}`}>
          {fileInfo.label}
          {fileInfo.ext && ` • .${fileInfo.ext.toUpperCase()}`}
        </p>
      </div>
      <Download className={`w-5 h-5 flex-shrink-0 ${isFromTeam ? 'text-blue-100' : 'text-slate-400'}`} />
    </a>
  )
}

// Компонент для стикеров
function StickerMedia({ url }: { url: string }) {
  const [error, setError] = useState(false)
  
  if (error) {
    return (
      <div className="p-2 text-center">
        <span className="text-4xl">🎭</span>
      </div>
    )
  }

  return (
    <div className="p-2 flex justify-center">
      <img 
        src={url}
        alt="Sticker"
        className="w-32 h-32 object-contain"
        onError={() => setError(true)}
      />
    </div>
  )
}

// Главный рендерер медиа
function MediaRenderer({ 
  type, 
  url, 
  isFromTeam,
  text 
}: { 
  type: string
  url: string
  isFromTeam: boolean
  text?: string
}) {
  // Проверяем что URL валидный
  if (!url || url.startsWith('tg://')) {
    // Показываем заглушку для недоступных медиа
    return (
      <div className={`flex items-center gap-2 px-4 py-3 ${
        isFromTeam ? 'text-blue-100' : 'text-slate-500'
      }`}>
        {type === 'photo' && <ImageIcon className="w-5 h-5" />}
        {type === 'video' && <Film className="w-5 h-5" />}
        {type === 'video_note' && <Film className="w-5 h-5" />}
        {type === 'voice' && <Mic className="w-5 h-5" />}
        {type === 'audio' && <Music className="w-5 h-5" />}
        {type === 'document' && <FileText className="w-5 h-5" />}
        {type === 'sticker' && <span className="text-xl">🎭</span>}
        <span className="text-sm">
          {type === 'photo' && '[Фото]'}
          {type === 'video' && '[Видео]'}
          {type === 'video_note' && '[Видеосообщение]'}
          {type === 'voice' && '[Голосовое]'}
          {type === 'audio' && '[Аудио]'}
          {type === 'document' && '[Документ]'}
          {type === 'sticker' && '[Стикер]'}
        </span>
      </div>
    )
  }

  switch (type) {
    case 'photo':
      return <PhotoMedia url={url} isFromTeam={isFromTeam} />
    case 'video':
      return <VideoMedia url={url} isFromTeam={isFromTeam} />
    case 'video_note':
      return <VideoNoteMedia url={url} isFromTeam={isFromTeam} />
    case 'voice':
      return <VoiceMedia url={url} isFromTeam={isFromTeam} />
    case 'audio':
      return <AudioMedia url={url} isFromTeam={isFromTeam} />
    case 'sticker':
      return <StickerMedia url={url} />
    case 'document':
      return <DocumentMedia url={url} isFromTeam={isFromTeam} />
    default:
      return <DocumentMedia url={url} isFromTeam={isFromTeam} />
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
