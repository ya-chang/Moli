// src/renderer/stores/chatBgStore.ts
// 聊天背景状态

import { create } from 'zustand'
import { kvSetSync } from '../ipc/storage'

interface ChatBgState {
  backgrounds: Record<string, string>
  getBg: (characterId: string) => string
  setBg: (characterId: string, bg: string) => void
}

export const useChatBgStore = create<ChatBgState>((set, get) => ({
  backgrounds: {},

  getBg: (characterId: string) => {
    return get().backgrounds[characterId] || '#FFFFFF'
  },

  setBg: (characterId: string, bg: string) => {
    kvSetSync(`chatBg-${characterId}`, bg)
    set((state) => ({
      backgrounds: { ...state.backgrounds, [characterId]: bg }
    }))
  }
}))
