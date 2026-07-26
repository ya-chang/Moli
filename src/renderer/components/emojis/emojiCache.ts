// src/renderer/components/emojis/emojiCache.ts
// 表情包图片缓存 — 避免重复 IPC 读取

const cache = new Map<string, string>() // emojiId → base64 data URL

export const getCachedEmoji = (emojiId: string): string | undefined => {
  return cache.get(emojiId)
}

export const setCachedEmoji = (emojiId: string, dataUrl: string): void => {
  cache.set(emojiId, dataUrl)
  // 限制缓存大小，最多 100 张
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
}

export const clearEmojiCache = (): void => {
  cache.clear()
}
