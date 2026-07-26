// src/renderer/components/layout/AppLayout.tsx
// 三栏布局容器 — 支持视图切换 + 实时未读数

import { useEffect } from 'react'
import { SideNav } from './SideNav'
import { ChatList } from './ChatList'
import { ChatWindow } from './ChatWindow'
import { ContactList } from '../contacts/ContactList'
import { ContactDetail } from '../contacts/ContactDetail'
import { MusicPage } from '../music/MusicPage'
import { ErrorBoundary } from '../ErrorBoundary'
import { useUIStore } from '../../stores/uiStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { useContactStore } from '../../stores/contactStore'
import './AppLayout.css'

export function AppLayout(): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView)
  const totalUnread = useUnreadStore((s) => s.totalUnread)
  const selectedContactId = useContactStore((s) => s.selectedContactId)

  useEffect(() => {
    if (!window.electronAPI) return

    let timer: ReturnType<typeof setTimeout>
    if (currentView === 'music') {
      timer = setTimeout(() => {
        window.electronAPI?.invoke('music:show-webview')
      }, 300)
    } else {
      window.electronAPI.invoke('music:hide-webview')
    }

    return () => { if (timer) clearTimeout(timer) }
  }, [currentView])

  return (
    <div className="app-layout">
      <SideNav unreadCount={totalUnread} />
      {currentView === 'chat' && (
        <>
          <ChatList />
          <ErrorBoundary section="聊天窗口">
            <ChatWindow />
          </ErrorBoundary>
        </>
      )}
      {currentView === 'contacts' && (
        <>
          <ContactList />
          {selectedContactId ? (
            <ErrorBoundary section="联系人详情">
              <ContactDetail />
            </ErrorBoundary>
          ) : (
            <div className="app-layout__placeholder">
              <div className="app-layout__placeholder-icon">👤</div>
              <div className="app-layout__placeholder-text">选择一个对象查看详情</div>
            </div>
          )}
        </>
      )}
      {currentView === 'music' && (
        <ErrorBoundary section="音乐播放">
          <MusicPage />
        </ErrorBoundary>
      )}
      {currentView === 'moments' && (
        <div className="app-layout__placeholder">
          <div className="app-layout__placeholder-icon">📷</div>
          <div className="app-layout__placeholder-text">朋友圈</div>
        </div>
      )}
    </div>
  )
}
