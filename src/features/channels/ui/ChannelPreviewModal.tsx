import { Eye, X } from 'lucide-react'
import { Avatar } from '@/shared/ui'
// TODO FSD: feature→feature cross-import. Consider moving MessageBubble/MessageData to shared or entities
import { MessageBubble, type MessageData } from '@/features/messages/ui'
import type { ChannelItemData } from './ChannelListItem'

interface ChannelPreviewModalProps {
  channel: ChannelItemData
  messages: MessageData[]
  isLoading: boolean
  onClose: () => void
  onOpenChat: (channel: ChannelItemData) => void
}

export function ChannelPreviewModal({ channel, messages, isLoading, onClose, onOpenChat }: ChannelPreviewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Avatar name={channel.name} src={channel.avatar} size="sm" />
            <div>
              <h3 className="font-semibold text-slate-900">{channel.name}</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Предпросмотр — сообщения не отмечены как прочитанные
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenChat(channel)}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              Открыть чат
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-slate-400 py-12">Нет сообщений</p>
          ) : (
            messages.map(msg => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onReply={() => {}}
                onCopy={() => {}}
                onReaction={() => {}}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
