// src/main/memory/MemoryManager.ts
// 记忆管理器 — 协调短期/中期/长期记忆

import { ShortTerm, type ShortTermMessage } from './ShortTerm'
import { LongTerm, type LongTermMemory } from './LongTerm'
import { Summarizer, type ConversationSummary } from './Summarizer'
import { MemoryGrader } from './MemoryGrader'
import { ProximityMemoryRetriever } from './ProximityMemoryRetriever'
import { logger } from '../utils/logger'

export interface MemoryContext {
  recentMessages: ShortTermMessage[]
  relevantMemories: LongTermMemory[]
  summaries: ConversationSummary[]
}

/**
 * 最近消息（用于ProximityRetriever）
 */
interface RecentMessage {
  content: string
  timestamp: number
}

export class MemoryManager {
  private shortTerm: ShortTerm
  private longTerm: LongTerm
  private summarizer: Summarizer
  private grader: MemoryGrader
  private proximityRetriever: ProximityMemoryRetriever
  private summaries: ConversationSummary[] = []
  private characterId: string

  constructor(characterId: string) {
    this.characterId = characterId
    this.shortTerm = new ShortTerm(20)
    this.longTerm = new LongTerm(characterId)
    this.summarizer = new Summarizer()
    this.grader = new MemoryGrader()
    this.proximityRetriever = new ProximityMemoryRetriever(this.longTerm)
  }

  addMessage(message: ShortTermMessage): void {
    this.shortTerm.add(message)

    // 用户消息存入长期记忆
    if (message.role === 'user') {
      const { grade, importance } = this.grader.grade(message.content)
      if (importance > 0.3) {
        this.longTerm.add(message.content)
      }
    }
  }

  /**
   * 获取记忆上下文（带token预算控制）
   * 
   * Phase 3 优化:
   * - 使用 ProximityMemoryRetriever 进行基于距离的记忆检索
   * - 考虑语义距离、时间距离、上下文距离
   * 
   * @param query 用户查询
   * @param maxTokens 最大token数
   * @returns 记忆上下文
   */
  async getContext(query?: string, maxTokens: number = 300): Promise<MemoryContext> {
    let relevantMemories: LongTermMemory[]
    
    if (query) {
      // Phase 3: 使用 ProximityMemoryRetriever 进行基于距离的检索
      const recentContext: RecentMessage[] = this.shortTerm.getMessages().slice(-5).map(m => ({
        content: m.content,
        timestamp: m.timestamp
      }))
      
      relevantMemories = await this.proximityRetriever.search(query, recentContext, 10)
    } else {
      relevantMemories = this.longTerm.getAll().slice(0, 5)
    }

    // 按token预算过滤记忆
    const filteredMemories: LongTermMemory[] = []
    let tokenCount = 0
    
    for (const mem of relevantMemories) {
      const memTokens = this.estimateTokens(mem.content)
      if (tokenCount + memTokens > maxTokens) break
      filteredMemories.push(mem)
      tokenCount += memTokens
    }

    return {
      recentMessages: this.shortTerm.getMessages(),
      relevantMemories: filteredMemories,
      summaries: this.summaries.slice(-3)
    }
  }

  /**
   * 精确的token估算
   * 中文: 约1.5 token/字
   * 英文: 约1.3 token/词
   * 数字: 约0.5 token/个
   * 标点: 约0.3 token/个
   */
  private estimateTokens(text: string): number {
    let tokens = 0
    
    // 中文字符
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || []
    tokens += chineseChars.length * 1.5
    
    // 英文单词
    const englishWords = text.match(/[a-zA-Z]+/g) || []
    tokens += englishWords.length * 1.3
    
    // 数字
    const numbers = text.match(/\d+/g) || []
    tokens += numbers.length * 0.5
    
    // 标点和空格
    const others = text.match(/[^\u4e00-\u9fa5a-zA-Z\d]/g) || []
    tokens += others.length * 0.3
    
    return Math.ceil(tokens)
  }

  generateSummary(): ConversationSummary | null {
    const messages = this.shortTerm.getMessages()
    if (messages.length < 5) return null

    const summary = this.summarizer.summarize(messages)
    this.summaries.push(summary)
    this.shortTerm.clear()

    logger.info(`生成对话摘要: topics=${summary.topics.join(',')}`)
    return summary
  }

  /**
   * 搜索记忆（同步接口，兼容旧代码）
   */
  searchMemories(query: string): LongTermMemory[] {
    return this.longTerm.search(query, 5)
  }

  /**
   * 异步搜索记忆（使用ProximityRetriever）
   */
  async searchMemoriesAsync(query: string, limit: number = 5): Promise<LongTermMemory[]> {
    return this.proximityRetriever.search(query, [], limit)
  }

  save(): void {
    this.longTerm.save(this.characterId)
  }
}
