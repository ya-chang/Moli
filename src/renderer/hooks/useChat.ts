// src/renderer/hooks/useChat.ts
// 聊天 Hook — 支持碎片式交付 + 引用 + 实时更新列表

import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useChatListStore } from '../stores/chatListStore'
import { useChatSessionStore } from '../stores/chatSessionStore'
import { useUserStore } from '../stores/userStore'
import { useMusicStore } from '../stores/musicStore'
import type { Message } from '../stores/chatStore'

// 模块级去重：记录已处理的 chunkId，防止 StrictMode 重复处理
const processedChunkIds = new Set<string>()

// 去除重复片段 — 支持空格分隔、标点分隔、连续重复
const deduplicateText = (text: string): string => {
  if (!text || text.length < 4) return text
  
  let result = text
  
  // 1. 空格分隔的重复（如 "xxx xxx"）
  result = result.replace(/(.{2,80}?)\s+\1/g, '$1')
  
  // 2. 标点分隔的重复（如 "xxx、xxx、"）
  result = result.replace(/(.{2,80}?)([。！？.!?\~～…，,、；;：:"""''「」『』【】《》〈〉（）()〔〕\[\]{}])\1\2/g, '$1$2')
  
  // 3. 连续重复（如表情符号 "(xxx)(xxx)"）
  result = result.replace(/(.{2,40}?)\1+/g, '$1')
  
  // 递归处理多层重复
  if (result.length < text.length) {
    return deduplicateText(result)
  }
  
  return result
}

// 默认角色配置 — DeepSeek 官方模型
const DEFAULT_CHAR = {
  id: 'default',
  provider: 'deepseek',
  model: 'deepseek-v4-flash'
}

export const useChat = (): {
  messages: Message[]
  isLoading: boolean
  sendMessage: (content: string, quoteMessageId?: string, images?: string[]) => Promise<void>
  sendEmojiMessage: (emojiId: string, filePath: string) => void
  clearMessages: () => void
} => {
  const {
    messages,
    isLoading,
    addMessage,
    updateMessage,
    setLoading,
    clearMessages
  } = useChatStore()

  const { updateLastMessage } = useChatListStore()
  const assistantIdRef = useRef<string | null>(null)

  // 监听碎片事件（模块级去重，防止 StrictMode 重复注册）
  useEffect(() => {
    if (!window.electronAPI) return

    const handleChunk = (...args: unknown[]): void => {
      const data = args[0] as {
        chunkId: string
        content: string
        index: number
        total: number
        isLast: boolean
        replace?: boolean
        emoji?: boolean
        emojiId?: string
        emojiFilePath?: string
        characterId?: string
      }

      // 表情包消息：独立处理，不依赖 assistantIdRef
      if (data.emoji && data.emojiId && data.emojiFilePath) {
        // 去重：同一 chunkId 只处理一次
        if (processedChunkIds.has(data.chunkId)) return
        processedChunkIds.add(data.chunkId)
        // 清理旧记录，保留最近100条
        if (processedChunkIds.size > 100) {
          const first = processedChunkIds.values().next().value
          if (first) processedChunkIds.delete(first)
        }

        const charId = data.characterId || useChatStore.getState().currentCharacterId || 'default'
        useChatStore.getState().addMessage({
          role: 'assistant',
          content: `[emoji:${data.emojiId}]`,
          type: 'emoji',
          metadata: { emojiId: data.emojiId, filePath: data.emojiFilePath, characterId: charId }
        })
        useChatListStore.getState().updateLastMessage(charId, '[表情包]')
        return
      }

      const id = assistantIdRef.current
      if (!id) return

      // replace 模式：直接替换内容（人味儿处理后）
      if (data.replace) {
        useChatStore.getState().updateMessage(id, {
          content: data.content,
          status: 'sent'
        })
        const state = useChatStore.getState()
        const charId = state.currentCharacterId || 'default'
        useChatListStore.getState().updateLastMessage(charId, data.content.length > 20 ? data.content.slice(0, 20) + '...' : data.content)
        return
      }

      const current = useChatStore.getState().messages.find((m) => m.id === id)
      const existingContent = current?.content ?? ''
      
      // 拼接内容并实时去重
      const rawContent = existingContent + data.content
      const newContent = deduplicateText(rawContent)

      useChatStore.getState().updateMessage(id, {
        content: newContent,
        status: data.isLast ? 'sent' : 'sending'
      })

      // 最后一个碎片时，更新聊天列表的 lastMessage
      if (data.isLast) {
        const state = useChatStore.getState()
        const charId = state.currentCharacterId || 'default'
        useChatListStore.getState().updateLastMessage(charId, newContent.length > 20 ? newContent.slice(0, 20) + '...' : newContent)
      }
    }

    window.electronAPI.on('chat:chunk', handleChunk)

    return () => {
      window.electronAPI?.off('chat:chunk', handleChunk)
    }
  }, []) // 空依赖，只注册一次

  const sendMessage = async (content: string, quoteMessageId?: string, images?: string[]): Promise<void> => {
    if (!content.trim() || isLoading) return
    // 立即锁定，防止快速连发穿透
    setLoading(true)

    const charId = useChatStore.getState().currentCharacterId || DEFAULT_CHAR.id

    // 从 localStorage 读取角色的 API 配置
    let provider = DEFAULT_CHAR.provider
    let model = DEFAULT_CHAR.model
    let apiKey = ''
    let baseUrl = ''

    // 优先从当前会话获取角色 ID
    const sessionId = useChatSessionStore.getState().currentSession?.id
    const actualCharId = sessionId || charId

    // 从后端读取角色配置（config.yaml 是 source of truth）
    try {
      const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
      const charConfig = charList?.find(c => c.id === actualCharId)
      if (charConfig) {
        if (charConfig.provider) provider = charConfig.provider as string
        if (charConfig.model) model = charConfig.model as string
        if (charConfig.apiKey) apiKey = charConfig.apiKey as string
        if (charConfig.baseUrl) baseUrl = charConfig.baseUrl as string
      }
    } catch { /* ignore */ }

    // 更新聊天列表的 lastMessage 为用户消息
    updateLastMessage(charId, content.length > 20 ? content.slice(0, 20) + '...' : content)

    // 构建引用元数据 — 直接从 messagesByCharacter 查找，确保切换角色后也能找到
    const quoteMeta: Record<string, unknown> | undefined = quoteMessageId
      ? (() => {
          const state = useChatStore.getState()
          const charId = state.currentCharacterId || 'default'
          const charMessages = state.messagesByCharacter[charId] || []
          const quotedMsg = charMessages.find((m) => m.id === quoteMessageId)
          return quotedMsg && quotedMsg.content
            ? {
                quotedMessageId: quotedMsg.id,
                quotedContent: quotedMsg.content,
                quotedRole: quotedMsg.role
              }
            : undefined
        })()
      : undefined

    // 先取 history，再 addMessage，避免 history 包含当前用户消息
    const rawHistory = useChatStore.getState().messages.slice(-20)
    const history = rawHistory.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.role === 'assistant' ? deduplicateText(m.content) : m.content
    }))

    // 有图片时保存为 image 类型
    const hasImages = images && images.length > 0
    addMessage({
      role: 'user',
      content,
      type: hasImages ? 'image' : 'text',
      metadata: hasImages ? { ...quoteMeta, images } : quoteMeta
    })

    const assistantId = addMessage({
      role: 'assistant',
      content: '',
      type: 'text'
    })
    assistantIdRef.current = assistantId

    try {
      // 读取角色的人设（从后端 config.yaml）
      let persona = ''
      try {
        const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
        const charConfig = charList?.find(c => c.id === charId)
        if (charConfig?.persona) persona = charConfig.persona as string
      } catch { /* ignore */ }

      const result = await window.electronAPI?.invoke('chat:send', {
        content,
        characterId: charId,
        provider,
        model,
        apiKey,
        baseUrl,
        history,
        persona,
        quoteContent: quoteMeta?.quotedContent as string | undefined,
        userName: useUserStore.getState().name || undefined,
        images,
        currentSong: useMusicStore.getState().currentSong || undefined
      })

      const response = result as {
        success: boolean
        data?: { content: string; model: string }
        error?: string
      }

      if (!response?.success) {
        // 解析具体错误原因
        let errorMsg = '消息发送失败，请重试'
        const err = response?.error || ''
        if (err.includes('401') || err.includes('Unauthorized')) {
          errorMsg = 'API Key 无效或已过期，请检查角色配置'
        } else if (err.includes('429') || err.includes('rate')) {
          errorMsg = '请求过于频繁，请稍后再试'
        } else if (err.includes('timeout') || err.includes('超时')) {
          errorMsg = 'AI 响应超时，请稍后再试'
        } else if (err.includes('500') || err.includes('502') || err.includes('503')) {
          errorMsg = 'AI 服务暂时不可用，请稍后再试'
        } else if (err.includes('fetch failed') || err.includes('network')) {
          errorMsg = '网络连接失败，请检查网络'
        } else if (err) {
          errorMsg = `发送失败: ${err.slice(0, 80)}`
        }
        updateMessage(assistantId, {
          content: errorMsg,
          status: 'error',
          error: response?.error
        })
        updateLastMessage(charId, errorMsg)
      }
    } catch (error) {
      updateMessage(assistantId, {
        content: '网络连接异常，请检查网络后重试',
        status: 'error',
        error: error instanceof Error ? error.message : '未知错误'
      })
      updateLastMessage(charId, '网络连接异常')
    } finally {
      setLoading(false)
      assistantIdRef.current = null
    }
  }

  const sendEmojiMessage = (emojiId: string, filePath: string): void => {
    const charId = useChatStore.getState().currentCharacterId || DEFAULT_CHAR.id

    // 更新聊天列表的 lastMessage
    updateLastMessage(charId, '[表情包]')

    // 添加表情包消息
    addMessage({
      role: 'user',
      content: `[emoji:${emojiId}]`,
      type: 'emoji',
      metadata: { emojiId, filePath, characterId: charId }
    })
  }

  return { messages, isLoading, sendMessage, sendEmojiMessage, clearMessages }
}
