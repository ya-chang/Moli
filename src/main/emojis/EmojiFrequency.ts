// src/main/emojis/EmojiFrequency.ts
// 频率控制 — 跟随/每句/随机

export type FrequencyMode = 'follow_user' | 'every_message' | 'random'

export interface EmojiFrequencyConfig {
  mode: FrequencyMode
  randomChance: number // 随机模式的概率，默认0.3
}

export class EmojiFrequency {
  private config: EmojiFrequencyConfig
  private userEmojiRatio: number = 0

  constructor(config?: Partial<EmojiFrequencyConfig>) {
    this.config = {
      mode: config?.mode ?? 'follow_user',
      randomChance: config?.randomChance ?? 0.3
    }
  }

  /**
   * 是否应该发表情包
   */
  shouldSend(userMessageCount: number, userEmojiCount: number): boolean {
    switch (this.config.mode) {
      case 'follow_user':
        // 跟随用户频率
        // 用户发了10条消息有3条表情包 → 30%概率
        if (userMessageCount === 0) return false
        this.userEmojiRatio = userEmojiCount / userMessageCount
        return Math.random() < this.userEmojiRatio

      case 'every_message':
        // 每句话都发
        return true

      case 'random':
        // 随机概率
        return Math.random() < this.config.randomChance

      default:
        return false
    }
  }

  /**
   * 更新用户频率（学习）
   */
  updateUserRatio(totalMessages: number, emojiMessages: number): void {
    if (totalMessages > 0) {
      this.userEmojiRatio = emojiMessages / totalMessages
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): EmojiFrequencyConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EmojiFrequencyConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前用户表情包比例
   */
  getUserEmojiRatio(): number {
    return this.userEmojiRatio
  }
}
