// src/renderer/components/chat/InputArea.tsx
// 聊天输入区域 — 表情选择 + 引用回复 + 图片发送

import { useState, useRef } from 'react'
import { useChat } from '../../hooks/useChat'
import { EmojiPanel } from '../emojis/EmojiPanel'
import '../../styles/emoji.css'
import './InputArea.css'

interface InputAreaProps {
  quoteMessage?: { id: string; content: string } | null
  onClearQuote?: () => void
  disabled?: boolean
  characterId?: string
}

export function InputArea({ quoteMessage, onClearQuote, disabled, characterId }: InputAreaProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [selectedImages, setSelectedImages] = useState<string[]>([]) // base64 data URLs
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const { sendMessage, sendEmojiMessage } = useChat()

  const handleSend = (): void => {
    const text = inputValue.trim()
    if (!text && selectedImages.length === 0) return
    // 如果只有图片没有文字，加一个默认问句
    const sendText = text || '看看这张图'
    sendMessage(sendText, undefined, selectedImages.length > 0 ? selectedImages : undefined)
    setInputValue('')
    setSelectedImages([])
    setShowEmoji(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmojiSelect = (emoji: string): void => {
    setInputValue(prev => prev + emoji)
    setShowEmoji(false)
    inputRef.current?.focus()
  }

  // 处理自定义表情包选择
  const handleCustomEmojiSelect = (emojiId: string, filePath: string): void => {
    if (sendEmojiMessage) {
      sendEmojiMessage(emojiId, filePath)
    }
    setShowEmoji(false)
  }

  // 处理图片选择
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files) return

    for (const file of Array.from(files)) {
      // 检查文件类型
      if (!file.type.startsWith('image/')) continue
      // 检查文件大小（最大 10MB）
      if (file.size > 10 * 1024 * 1024) {
        alert('图片太大，最大 10MB')
        continue
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string
        if (dataUrl) {
          setSelectedImages(prev => [...prev, dataUrl])
        }
      }
      reader.readAsDataURL(file)
    }

    // 清空 input 允许重复选择
    e.target.value = ''
  }

  // 移除选中的图片
  const handleRemoveImage = (index: number): void => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="input-area">
      {quoteMessage && (
        <div className="input-area__quote">
          <span className="input-area__quote-content">{quoteMessage.content}</span>
          <button className="input-area__quote-close" onClick={onClearQuote}>×</button>
        </div>
      )}

      {/* 图片预览 */}
      {selectedImages.length > 0 && (
        <div className="input-area__images">
          {selectedImages.map((img, index) => (
            <div key={index} className="input-area__image-preview">
              <img src={img} alt="预览" />
              <button className="input-area__image-remove" onClick={() => handleRemoveImage(index)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* 工具栏（输入框上方） */}
      <div className="input-area__toolbar">
        <div className="input-area__toolbar-left">
          <div className="input-area__emoji-wrapper">
            <button
              className="input-area__tool-btn"
              title="表情"
              onClick={() => setShowEmoji(!showEmoji)}
            >
              <span>😊</span>
            </button>
            {showEmoji && (
              <EmojiPanel
                onSelect={handleEmojiSelect}
                onSelectCustom={handleCustomEmojiSelect}
                onClose={() => setShowEmoji(false)}
                characterId={characterId || ''}
              />
            )}
          </div>
          <button
            className="input-area__tool-btn"
            title="发送图片"
            onClick={() => imageInputRef.current?.click()}
          >
            <span>📷</span>
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <button className="input-area__tool-btn" title="文件">
            <span>📁</span>
          </button>
          <button className="input-area__tool-btn" title="聊天记录">
            <span>📋</span>
          </button>
        </div>
      </div>

      {/* 输入框 */}
      <textarea
        ref={inputRef}
        className="input-area__textarea"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? '请先选择一个角色' : (selectedImages.length > 0 ? '说点什么...' : '输入消息...')}
        disabled={disabled}
        rows={1}
      />

      {/* 底部：发送按钮 */}
      <div className="input-area__footer">
        <span className="input-area__footer-hint">Enter 发送，Shift+Enter 换行</span>
        <button
          className={`input-area__send-btn ${(inputValue.trim() || selectedImages.length > 0) ? 'input-area__send-btn--active' : ''}`}
          onClick={handleSend}
          disabled={(!inputValue.trim() && selectedImages.length === 0) || disabled}
        >
          发送
        </button>
      </div>
    </div>
  )
}
