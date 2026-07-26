// src/renderer/stores/uiStore.ts
// UI 状态管理 — 管理当前视图、侧边栏状态

import { create } from 'zustand'

export type ViewType = 'chat' | 'contacts' | 'moments' | 'music'

interface UIState {
  currentView: ViewType
  setView: (view: ViewType) => void
}

export const useUIStore = create<UIState>((set) => ({
  currentView: 'chat',
  setView: (view) => set({ currentView: view })
}))
