// src/renderer/components/emojis/EmojiMessage.tsx
// 表情包消息组件 — 微信风格小方块

import { useState, useEffect } from 'react'
import { getCachedEmoji, setCachedEmoji } from './emojiCache'
import './EmojiMessage.css'

interface EmojiMessageProps {
  emojiId: string
  filePath?: string
  isUser: boolean
  characterId?: string
}

export function EmojiMessage({ emojiId, filePath, isUser, characterId }: EmojiMessageProps): React.JSX.Element {
  const [imageSrc, setImageSrc] = useState<string>(() => getCachedEmoji(emojiId) || '')
  const [loading, setLoading] = useState(!getCachedEmoji(emojiId))

  useEffect(() => {
    // 有缓存直接用
    const cached = getCachedEmoji(emojiId)
    if (cached) {
      setImageSrc(cached)
      setLoading(false)
      return
    }

    const loadImage = async (): Promise<void> => {
      try {
        let charId = characterId
        if (!charId && filePath) {
          const match = filePath.match(/characters[/\\]([^/\\]+)[/\\]emojis/)
          charId = match?.[1] || 'default'
        }

        const imageData = await window.electronAPI?.invoke('emoji:get-image', charId || 'default', emojiId) as string | null
        if (imageData) {
          setCachedEmoji(emojiId, imageData)
          setImageSrc(imageData)
        }
      } catch (err) {
        console.error('加载表情包图片失败:', err)
      } finally {
        setLoading(false)
      }
    }

    loadImage()
  }, [emojiId, filePath, characterId])

  if (loading) {
    return (
      <div className={`emoji-message ${isUser ? 'emoji-message--user' : 'emoji-message--assistant'}`}>
        <div className="emoji-message__loading">...</div>
      </div>
    )
  }

  if (!imageSrc) {
    return (
      <div className={`emoji-message ${isUser ? 'emoji-message--user' : 'emoji-message--assistant'}`}>
        <div className="emoji-message__error">[图片]</div>
      </div>
    )
  }

  return (
    <div className={`emoji-message ${isUser ? 'emoji-message--user' : 'emoji-message--assistant'}`}>
      <img 
        src={imageSrc} 
        alt="表情包"
        className="emoji-message__img"
      />
    </div>
  )
}
