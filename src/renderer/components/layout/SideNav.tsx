// src/renderer/components/layout/SideNav.tsx
// 左侧导航栏 — 头像点击弹出用户信息菜单

import { useState, useRef, useEffect } from 'react'
import { useUIStore, type ViewType } from '../../stores/uiStore'
import { useUserStore } from '../../stores/userStore'
import { SettingsPanel } from '../settings/SettingsPanel'
import './SideNav.css'

interface NavItem {
  id: ViewType
  icon: string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', icon: '💬', label: '消息' },
  { id: 'contacts', icon: '👥', label: '通讯录' },
  { id: 'moments', icon: '📷', label: '朋友圈' },
  { id: 'music', icon: '🎵', label: '一起听歌' },
]

interface SideNavProps {
  unreadCount?: number
}

export function SideNav({ unreadCount = 0 }: SideNavProps): React.JSX.Element {
  const currentView = useUIStore((s) => s.currentView)
  const setView = useUIStore((s) => s.setView)
  const [showSettings, setShowSettings] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const userAvatar = useUserStore((s) => s.avatar)
  const userName = useUserStore((s) => s.name)
  const setUserAvatar = useUserStore((s) => s.setAvatar)
  const setUserName = useUserStore((s) => s.setName)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭用户信息菜单
  useEffect(() => {
    if (!showProfile) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showProfile])

  const handleAvatarClick = (): void => {
    setShowProfile(!showProfile)
  }

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      if (dataUrl) {
        setUserAvatar(dataUrl)
      }
    }
    reader.readAsDataURL(file)
  }

  const isImage = userAvatar && userAvatar.startsWith('data:image')

  return (
    <div className="side-nav">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        style={{ display: 'none' }}
      />

      {/* 用户头像 + 弹出菜单 */}
      <div className="side-nav__avatar-wrapper" ref={profileRef}>
        <div className="side-nav__avatar" onClick={handleAvatarClick} title="点击设置个人信息">
          <div className="side-nav__avatar-img">
            {isImage ? (
              <img src={userAvatar} alt="头像" />
            ) : (
              <span className="side-nav__avatar-emoji">{userAvatar}</span>
            )}
          </div>
        </div>

        {showProfile && (
          <div className="side-nav__profile-popup">
            <div className="side-nav__profile-header">个人信息</div>

            <div className="side-nav__profile-avatar" onClick={() => fileInputRef.current?.click()}>
              {isImage ? (
                <img src={userAvatar} alt="头像" />
              ) : (
                <span className="side-nav__profile-avatar-emoji">{userAvatar}</span>
              )}
              <div className="side-nav__profile-avatar-overlay">更换头像</div>
            </div>

            <div className="side-nav__profile-field">
              <label>昵称</label>
              <input
                type="text"
                className="side-nav__profile-input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="输入你的昵称"
                maxLength={20}
              />
            </div>

            <div className="side-nav__profile-hint">
              你的昵称会让AI在对话中称呼你
            </div>
          </div>
        )}
      </div>

      <nav className="side-nav__menu">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`side-nav__item ${currentView === item.id ? 'side-nav__item--active' : ''}`}
            onClick={() => setView(item.id)}
            title={item.label}
          >
            <span className="side-nav__icon">{item.icon}</span>
            {item.id === 'chat' && unreadCount > 0 && (
              <span className="side-nav__badge">{unreadCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="side-nav__bottom">
        <button className="side-nav__item" title="设置" onClick={() => setShowSettings(true)}>
          <span className="side-nav__icon">⚙️</span>
        </button>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}