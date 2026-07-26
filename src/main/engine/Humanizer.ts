// src/main/engine/Humanizer.ts
// "人味儿"注入器 — 让 AI 回复更像真人
// 灵感来源: Xiaomi-Robotics-U0 的 streaming_generate 流式输出
// U0源码: xr_u0_ar/generation.py
// 核心思想: 模拟真人打字节奏，重要消息慢发，简单消息快发

/**
 * 消息类型（用于打字节奏计算）
 */
export type MessageType = 'emotional' | 'factual' | 'flirty' | 'comfort' | 'angry' | 'playful' | 'casual'

export interface HumanizerConfig {
  emojiOnlyChance: number       // 只回一个表情的概率，默认 0.03
  longDelayChance: number       // 长延迟概率，默认 0.02
  longDelayRange: [number, number]  // 30-120秒
  recallChance: number          // 撤回概率，默认 0.02
  typoChance: number            // 打错字概率，默认 0.03
  baseTypingSpeed: number       // 基础打字速度 (ms/字)，默认 50
}

const DEFAULT_CONFIG: HumanizerConfig = {
  emojiOnlyChance: 0.03,
  longDelayChance: 0.02,
  longDelayRange: [30, 120],
  recallChance: 0.02,
  typoChance: 0.03,
  baseTypingSpeed: 50
}

const COMMON_EMOJIS = ['😊', '😂', '❤️', '👍', '🥰', '😍', '😘', '🥺']

const COMMON_TYPOS: Array<[string, string]> = [
  ['的', '地'],
  ['在', '再'],
  ['吗', '嘛'],
  ['啊', '阿'],
  ['哦', '噢'],
  ['嗯', '唔'],
  ['哈哈', '蛤蛤'],
  ['可爱', '可耐'],
]

/**
 * 打字节奏倍率
 * 不同消息类型的打字速度不同
 */
const TYPING_MULTIPLIER: Record<MessageType, number> = {
  emotional: 1.5,  // 情感消息打字慢（在斟酌措辞）
  flirty: 1.3,     // 撩人消息稍慢
  factual: 0.7,    // 事实回答快
  angry: 0.5,      // 生气时打字快（冲动）
  playful: 1.1,    // 俏皮消息稍快
  comfort: 1.2,    // 安慰消息稍慢（温柔）
  casual: 1.0,     // 正常速度
}

export class Humanizer {
  private config: HumanizerConfig

