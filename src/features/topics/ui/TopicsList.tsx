import { useState, useEffect } from 'react'
import { MessageSquare, Lock, Pin, Loader2, ChevronRight } from 'lucide-react'
import { fetchTopics, type Topic } from '@/shared/api/topics'
import { TOPIC_ICON_COLORS } from '@/entities/topic'

interface TopicsListProps {
  channelId: string
  selectedTopicId?: string
  onSelectTopic: (topic: Topic) => void
  className?: string
}

// Получить цвет по индексу или использовать первый
function getIconColor(colorStr?: string): string {
  if (!colorStr) return TOPIC_ICON_COLORS[0]
  // Если уже hex цвет
  if (colorStr.startsWith('#')) return colorStr
  // Попробовать как индекс
  const idx = parseInt(colorStr, 10)
  if (!isNaN(idx) && idx >= 0 && idx < TOPIC_ICON_COLORS.length) {
    return TOPIC_ICON_COLORS[idx]
  }
  return TOPIC_ICON_COLORS[0]
}

export function TopicsList({ 
  channelId, 
  selectedTopicId, 
  onSelectTopic,
  className = '' 
}: TopicsListProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadTopics()
  }, [channelId])

  const loadTopics = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchTopics(channelId)
      setTopics(response.topics)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки топиков')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`p-4 text-center text-red-500 text-sm ${className}`}>
        {error}
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <div className={`p-4 text-center text-slate-500 text-sm ${className}`}>
        Нет топиков в этом канале
      </div>
    )
  }

  return (
    <div className={`divide-y divide-slate-100 ${className}`}>
      {topics.map((topic) => {
        const isSelected = selectedTopicId === topic.id
        const iconColor = getIconColor(topic.iconColor)
        
        return (
          <button
            key={topic.id}
            onClick={() => onSelectTopic(topic)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              isSelected 
                ? 'bg-blue-50 border-l-2 border-l-blue-500' 
                : 'hover:bg-slate-50 border-l-2 border-l-transparent'
            }`}
          >
            {/* Icon */}
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: iconColor + '20', color: iconColor }}
            >
              <MessageSquare className="w-4 h-4" />
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-medium truncate ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                  {topic.name}
                </span>
                {topic.isClosed && (
                  <Lock className="w-3 h-3 text-slate-400 flex-shrink-0" />
                )}
                {topic.isPinned && (
                  <Pin className="w-3 h-3 text-blue-400 flex-shrink-0" />
                )}
              </div>
              
              {/* Stats */}
              <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                <span>{topic.messagesCount} сообщений</span>
              </div>
            </div>
            
            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
