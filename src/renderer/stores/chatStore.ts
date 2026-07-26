// src/renderer/stores/chatStore.ts
// 聊天状态管理 — 按角色隔离消息 + 文件系统持久化

import { create } from 'zustand'

export interface Message {
  id: string
  characterId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type: 'text' | 'pat' | 'red_packet' | 'emoji' | 'image'
  timestamp: number
  status: 'sending' | 'sent' | 'error'
  error?: string
  metadata?: Record<string, unknown>
}

type AddMessageInput = Omit<Message, 'id' | 'timestamp' | 'status' | 'characterId'> & {
  type?: Message['type']
  metadata?: Record<string, unknown>
}

// 延迟保存 — 避免每条消息都写文件
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: { characterId: string; messages: Message[] } | null = null

const debouncedSave = (characterId: string, messages: Message[]): void => {
  pendingSave = { characterId, messages }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (pendingSave) {
      window.electronAPI?.invoke('chat:saveMessages', {
        characterId: pendingSave.characterId,
        messages: pendingSave.messages
      })
      pendingSave = null
    }
  }, 500)
}

// 立即保存待写入的消息（退出时调用）
const flushPendingSave = (): void => {
  if (saveTimer) clearTimeout(saveTimer)
  if (pendingSave) {
    window.electronAPI?.invoke('chat:saveMessages', {
      characterId: pendingSave.characterId,
      messages: pendingSave.messages
    })
    pendingSave = null
  }
}

// 退出前立即保存
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingSave)
}

interface ChatState {
  messagesByCharacter: Record<string, Message[]>
  messages: Message[]
  currentCharacterId: string | null
  isLoading: boolean

  setCurrentCharacter: (characterId: string) => void
  loadCharacterMessages: (characterId: string) => Promise<void>
  addMessage: (msg: AddMessageInput) => string
  updateMessage: (id: string, updates: Partial<Message>, targetCharacterId?: string) => void
  setLoading: (loading: boolean) => void
  deleteMessages: (ids: string[]) => void
  clearMessages: () => void
  clearCharacterMessages: (characterId: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesByCharacter: {},
  messages: [],
  currentCharacterId: null,
  isLoading: false,

  // 切换角色 — 从文件加载该角色的消息
  setCurrentCharacter: (characterId: string) => {
    const state = get()
    // 如果已有缓存，直接切换
    if (state.messagesByCharacter[characterId]) {
      set({ currentCharacterId: characterId, messages: state.messagesByCharacter[characterId] })
      return
    }
    // 否则异步加载
    set({ currentCharacterId: characterId, messages: [] })
    get().loadCharacterMessages(characterId)
  },

  // 从文件系统加载消息
  loadCharacterMessages: async (characterId: string) => {
    try {
      const result = await window.electronAPI?.invoke('chat:loadMessages', { characterId }) as {
        success: boolean
        data?: Message[]
      }
      if (result?.success && result.data) {
        // 补齐 characterId（旧数据可能没有）
        const data = result.data.map(m => ({
          ...m,
          characterId: m.characterId || characterId
        }))
        set((state) => ({
          messagesByCharacter: { ...state.messagesByCharacter, [characterId]: data },
          messages: state.currentCharacterId === characterId ? data : state.messages
        }))
      }
    } catch {
      // 加载失败，使用空消息
    }
  },

  addMessage: (msg) => {
    const state = get()
    const characterId = state.currentCharacterId || 'default'

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const message: Message = {
      ...msg,
      id,
      characterId,
      timestamp: Date.now(),
      status: 'sending'
    }

    const characterMessages = state.messagesByCharacter[characterId] || []
    const updatedMessages = [...characterMessages, message]
    const newData = {
      ...state.messagesByCharacter,
      [characterId]: updatedMessages
    }

    set({
      messagesByCharacter: newData,
      messages: updatedMessages
    })

    // 延迟保存到文件
    debouncedSave(characterId, updatedMessages)

    return id
  },

  updateMessage: (id, updates, targetCharacterId?) => {
    const state = get()
    const characterId = targetCharacterId || state.currentCharacterId || 'default'

    const characterMessages = state.messagesByCharacter[characterId] || []
    const updatedMessages = characterMessages.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    )
    const newData = {
      ...state.messagesByCharacter,
      [characterId]: updatedMessages
    }

    // 只有当目标角色是当前聊天角色时，才更新 messages
    const shouldUpdateMessages = characterId === state.currentCharacterId

    set({
      messagesByCharacter: newData,
      ...(shouldUpdateMessages ? { messages: updatedMessages } : {})
    })

    // 延迟保存到文件
    debouncedSave(characterId, updatedMessages)
  },

  setLoading: (loading) => set({ isLoading: loading }),

  deleteMessages: (ids: string[]) => {
    const state = get()
    const characterId = state.currentCharacterId || 'default'
    const characterMessages = state.messagesByCharacter[characterId] || []
    const updatedMessages = characterMessages.filter((m) => !ids.includes(m.id))
    const newData = {
      ...state.messagesByCharacter,
      [characterId]: updatedMessages
    }

    set({
      messagesByCharacter: newData,
      messages: updatedMessages
    })

    // 延迟保存到文件
    debouncedSave(characterId, updatedMessages)
  },

  clearMessages: () => {
    const state = get()
    const characterId = state.currentCharacterId || 'default'
    const newData = {
      ...state.messagesByCharacter,
      [characterId]: []
    }

    set({
      messagesByCharacter: newData,
      messages: []
    })

    debouncedSave(characterId, [])
  },

  clearCharacterMessages: (characterId: string) => {
    const state = get()
    const newData = { ...state.messagesByCharacter }
    delete newData[characterId]

    set({
      messagesByCharacter: newData,
      messages: state.currentCharacterId === characterId ? [] : state.messages
    })

    // 删除文件
    window.electronAPI?.invoke('chat:deleteMessages', { characterId })
  }
}))

// 监听主动消息（早安/晚安/想你了）— 加入聊天列表
if (typeof window !== 'undefined' && window.electronAPI?.on) {
  window.electronAPI.on('proactive:message', (data: { characterId: string; content: string }) => {
    const state = useChatStore.getState()
    const msg: Message = {
      id: `auto_${Date.now()}`,
      characterId: data.characterId,
      role: 'assistant',
      content: data.content,
      type: 'text',
      timestamp: Date.now(),
      status: 'sent'
    }

    // 更新 messagesByCharacter
    const existing = state.messagesByCharacter[data.characterId] || []
    useChatStore.setState({
      messagesByCharacter: {
        ...state.messagesByCharacter,
        [data.characterId]: [...existing, msg]
      },
      // 如果当前正在看这个角色，也更新 messages
      messages: state.currentCharacterId === data.characterId
        ? [...state.messages, msg]
        : state.messages
    })
  })
}