  constructor(config?: Partial<HumanizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 处理回复内容
   */
  process(content: string, messageType: MessageType = 'casual'): {
    content: string
    isEmojiOnly: boolean
    shouldRecall: boolean
    shouldLongDelay: boolean
    typingDelay: number
  } {
    let processedContent = content
    let isEmojiOnly = false

    // 偶尔只回一个表情
    if (Math.random() < this.config.emojiOnlyChance) {
      const emoji = COMMON_EMOJIS[Math.floor(Math.random() * COMMON_EMOJIS.length)]
      return { 
        content: emoji, 
        isEmojiOnly: true, 
        shouldRecall: false, 
        shouldLongDelay: false,
        typingDelay: 500
      }
    }

    // 偶尔打错字
    if (Math.random() < this.config.typoChance) {
      processedContent = this.injectTypo(content)
    }

    // 去除重复内容
    processedContent = this.deduplicate(processedContent)

    // 计算打字延迟
    const typingDelay = this.calculateTypingDelay(processedContent, messageType)

    return {
      content: processedContent,
      isEmojiOnly,
      shouldRecall: Math.random() < this.config.recallChance,
      shouldLongDelay: Math.random() < this.config.longDelayChance,
      typingDelay
    }
  }

  /**
   * 计算打字延迟
   * 
   * U0对应: generation.py streaming_generate 的流式输出控制
   * U0: 文本逐字 yield，图像一次性 yield
   * 这里: 根据消息类型和长度控制发送节奏
   * 
   * @param message 消息内容
   * @param messageType 消息类型
   * @returns 延迟时间 (ms)
   */
  calculateTypingDelay(message: string, messageType: MessageType): number {
    const baseDelay = message.length * this.config.baseTypingSpeed
    
    // 根据消息类型调整倍率
    const multiplier = TYPING_MULTIPLIER[messageType] || 1.0
    
    // 加随机抖动 (±30%)
    const jitter = 0.7 + Math.random() * 0.6
    
    // 限制在 0.5-5 秒
    return Math.min(5000, Math.max(500, baseDelay * multiplier * jitter))
  }

  /**
   * 消息拆分 — 真人微信聊天会把一段话拆成 2-3 条发
   * 
   * @param message 原始消息
   * @returns 拆分后的消息数组
   */
  splitMessage(message: string): string[] {
    // 如果很短，不拆
    if (message.length < 15) return [message]

    // 按句号/感叹号/问号拆分
    const sentences = message.split(/(?<=[。！？~])/g).filter(s => s.trim())
    if (sentences.length <= 1) return [message]

    // 每 1-2 句合并为一条
    const chunks: string[] = []
    for (let i = 0; i < sentences.length; i += 2) {
      chunks.push(sentences.slice(i, i + 2).join(''))
    }
    return chunks
  }

  /**
   * 检查是否应该执行真人行为
   * 
   * @returns 行为类型
   */
  shouldDoHumanAction(): { action: 'normal' | 'emoji_only' | 'long_pause' | null } {
    const rand = Math.random()
    if (rand < 0.03) return { action: 'emoji_only' }    // 3% 概率只回 emoji
    if (rand < 0.05) return { action: 'long_pause' }     // 2% 概率"已读不回"一会
    return { action: 'normal' }
  }

  /**
   * 去除重复的句子
   */
  private deduplicate(content: string): string {
    // 先处理空格分隔的重复片段
    let processed = this.removeSpaceSeparatedDuplicates(content)
    
    // 按标点分句
    const sentences = processed.split(/(?<=[。！？.!?\n～…，,、])/)
    const seenKeys: string[] = []
    const result: string[] = []

    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (!trimmed) {
        result.push(sentence)
        continue
      }
      
      // 去掉标点和空格后比较
      const key = trimmed.replace(/[。！？.!?\s，,、～…]/g, '')
      if (!key) {
        result.push(sentence)
        continue
      }

      // 精确匹配
      if (seenKeys.includes(key)) {
        continue
      }

      // 近似匹配：与已有句子相似度超过 70% 视为重复
      let isDuplicate = false
      for (const seen of seenKeys) {
        if (this.similarity(key, seen) > 0.7) {
          isDuplicate = true
          break
        }
      }

      if (isDuplicate) continue

      seenKeys.push(key)
      result.push(sentence)
    }

    return result.join('')
  }

  /**
   * 去除空格分隔的重复片段
   */
  private removeSpaceSeparatedDuplicates(content: string): string {
    let result = content.replace(/(.{2,80}?)\s+\1/g, '$1')
    result = result.replace(/(.{2,80}?)([。！？.!?\~～…，,、；;：:"""''「」『』【】《》〈〉（）()〔〕\[\]{}])\1\2/g, '$1$2')
    result = result.replace(/(.{2,40}?)\1+/g, '$1')
    
    if (result.length < content.length) {
      return this.removeSpaceSeparatedDuplicates(result)
    }
    return result
  }

  /**
   * 计算两个字符串的相似度
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0

    const shorter = a.length < b.length ? a : b
    const longer = a.length < b.length ? b : a

    if (shorter.length / longer.length < 0.5) return 0

    const shorterChars = new Map<string, number>()
    for (const ch of shorter) {
      shorterChars.set(ch, (shorterChars.get(ch) || 0) + 1)
    }

    let intersection = 0
    for (const ch of longer) {
      const count = shorterChars.get(ch)
      if (count && count > 0) {
        intersection++
        shorterChars.set(ch, count - 1)
      }
    }

    return (2 * intersection) / (shorter.length + longer.length)
  }

  /**
   * 注入错别字
   */
  private injectTypo(content: string): string {
    const candidates = COMMON_TYPOS.filter(([original]) => content.includes(original))
    if (candidates.length === 0) return content

    const [original, typo] = candidates[Math.floor(Math.random() * candidates.length)]
    return content.replace(original, typo)
  }
}
