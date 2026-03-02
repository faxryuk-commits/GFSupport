import { useState } from 'react'
import { Send, Bot } from 'lucide-react'
import type { OnboardingComment } from '@/entities/onboarding'

interface CommentFeedProps {
  comments: OnboardingComment[]
  onAddComment: (text: string) => void
  loading?: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CommentItem({ comment }: { comment: OnboardingComment }) {
  if (comment.isSystem) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm text-gray-700">{comment.text}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {formatDate(comment.createdAt)}
          </p>
        </div>
      </div>
    )
  }

  const initial = (comment.agentName ?? '?')[0].toUpperCase()

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-600">
        {initial}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-800">
            {comment.agentName ?? 'Агент'}
          </span>
          <span className="text-xs text-gray-400">
            {formatDate(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-gray-600">{comment.text}</p>
      </div>
    </div>
  )
}

export function CommentFeed({ comments, onAddComment, loading }: CommentFeedProps) {
  const [text, setText] = useState('')

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAddComment(trimmed)
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">
            Комментариев пока нет
          </p>
        )}
        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} />
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <input
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            placeholder="Написать комментарий..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <p className="mt-1 text-xs text-gray-400">@mention</p>
        </div>
        <button
          onClick={handleSend}
          disabled={loading || !text.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
