// src/renderer/components/contacts/ContactList.tsx
// 通讯录 — 左侧列表，点击选中后右侧显示详情

import { useState, useEffect } from 'react'
import { useChatListStore } from '../../stores/chatListStore'
import { useContactStore } from '../../stores/contactStore'
import { kvGetSync, kvGet } from '../../ipc/storage'
import './ContactList.css'

export function ContactList(): React.JSX.Element {
  const sessions = useChatListStore((s) => s.sessions)
  const [searchText, setSearchText] = useState('')
  const selectedContactId = useContactStore((s) => s.selectedContactId)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)

  const filteredSessions = sessions.filter((s) =>
    s.name.toLowerCase().includes(searchText.toLowerCase())
  )

  return (
    <div className="contact-list">
      <div className="contact-list__header">
        <span className="contact-list__title">通讯录</span>
        <div className="contact-list__window-controls">
          <button className="contact-list__win-btn" onClick={() => window.electronAPI?.minimize()} title="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="contact-list__win-btn" onClick={() => window.electronAPI?.maximize()} title="最大化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="contact-list__win-btn contact-list__win-btn--close" onClick={() => window.electronAPI?.close()} title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1" />
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      <div className="contact-list__search">
        <div className="contact-list__search-wrapper">
          <span className="contact-list__search-icon">🔍</span>
          <input
            type="text"
            className="contact-list__search-input"
            placeholder="搜索联系人"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      <div className="contact-list__section">
        <div className="contact-list__section-title">聊天对象</div>
        {filteredSessions.map((session) => (
          <ContactListItem
            key={session.id}
            session={session}
            selected={session.id === selectedContactId}
            onClick={() => setSelectedContactId(session.id)}
          />
        ))}
        {filteredSessions.length === 0 && (
          <div className="contact-list__empty">暂无联系人</div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 联系人列表项 — 支持图片头像 + 选中高亮
// ============================================================

function ContactListItem({ session, selected, onClick }: {
  session: { id: string; name: string; avatar: string; online: boolean; avatarVersion: number }
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  const [customAvatar, setCustomAvatar] = useState<string | null>(() => {
    return kvGetSync<string>(`char-avatar-${session.id}`)
  })

  useEffect(() => {
    kvGet<string>(`char-avatar-${session.id}`).then((saved) => {
      setCustomAvatar(saved && saved.startsWith('data:image') ? saved : null)
    })
  }, [session.id, session.avatarVersion])

  const isImage = (customAvatar && customAvatar.startsWith('data:image')) || session.avatar.startsWith('data:image')
  const displayAvatar = isImage ? (customAvatar || session.avatar) : session.avatar

  return (
    <div
      className={`contact-list__item ${selected ? 'contact-list__item--selected' : ''}`}
      onClick={onClick}
    >
      <div className="contact-list__item-avatar">
        {isImage ? (
          <img src={displayAvatar} alt="avatar" className="contact-list__item-avatar-img" />
        ) : (
          <span className="contact-list__item-emoji">{displayAvatar}</span>
        )}
        {session.online && <span className="contact-list__item-online-dot" />}
      </div>
      <div className="contact-list__item-info">
        <span className="contact-list__item-name">{session.name}</span>
        <span className="contact-list__item-detail">
          {session.online ? '在线' : '离线'}
        </span>
      </div>
    </div>
  )
}
