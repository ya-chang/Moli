// src/renderer/components/chat/ChatItem.tsx
// 单个聊天列表项 — 支持图片头像

import { useState, useEffect } from 'react'
import { kvGetSync, kvGet } from '../../ipc/storage'
import './ChatItem.css'

interface ChatItemProps {
  id: string
  name: string
  avatar: string
  lastMessage: string
  time: string
  unread: number
  online: boolean
  pinned: boolean
  selected: boolean
  onClick: () => void
  avatarVersion?: number
}

export function ChatItem({
  id,
  name,
  avatar,
  lastMessage,
  time,
  unread,
  online,
  selected,
  onClick,
  avatarVersion,
}: ChatItemProps): React.JSX.Element {
  const [customAvatar, setCustomAvatar] = useState<string | null>(() => {
    return kvGetSync<string>(`char-avatar-${id}`)
  })

  useEffect(() => {
    kvGet<string>(`char-avatar-${id}`).then((saved) => {
      setCustomAvatar(saved && saved.startsWith('data:image') ? saved : null)
    })
  }, [id, avatarVersion])

  const isImage = (customAvatar && customAvatar.startsWith('data:image')) || avatar.startsWith('data:image')
  const displayAvatar = isImage ? (customAvatar || avatar) : avatar

  return (
    <div
      className={`chat-item ${selected ? 'chat-item--selected' : ''}`}
      onClick={onClick}
    >
      <div className="chat-item__avatar">
        <div className="chat-item__avatar-img">
          {isImage ? (
            <img src={displayAvatar} alt="avatar" />
          ) : (
            <span className="chat-item__avatar-emoji">{displayAvatar}</span>
          )}
        </div>
        {online && <span className="chat-item__online-dot" />}
      </div>

      <div className="chat-item__info">
        <div className="chat-item__header">
          <span className="chat-item__name">{name}</span>
          <span className="chat-item__time">{time}</span>
        </div>
        <div className="chat-item__footer">
          <span className="chat-item__message">{lastMessage}</span>
          {unread > 0 && (
            <span className="chat-item__badge">{unread}</span>
          )}
        </div>
      </div>
    </div>
  )
}
