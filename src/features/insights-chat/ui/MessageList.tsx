import { useEffect, useRef } from 'react'
import type { InsightsMessage } from '../model/types'
import { MessageBubble } from './MessageBubble'

export function MessageList({ messages }: { messages: InsightsMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.pending])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  )
}
