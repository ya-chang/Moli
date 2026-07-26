// src/renderer/stores/userStore.ts
// 用户状态 — 头像 + 名字持久化到文件系统

import { create } from 'zustand'

interface UserState {
  avatar: string
  name: string
  setAvatar: (avatar: string) => void
  setName: (name: string) => void
  loadAvatar: () => void
  loadAll: () => void
}

export const useUserStore = create<UserState>((set) => ({
  avatar: '👤',
  name: '',

  setAvatar: (avatar) => {
    set({ avatar })
    window.electronAPI?.invoke('user:saveProfile', { avatar }).catch(() => {})
  },

  setName: (name) => {
    set({ name })
    window.electronAPI?.invoke('user:saveProfile', { name }).catch(() => {})
  },

  loadAvatar: () => {
    window.electronAPI?.invoke('user:loadProfile').then((result: any) => {
      if (result?.avatar) set({ avatar: result.avatar })
    }).catch(() => {})
  },

  loadAll: () => {
    window.electronAPI?.invoke('user:loadProfile').then((result: any) => {
      if (result) {
        set({
          avatar: result.avatar || '👤',
          name: result.name || ''
        })
      }
    }).catch(() => {})
  }
}))
