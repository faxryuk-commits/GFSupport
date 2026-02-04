import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react'

// Types
export interface CachedChannel {
  id: string
  name: string
  avatar?: string
  type: string
  status: string
  unreadCount: number
  lastMessage?: string
  lastMessageTime?: string
  updatedAt: number
}

export interface CachedMessage {
  id: string
  channelId: string
  senderId: string
  senderName: string
  senderAvatar?: string
  text: string
  time: string
  timestamp: number
  isClient: boolean
  status?: 'sent' | 'delivered' | 'read'
  replyTo?: { id: string; text: string; sender: string }
  attachments?: { type: string; name: string; url: string; size?: string }[]
  // Media fields
  mediaType?: string
  mediaUrl?: string
  thumbnailUrl?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
}

export interface CachedUser {
  id: string
  name: string
  email: string
  role: string
  avatar?: string
  updatedAt: number
}

interface CacheState {
  channels: Record<string, CachedChannel>
  messages: Record<string, CachedMessage[]>
  users: Record<string, CachedUser>
  analytics: { data: unknown; updatedAt: number } | null
  lastSync: number
  isOnline: boolean
}

type CacheAction =
  | { type: 'SET_CHANNELS'; payload: CachedChannel[] }
  | { type: 'UPDATE_CHANNEL'; payload: CachedChannel }
  | { type: 'SET_MESSAGES'; payload: { channelId: string; messages: CachedMessage[] } }
  | { type: 'ADD_MESSAGE'; payload: { channelId: string; message: CachedMessage } }
  | { type: 'SET_USERS'; payload: CachedUser[] }
  | { type: 'SET_ANALYTICS'; payload: unknown }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'CLEAR_CACHE' }
  | { type: 'HYDRATE'; payload: Partial<CacheState> }

const CACHE_KEY = 'gf_support_cache'
const CACHE_VERSION = '1.0'
const CACHE_EXPIRY = 24 * 60 * 60 * 1000

const initialState: CacheState = {
  channels: {},
  messages: {},
  users: {},
  analytics: null,
  lastSync: 0,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true
}

function cacheReducer(state: CacheState, action: CacheAction): CacheState {
  switch (action.type) {
    case 'SET_CHANNELS': {
      const channels: Record<string, CachedChannel> = {}
      action.payload.forEach(ch => {
        channels[ch.id] = { ...ch, updatedAt: Date.now() }
      })
      return { ...state, channels, lastSync: Date.now() }
    }
    case 'UPDATE_CHANNEL':
      return {
        ...state,
        channels: {
          ...state.channels,
          [action.payload.id]: { ...action.payload, updatedAt: Date.now() }
        }
      }
    case 'SET_MESSAGES':
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.payload.channelId]: action.payload.messages
        }
      }
    case 'ADD_MESSAGE': {
      const channelMessages = state.messages[action.payload.channelId] || []
      if (channelMessages.some(m => m.id === action.payload.message.id)) {
        return state
      }
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.payload.channelId]: [...channelMessages, action.payload.message]
        }
      }
    }
    case 'SET_USERS': {
      const users: Record<string, CachedUser> = {}
      action.payload.forEach(u => {
        users[u.id] = { ...u, updatedAt: Date.now() }
      })
      return { ...state, users }
    }
    case 'SET_ANALYTICS':
      return { ...state, analytics: { data: action.payload, updatedAt: Date.now() } }
    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload }
    case 'CLEAR_CACHE':
      return { ...initialState, isOnline: state.isOnline }
    case 'HYDRATE':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

interface CacheContextType {
  state: CacheState
  setChannels: (channels: CachedChannel[]) => void
  updateChannel: (channel: CachedChannel) => void
  getChannels: () => CachedChannel[]
  getChannel: (id: string) => CachedChannel | undefined
  setMessages: (channelId: string, messages: CachedMessage[]) => void
  addMessage: (channelId: string, message: CachedMessage) => void
  getMessages: (channelId: string) => CachedMessage[]
  setUsers: (users: CachedUser[]) => void
  getUsers: () => CachedUser[]
  setAnalytics: (data: unknown) => void
  getAnalytics: () => unknown | null
  clearCache: () => void
  isStale: (updatedAt: number, maxAge?: number) => boolean
}

const CacheContext = createContext<CacheContextType | null>(null)

export function CacheProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cacheReducer, initialState)

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.version === CACHE_VERSION && Date.now() - parsed.lastSync < CACHE_EXPIRY) {
          dispatch({ type: 'HYDRATE', payload: parsed.state })
        }
      }
    } catch (e) {
      console.error('Failed to load cache:', e)
    }
  }, [])

  useEffect(() => {
    try {
      const toSave = {
        version: CACHE_VERSION,
        state: {
          channels: state.channels,
          messages: state.messages,
          users: state.users,
          analytics: state.analytics,
          lastSync: state.lastSync
        }
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(toSave))
    } catch (e) {
      console.error('Failed to save cache:', e)
    }
  }, [state.channels, state.messages, state.users, state.analytics, state.lastSync])

  useEffect(() => {
    const handleOnline = () => dispatch({ type: 'SET_ONLINE', payload: true })
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', payload: false })
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const setChannels = useCallback((channels: CachedChannel[]) => {
    dispatch({ type: 'SET_CHANNELS', payload: channels })
  }, [])

  const updateChannel = useCallback((channel: CachedChannel) => {
    dispatch({ type: 'UPDATE_CHANNEL', payload: channel })
  }, [])

  const getChannels = useCallback(() => {
    return Object.values(state.channels).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }, [state.channels])

  const getChannel = useCallback((id: string) => state.channels[id], [state.channels])

  const setMessages = useCallback((channelId: string, messages: CachedMessage[]) => {
    dispatch({ type: 'SET_MESSAGES', payload: { channelId, messages } })
  }, [])

  const addMessage = useCallback((channelId: string, message: CachedMessage) => {
    dispatch({ type: 'ADD_MESSAGE', payload: { channelId, message } })
  }, [])

  const getMessages = useCallback((channelId: string) => state.messages[channelId] || [], [state.messages])

  const setUsers = useCallback((users: CachedUser[]) => {
    dispatch({ type: 'SET_USERS', payload: users })
  }, [])

  const getUsers = useCallback(() => Object.values(state.users), [state.users])

  const setAnalytics = useCallback((data: unknown) => {
    dispatch({ type: 'SET_ANALYTICS', payload: data })
  }, [])

  const getAnalytics = useCallback(() => state.analytics?.data || null, [state.analytics])

  const clearCache = useCallback(() => {
    dispatch({ type: 'CLEAR_CACHE' })
    localStorage.removeItem(CACHE_KEY)
  }, [])

  const isStale = useCallback((updatedAt: number, maxAge = 5 * 60 * 1000) => {
    return Date.now() - updatedAt > maxAge
  }, [])

  const value: CacheContextType = {
    state,
    setChannels, updateChannel, getChannels, getChannel,
    setMessages, addMessage, getMessages,
    setUsers, getUsers,
    setAnalytics, getAnalytics,
    clearCache, isStale
  }

  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>
}

export function useCache() {
  const context = useContext(CacheContext)
  if (!context) {
    throw new Error('useCache must be used within a CacheProvider')
  }
  return context
}

export function OfflineIndicator() {
  const { state } = useCache()
  
  if (state.isOnline) return null
  
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-full shadow-lg z-50 flex items-center gap-2">
      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
      Офлайн режим
    </div>
  )
}
