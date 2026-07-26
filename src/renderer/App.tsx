// src/renderer/App.tsx
// 根组件 — 启动时从后端加载角色 + 同步聊天列表

import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { NotificationCenter } from './components/notification/NotificationCenter'
import { useUserStore } from './stores/userStore'
import { useChatStore } from './stores/chatStore'
import { useChatListStore } from './stores/chatListStore'
import { kvGet } from './ipc/storage'

function App(): React.JSX.Element {
  const loadAvatar = useUserStore((s) => s.loadAvatar)

  useEffect(() => {
    loadAvatar()
    loadCharactersFromBackend()

    // 启动时应用保存的主题
    kvGet<{ theme?: string }>('app-settings').then((settings) => {
      if (settings?.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme)
      }
    }).catch(() => {})

    // 启动时加载上次选中角色的消息
    kvGet<{ id: string }>('wechat-ai-active-session').then((session) => {
      if (session?.id) {
        useChatStore.getState().loadCharacterMessages(session.id)
      }
    }).catch(() => {})
  }, [loadAvatar])

  return (
    <>
      <NotificationCenter />
      <AppLayout />
    </>
  )
}

async function loadCharactersFromBackend(): Promise<void> {
  try {
    const result = await window.electronAPI?.invoke('character:list')
    if (!result || !Array.isArray(result)) return

    const chatListStore = useChatListStore.getState()

    for (const char of result) {
      const id = (char as Record<string, unknown>)?.id
      const name = (char as Record<string, unknown>)?.name
      const avatar = (char as Record<string, unknown>)?.avatar

      if (typeof id !== 'string' || typeof name !== 'string') continue

      const exists = chatListStore.sessions.some((s) => s.id === id)
      if (!exists) {
        chatListStore.addSession({
          id,
          name,
          avatar: typeof avatar === 'string' ? avatar : '🌸',
          lastMessage: '开始聊天吧~',
          time: '',
          unread: 0,
          online: true,
          pinned: false,
          avatarVersion: 0
        })
      }

      const chatData = useChatStore.getState().messagesByCharacter[id]
      if (chatData && chatData.length > 0) {
        const lastMsg = chatData[chatData.length - 1]
        const content = lastMsg.content.length > 20
          ? lastMsg.content.slice(0, 20) + '...'
          : lastMsg.content
        useChatListStore.getState().updateLastMessage(id, content)
      }
    }
  } catch (error) {
    console.error('加载角色列表失败:', error)
  }
}

export default App
