// src/renderer/components/emojis/EmojiPanel.tsx
// 表情面板 — 双Tab：系统表情 + 我的表情包

import { useState, useEffect, useCallback } from 'react'
import { EmojiUploader } from './EmojiUploader'
import { getCachedEmoji, setCachedEmoji } from './emojiCache'

interface EmojiMeta {
  id: string
  file: string
  originalName: string
  tags: string[]
  emotion: string
  usageCount: number
  lastUsed: string | null
  addedAt: string
}

// 带缓存 url 的 emoji
interface EmojiWithUrl extends EmojiMeta {
  url?: string
}

interface EmojiPanelProps {
  onSelect: (emoji: string) => void
  onSelectCustom: (emojiId: string, filePath: string) => void
  onClose: () => void
  characterId: string
}

const SYSTEM_EMOJIS = [
  '😊', '😂', '🤣', '❤️', '😍', '😘', '🥰', '😋',
  '😎', '🤔', '😢', '😭', '😡', '🥺', '😏', '😤',
  '👍', '👎', '🙏', '💪', '🤗', '😴', '🎉', '🔥',
  '💕', '💔', '✨', '🌟', '☀️', '🌙', '🍀', '🌸',
  '🌹', '🍉', '🍕', '🎂', '☕', '🍺', '🎵', '📱',
]

export function EmojiPanel({ onSelect, onSelectCustom, onClose, characterId }: EmojiPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'system' | 'custom'>('system')
  const [customEmojis, setCustomEmojis] = useState<EmojiWithUrl[]>([])
  const [showUploader, setShowUploader] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ emojiId: string; x: number; y: number } | null>(null)

  // 加载自定义表情包（只加载元数据，图片按需加载）
  const loadCustomEmojis = useCallback(async () => {
    try {
      const emojis = (await window.electronAPI?.invoke('emoji:get-all', characterId)) as EmojiMeta[] | undefined
      if (!emojis || emojis.length === 0) {
        setCustomEmojis([])
        return
      }

      // 先用缓存，没缓存的标记为 undefined
      const emojisWithUrl: EmojiWithUrl[] = emojis.map(emoji => ({
        ...emoji,
        url: getCachedEmoji(emoji.id) || undefined
      }))
      setCustomEmojis(emojisWithUrl)

      // 异步加载没有缓存的图片（不阻塞面板显示）
      const uncached = emojisWithUrl.filter(e => !e.url)
      if (uncached.length > 0) {
        const loaded = await Promise.all(
          uncached.map(async (emoji) => {
            const imageData = await window.electronAPI?.invoke('emoji:get-image', characterId, emoji.id) as string | null
            if (imageData) setCachedEmoji(emoji.id, imageData)
            return { id: emoji.id, url: imageData || undefined }
          })
        )
        // 更新状态
        setCustomEmojis(prev => prev.map(e => {
          const found = loaded.find(l => l.id === e.id)
          return found?.url ? { ...e, url: found.url } : e
        }))
      }
    } catch (err) {
      console.error('加载表情包失败:', err)
    }
  }, [characterId])

  useEffect(() => {
    loadCustomEmojis()
  }, [loadCustomEmojis])

  // 选择系统表情
  const handleSystemSelect = (emoji: string): void => {
    onSelect(emoji)
    onClose()
  }

  // 选择自定义表情包
  const handleCustomSelect = async (emoji: EmojiMeta): Promise<void> => {
    try {
      const filePath = await window.electronAPI?.invoke('emoji:get-file', characterId, emoji.id)
      if (filePath) {
        onSelectCustom(emoji.id, filePath as string)
        onClose()
      }
    } catch (err) {
      console.error('获取表情包路径失败:', err)
    }
  }

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, emojiId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ emojiId, x: e.clientX, y: e.clientY })
  }

  // 点击其他地方关闭菜单
  useEffect(() => {
    const handleClick = (): void => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  // 删除表情包
  const handleDelete = async (emojiId: string): Promise<void> => {
    setContextMenu(null)

    // 二次确认弹窗
    const confirmed = window.confirm('确定要删除这个表情包吗？\n删除后将无法恢复。')
    if (!confirmed) return

    try {
      const result = await window.electronAPI?.invoke('emoji:delete', characterId, emojiId) as { success?: boolean }
      if (result?.success !== false) {
        setCustomEmojis(prev => prev.filter(e => e.id !== emojiId))
      }
    } catch (err) {
      console.error('删除表情包失败:', err)
    }
  }

  // 上传成功回调
  const handleUploadSuccess = (): void => {
    loadCustomEmojis()
    setShowUploader(false)
  }

  return (
    <div className="emoji-panel">
      {/* Tab 切换 */}
      <div className="emoji-panel__tabs">
        <button
          className={`emoji-panel__tab ${activeTab === 'system' ? 'emoji-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          系统表情
        </button>
        <button
          className={`emoji-panel__tab ${activeTab === 'custom' ? 'emoji-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          我的表情包
        </button>
      </div>

      {/* 内容区域 */}
      <div className="emoji-panel__content">
        {activeTab === 'system' ? (
          <div className="emoji-panel__grid">
            {SYSTEM_EMOJIS.map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                className="emoji-panel__item"
                onClick={() => handleSystemSelect(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="emoji-panel__grid">
            {customEmojis.map((emoji) => (
              <div
                key={emoji.id}
                className="emoji-panel__custom-item"
                onClick={() => handleCustomSelect(emoji)}
                onContextMenu={(e) => handleContextMenu(e, emoji.id)}
              >
                <img
                  src={emoji.url || ''}
                  alt={emoji.originalName}
                  className="emoji-panel__custom-img"
                />
              </div>
            ))}

            {/* 添加按钮 */}
            <button
              className="emoji-panel__add-btn"
              onClick={() => setShowUploader(true)}
            >
              <span>+</span>
            </button>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {activeTab === 'custom' && (
        <div className="emoji-panel__footer">
          长按可删除 · 最多50个 · 单个≤5MB
        </div>
      )}

      {/* 上传弹窗 */}
      {showUploader && (
        <EmojiUploader
          characterId={characterId}
          onSuccess={handleUploadSuccess}
          onCancel={() => setShowUploader(false)}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="emoji-panel__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="emoji-panel__context-menu-item emoji-panel__context-menu-item--danger"
            onClick={() => handleDelete(contextMenu.emojiId)}
          >
            删除表情包
          </button>
        </div>
      )}
    </div>
  )
}
