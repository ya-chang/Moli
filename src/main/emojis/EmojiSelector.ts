// src/main/emojis/EmojiSelector.ts
// AI表情包选择 — 情绪匹配 + 上下文匹配

import type { EmojiMeta } from './EmojiManager'

export class EmojiSelector {
  private lastUsedId: string | null = null

  /**
   * 选择表情包
   * 优先级：上下文匹配 > 情绪匹配 > 随机
   */
  select(
    currentEmotion: string,
    userMessage: string,
    availableEmojis: EmojiMeta[]
  ): EmojiMeta | null {
    if (availableEmojis.length === 0) return null

    // 1. 情绪匹配
    const emotionMatched = availableEmojis.filter(e =>
      e.emotion === currentEmotion
    )

    // 2. 上下文匹配（用户消息中的关键词）
    const contextMatched = availableEmojis.filter(e =>
      e.tags.some(tag => userMessage.includes(tag))
    )

    // 3. 优先级：上下文匹配 > 情绪匹配 > 随机
    let candidates = contextMatched.length > 0
      ? contextMatched
      : emotionMatched.length > 0
        ? emotionMatched
        : availableEmojis

    // 4. 避免连续使用同一个
    candidates = candidates.filter(e =>
      e.id !== this.lastUsedId
    )

    if (candidates.length === 0) {
      candidates = availableEmojis
    }

    // 5. 选择使用次数最少的（轮换）
    candidates.sort((a, b) => a.usageCount - b.usageCount)

    const selected = candidates[0]
    this.lastUsedId = selected.id

    return selected
  }

  /**
   * 重置上次使用记录
   */
  reset(): void {
    this.lastUsedId = null
  }
}
