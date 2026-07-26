// src/renderer/components/chat/MessageBubble.tsx
// 消息气泡 — 支持文本/拍一拍/红包/引用/语音/表情包/图片等类型

import { useRef } from 'react'
import { QuoteMessage } from './QuoteMessage'
import { PatMessage } from './PatMessage'
import { RedPacket } from './RedPacket'
import { VoiceMessage } from '../tts/VoiceMessage'
import { EmojiMessage } from '../emojis/EmojiMessage'
import { ImageMessage } from './ImageMessage'
import { useUserStore } from '../../stores/userStore'
import type { QuoteMeta, PatMeta, RedPacketMeta } from '@shared/types'
import './MessageBubble.css'

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type?: string
  time: string
  avatar?: string
  status?: 'sending' | 'sent' | 'error'
  metadata?: Record<string, unknown>
  onQuote?: (messageId: string) => void
  onPat?: (targetName: string, suffix: string) => void
  highlight?: boolean
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: string, selected: boolean) => void
}

export function MessageBubble({
  id,
  role,
  content,
  type = 'text',
  time,
  avatar,
  status,
  metadata,
  onQuote,
  onPat,
  highlight,
  selectMode = false,
  selected = false,
  onSelect,
}: MessageBubbleProps): React.JSX.Element {
  const userAvatar = useUserStore((s) => s.avatar)
  const setUserAvatar = useUserStore((s) => s.setAvatar)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (role === 'system') {
    return (
      <div className="message-system">
        <span className="message-system__text">{content}</span>
        <span className="message-system__time">{time}</span>
      </div>
    )
  }

  if (type === 'pat' && metadata) {
    const pat = metadata as unknown as PatMeta
    return <PatMessage from={pat.from} to={pat.to} suffix={pat.suffix} time={time} />
  }

  const isUser = role === 'user'
  const displayAvatar = isUser ? userAvatar : (avatar || '🤖')

  // 检查是否有语音数据
  const voiceAudio = metadata?.voiceAudio as string | undefined

  const handleAvatarClick = (): void => {
    if (isUser) {
      fileInputRef.current?.click()
    }
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

  return (
    <div id={`msg-${id}`} className={`message-row ${isUser ? 'message-row--self' : 'message-row--other'} ${highlight ? 'message-row--highlight' : ''} ${selectMode ? 'message-row--select-mode' : ''} ${selected ? 'message-row--selected' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        style={{ display: 'none' }}
      />

      {selectMode && (
        <label className="message-checkbox" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect?.(id, e.target.checked)}
          />
        </label>
      )}

      <div
        className="message-avatar"
        onClick={isUser ? handleAvatarClick : undefined}
        onDoubleClick={!isUser && onPat ? () => onPat(displayAvatar, '') : undefined}
        title={isUser ? '点击上传头像' : '双击拍一拍'}
      >
        {displayAvatar.startsWith('data:image') ? (
          <img src={displayAvatar} alt="avatar" />
        ) : (
          <span className="message-avatar__emoji">{displayAvatar}</span>
        )}
      </div>

      <div className="message-content">
        {metadata && (metadata as unknown as QuoteMeta).quotedMessageId && (
          <QuoteMessage
            quotedContent={(metadata as unknown as QuoteMeta).quotedContent}
            quotedRole={(metadata as unknown as QuoteMeta).quotedRole}
          />
        )}

        {type === 'red_packet' && metadata ? (
          <RedPacket
            amount={(metadata as unknown as RedPacketMeta).amount}
            message={(metadata as unknown as RedPacketMeta).message}
            opened={(metadata as unknown as RedPacketMeta).opened}
          />
        ) : type === 'emoji' && metadata ? (
          <EmojiMessage
            emojiId={metadata.emojiId as string}
            filePath={metadata.filePath as string}
            isUser={isUser}
            characterId={metadata.characterId as string}
          />
        ) : type === 'image' && metadata?.images ? (
          <ImageMessage
            images={metadata.images as string[]}
            content={content}
            isUser={isUser}
          />
        ) : (
          <div
            className={`message-bubble ${isUser ? 'message-bubble--self' : 'message-bubble--other'} ${status === 'error' ? 'message-bubble--error' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault()
              onQuote?.(id)
            }}
          >
            {status === 'sending' && !content ? (
              <span className="message-text message-text--typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            ) : status === 'error' ? (
              <span className="message-text message-text--error">
                <span className="message-error-icon">⚠️</span>
                {content || '消息发送失败'}
              </span>
            ) : (
              <>
                {/* 语音条（在文字上方） */}
                {voiceAudio && (
                  <VoiceMessage audioBase64={voiceAudio} isSelf={isUser} />
                )}
                <span className="message-text">{content}</span>
              </>
            )}
          </div>
        )}

        <span className="message-time">{time}</span>
      </div>
    </div>
  )
}
