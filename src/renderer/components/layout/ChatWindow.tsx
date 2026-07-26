// src/renderer/components/layout/ChatWindow.tsx
// 右侧聊天窗口 — 自动滚到底部 + 引用 + 背景 + 正在输入

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { MessageBubble } from '../chat/MessageBubble'
import { InputArea } from '../chat/InputArea'
import { TitleBar } from './TitleBar'
import { NowPlaying } from '../music/NowPlaying'
import { SearchBar } from '../search/SearchBar'
import { useChatStore } from '../../stores/chatStore'
import { useChatSessionStore } from '../../stores/chatSessionStore'
import { useChatBgStore } from '../../stores/chatBgStore'
import { useChatListStore } from '../../stores/chatListStore'
import { useMusicStore } from '../../stores/musicStore'
import { kvGetSync, kvGet, kvSetSync, kvDeleteSync } from '../../ipc/storage'
import './ChatWindow.css'

interface QuoteTarget {
  id: string
  content: string
}

// 虚拟滚动：只渲染可见区域 ±BUFFER 条消息
const BUFFER = 15

export function ChatWindow(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoading)
  const currentSession = useChatSessionStore((s) => s.currentSession)
  const chatBgStore = useChatBgStore()
  const currentSong = useMusicStore((s) => s.currentSong)
  const [quoteMessage, setQuoteMessage] = useState<QuoteTarget | null>(null)
  const [patSuffix, setPatSuffixState] = useState('小脑袋')
  const [objectAvatar, setObjectAvatar] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const [showSearch, setShowSearch] = useState(false)
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Ctrl+F 打开搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 监听 TTS 音频 — 绑定到最后一条 AI 消息
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const data = args[0] as { characterId: string; msgId: string; audio: string }
      if (data?.audio && data.characterId) {
        const state = useChatStore.getState()
        // 找到该角色最后一条 AI 消息
        const charMessages = state.messagesByCharacter[data.characterId] || []
        for (let i = charMessages.length - 1; i >= 0; i--) {
          if (charMessages[i].role === 'assistant' && !charMessages[i].metadata?.voiceAudio) {
            useChatStore.getState().updateMessage(charMessages[i].id, {
              metadata: { ...charMessages[i].metadata, voiceAudio: data.audio }
            }, data.characterId)
            return
          }
        }
      }
    }
    window.electronAPI?.on('tts:audio-ready', handler)
    return () => { window.electronAPI?.off('tts:audio-ready', handler) }
  }, [])

  // 跳转到消息
  const handleJumpToMessage = useCallback((messageId: string): void => {
    // 找到消息在列表中的索引
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex < 0) return

    // 先调整可见范围，让目标消息可见
    const targetStart = Math.max(0, msgIndex - 20)
    const targetEnd = Math.min(messages.length, msgIndex + 20)
    setVisibleRange({ start: targetStart, end: targetEnd })

    // 等待DOM更新后滚动
    setTimeout(() => {
      setHighlightMessageId(messageId)
      const msgElement = document.getElementById(`msg-${messageId}`)
      if (msgElement) {
        msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      // 3秒后取消高亮
      setTimeout(() => setHighlightMessageId(null), 3000)
    }, 100)
  }, [messages])

  // 监听搜索跳转事件
  useEffect(() => {
    const handleJump = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (detail?.messageId) {
        handleJumpToMessage(detail.messageId)
      }
    }
    window.addEventListener('search:jumpTo', handleJump)
    return () => window.removeEventListener('search:jumpTo', handleJump)
  }, [handleJumpToMessage])

  // 虚拟滚动：计算可见范围
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // 是否在底部附近（100px内）
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100
      setIsAutoScroll(nearBottom)

      // 计算可见范围（虚拟滚动优化）
      const itemHeight = 60 // 估算每条消息高度
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - BUFFER)
      const end = Math.min(messages.length, Math.ceil((scrollTop + clientHeight) / itemHeight) + BUFFER)
      setVisibleRange({ start, end })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [messages.length])

  // 消息变化时自动滚到底部
  useEffect(() => {
    if (isAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [messages, isLoading, isAutoScroll])

  // 表情包消息到达时强制滚到底部
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1]?.type === 'emoji') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
        setIsAutoScroll(true)
      }, 50)
    }
  }, [messages.length])

  // 切换角色时立即滚到底部
  useEffect(() => {
    setIsAutoScroll(true)
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [currentSession?.id])

  // 初始加载时滚到底部（消息从文件加载完成后）
  useEffect(() => {
    if (messages.length > 0) {
      // 延迟一帧确保DOM渲染完成
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      })
    }
  }, [messages.length]) // 只在消息数量变化时触发

  // 只渲染可见区域的消息（虚拟滚动）
  const visibleMessages = useMemo(() => {
    if (messages.length <= 50) return messages // 少量消息全部渲染
    return messages.slice(visibleRange.start, visibleRange.end)
  }, [messages, visibleRange])

  // 切换角色时，加载该角色的拍一拍后缀
  useEffect(() => {
    const charId = currentSession?.id
    if (!charId) { setPatSuffixState('小脑袋'); return }
    kvGet<string>(`patSuffix-${charId}`).then((saved) => {
      setPatSuffixState(saved || '小脑袋')
    }).catch(() => setPatSuffixState('小脑袋'))
  }, [currentSession?.id])

  const setPatSuffix = useCallback((suffix: string): void => {
    const charId = useChatSessionStore.getState().currentSession?.id
    if (charId) kvSetSync(`patSuffix-${charId}`, suffix)
    setPatSuffixState(suffix)
  }, [])

  useEffect(() => {
    const charId = currentSession?.id
    if (!charId) { setObjectAvatar(null); return }
    kvGet<string>(`char-avatar-${charId}`).then((saved) => {
      setObjectAvatar(saved && saved.startsWith('data:image') ? saved : null)
    }).catch(() => setObjectAvatar(null))
  }, [currentSession?.id])

  const chatBg = currentSession?.id ? chatBgStore.getBg(currentSession.id) : '#FFFFFF'

  const handleQuote = useCallback((messageId: string): void => {
    const msg = messages.find((m) => m.id === messageId)
    if (msg) {
      setQuoteMessage({ id: msg.id, content: msg.content })
    }
  }, [messages])

  const handlePat = useCallback((_targetAvatar: string, suffix: string): void => {
    const charId = useChatStore.getState().currentCharacterId || 'default'
    const { addMessage } = useChatStore.getState()
    const targetName = currentSession?.name || '对方'
    const finalSuffix = suffix || patSuffix

    addMessage({
      role: 'system',
      content: `你拍了拍${targetName}的${finalSuffix}`,
      type: 'pat',
      metadata: { from: '我', to: targetName, suffix: finalSuffix }
    })

    const { updateLastMessage } = useChatListStore.getState()
    updateLastMessage(charId, `你拍了拍${targetName}的${finalSuffix}`)
  }, [currentSession?.name, patSuffix])

  const handlePatSuffixChange = useCallback((suffix: string): void => {
    setPatSuffix(suffix || '小脑袋')
  }, [])

  const handleAvatarChange = useCallback((dataUrl: string): void => {
    setObjectAvatar(dataUrl)
    const charId = useChatSessionStore.getState().currentSession?.id
    if (charId) {
      kvSetSync(`char-avatar-${charId}`, dataUrl)
      useChatListStore.getState().bumpAvatarVersion(charId)
    }
  }, [])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!currentSession?.id) return

    try {
      await window.electronAPI?.invoke('character:delete', { id: currentSession.id })

      kvDeleteSync(`char-data-${currentSession.id}`)
      kvDeleteSync(`char-avatar-${currentSession.id}`)
      kvDeleteSync(`patSuffix-${currentSession.id}`)
      kvDeleteSync(`chatBg-${currentSession.id}`)

      useChatStore.getState().clearCharacterMessages(currentSession.id)

      useChatListStore.setState((state) => ({
        sessions: state.sessions.filter((s) => s.id !== currentSession.id)
      }))

      useChatSessionStore.getState().setCurrentSession(null)
    } catch (error) {
      console.error('删除角色失败:', error)
    }
  }, [currentSession])

  const handleClearQuote = useCallback((): void => {
    setQuoteMessage(null)
  }, [])

  // 删除模式相关函数
  const toggleDeleteMode = useCallback((): void => {
    setDeleteMode(prev => !prev)
    setSelectedIds(new Set())
  }, [])

  const handleSelectMessage = useCallback((id: string, selected: boolean): void => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback((): void => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(messages.map(m => m.id)))
    }
  }, [messages, selectedIds.size])

  const handleDeleteSelected = useCallback((): void => {
    if (selectedIds.size === 0) return
    
    const confirmed = window.confirm(`确定要删除选中的 ${selectedIds.size} 条消息吗？\n此操作仅删除前端显示，不会影响本地文件。`)
    if (!confirmed) return

    useChatStore.getState().deleteMessages(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds])

  const handleClearAll = useCallback((): void => {
    const confirmed = window.confirm('确定要清空当前聊天的所有消息吗？\n此操作仅删除前端显示，不会影响本地文件。')
    if (!confirmed) return

    useChatStore.getState().clearMessages()
    setSelectedIds(new Set())
    setDeleteMode(false)
  }, [])

  const displayName = currentSession?.name || '选择一个聊天'
  const isOnline = currentSession?.online ?? false

  const displayAvatar = (objectAvatar && objectAvatar.startsWith('data:image'))
    ? objectAvatar
    : (currentSession?.avatar || '💬')

  const bgStyle: React.CSSProperties = chatBg.startsWith('data:') || chatBg.startsWith('http')
    ? { backgroundImage: `url(${chatBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: chatBg }

  return (
    <div className="chat-window">
      <TitleBar
        name={displayName}
        avatar={objectAvatar || displayAvatar}
        online={isOnline}
        isTyping={isLoading}
        currentPatSuffix={patSuffix}
        onPatSuffixChange={handlePatSuffixChange}
        onAvatarChange={handleAvatarChange}
        onDelete={handleDelete}
        onSearch={() => setShowSearch(true)}
        onToggleDeleteMode={toggleDeleteMode}
        deleteMode={deleteMode}
        characterId={currentSession?.id}
      />

      <NowPlaying
        songName={useMusicStore.getState().currentSong?.name || ''}
        artist={useMusicStore.getState().currentSong?.artist || ''}
        isPlaying={useMusicStore.getState().isPlaying}
      />

      <SearchBar
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        onJumpTo={handleJumpToMessage}
      />

      {/* 删除模式工具栏 */}
      {deleteMode && (
        <div className="chat-window__delete-toolbar">
          <label className="chat-window__delete-select-all">
            <input
              type="checkbox"
              checked={selectedIds.size === messages.length && messages.length > 0}
              onChange={handleSelectAll}
            />
            <span>全选 ({selectedIds.size}/{messages.length})</span>
          </label>
          <button
            className="chat-window__delete-btn chat-window__delete-btn--danger"
            onClick={handleDeleteSelected}
            disabled={selectedIds.size === 0}
          >
            删除选中
          </button>
          <button
            className="chat-window__delete-btn chat-window__delete-btn--warning"
            onClick={handleClearAll}
          >
            清空全部
          </button>
          <button
            className="chat-window__delete-btn"
            onClick={toggleDeleteMode}
          >
            取消
          </button>
        </div>
      )}

      <div className="chat-window__messages" ref={containerRef} style={bgStyle}>
        {!currentSession ? (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon">💬</div>
            <div className="chat-window__empty-title">选择一个聊天</div>
            <div className="chat-window__empty-subtitle">从左侧列表选择一个对话开始</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon">👋</div>
            <div className="chat-window__empty-title">开始聊天吧</div>
            <div className="chat-window__empty-subtitle">发送一条消息，和TA说说话</div>
          </div>
        ) : (
          <>
            {/* 虚拟滚动顶部占位 */}
            {messages.length > 50 && visibleRange.start > 0 && (
              <div style={{ height: `${visibleRange.start * 60}px`, flexShrink: 0 }} />
            )}

            {visibleMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                type={msg.type}
                time={new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
                avatar={msg.role === 'assistant' ? displayAvatar : undefined}
                status={msg.status}
                metadata={msg.metadata}
                onQuote={handleQuote}
                onPat={handlePat}
                highlight={msg.id === highlightMessageId}
                selectMode={deleteMode}
                selected={selectedIds.has(msg.id)}
                onSelect={handleSelectMessage}
              />
            ))}

            {/* 虚拟滚动底部占位 */}
            {messages.length > 50 && visibleRange.end < messages.length && (
              <div style={{ height: `${(messages.length - visibleRange.end) * 60}px`, flexShrink: 0 }} />
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <InputArea
        quoteMessage={quoteMessage}
        onClearQuote={handleClearQuote}
        disabled={isLoading}
        characterId={currentSession?.id}
      />
    </div>
  )
}