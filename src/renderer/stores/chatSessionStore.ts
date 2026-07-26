// src/renderer/stores/chatSessionStore.ts
// 聊天会话状态 — 管理当前选中的聊天

import { create } from 'zustand'
import { kvGetSync, kvSetSync, kvDeleteSync } from '../ipc/storage'

const STORAGE_KEY = 'wechat-ai-active-session'

export interface ChatSession {
  id: string
  name: string
  avatar: string
  online: boolean
  userAvatar?: string
}

interface ChatSessionState {
  currentSession: ChatSession | null
  setCurrentSession: (session: ChatSession | null) => void
}

const loadSession = (): ChatSession | null => {
  return kvGetSync<ChatSession>(STORAGE_KEY)
}

export const useChatSessionStore = create<ChatSessionState>((set) => ({
  currentSession: loadSession(),
  setCurrentSession: (session) => {
    if (session) kvSetSync(STORAGE_KEY, session)
    else kvDeleteSync(STORAGE_KEY)
    set({ currentSession: session })
  }
}))
