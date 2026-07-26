// src/main/memory/ProximityMemoryRetriever.ts
// 基于距离的记忆检索 — 灵感来源: Xiaomi-Robotics-U0 的 Proximity Attention Mask
// U0源码: xr_u0_flashar/model.py (_build_proximity_allow)
// 核心思想: 记忆检索时考虑时间距离和语义距离，而不是简单排序

import { LongTerm, type LongTermMemory } from './LongTerm'
import { logger } from '../utils/logger'

/**
 * 最近消息（用于上下文相关度计算）
 */
interface RecentMessage {
  content: string
  timestamp: number
}

/**
 * 带分数的记忆
 */
interface ScoredMemory {
  memory: LongTermMemory
  score: number
}

/**
 * ProximityMemoryRetriever — 基于距离的记忆检索
 * 
 * U0的Proximity Mask: 每个位置只attend Manhattan距离更小的已生成位置
 * 迁移: 记忆检索时，考虑三种距离:
 *   1. 语义距离: 和查询的语义相似度 (50%)
 *   2. 时间距离: 最近的记忆权重更高 (30%)
 *   3. 上下文距离: 和最近对话相关的记忆权重更高 (20%)
 */
export class ProximityMemoryRetriever {
  private longTerm: LongTerm
  private embeddingCache: Map<string, number[]> = new Map()

  constructor(longTerm: LongTerm) {
    this.longTerm = longTerm
  }

  /**
   * 基于距离的记忆检索
   * 
   * score = semanticScore * 0.5 + timeScore * 0.3 + contextScore * 0.2
   * 
   * @param query 用户查询
   * @param recentContext 最近的对话上下文
   * @param limit 返回数量
   * @returns 按相关度排序的记忆
   */
  async search(
    query: string,
    recentContext: RecentMessage[] = [],
    limit: number = 10
  ): Promise<LongTermMemory[]> {
    // 获取所有记忆
    const allMemories = this.longTerm.getAll()
    
    if (allMemories.length === 0) {
      return []
    }

    // 计算每个记忆的分数
    const scored: ScoredMemory[] = allMemories.map(memory => ({
      memory,
      score: this.calculateScore(memory, query, recentContext)
    }))

    // 按分数降序排序，取前limit个
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.memory)
  }

  /**
   * 计算记忆的相关度分数
   * 
   * @param memory 记忆
   * @param query 查询
   * @param recentContext 最近上下文
   * @returns 分数 (0-1)
   */
  private calculateScore(
    memory: LongTermMemory,
    query: string,
    recentContext: RecentMessage[]
  ): number {
    // 1. 语义距离 (50%) — 简单的关键词匹配
    const semanticScore = this.semanticSimilarity(memory.content, query)
    
    // 2. 时间距离 (30%) — 最近的记忆权重更高
    const timeScore = this.timeDecay(memory)
    
    // 3. 上下文距离 (20%) — 和最近对话相关的记忆权重更高
    const contextScore = this.contextRelevance(memory, recentContext)

    // 加权融合
    return semanticScore * 0.5 + timeScore * 0.3 + contextScore * 0.2
  }

  /**
   * 语义相似度 (简化版)
   * 使用关键词重叠度，实际项目可用embedding
   * 
   * @param content 记忆内容
   * @param query 查询
   * @returns 相似度 (0-1)
   */
  private semanticSimilarity(content: string, query: string): number {
    // 提取关键词
    const contentWords = this.extractKeywords(content)
    const queryWords = this.extractKeywords(query)
    
    if (queryWords.length === 0 || contentWords.length === 0) {
      return 0
    }
    
    // 计算重叠度
    const overlap = contentWords.filter(w => queryWords.includes(w)).length
    const union = new Set([...contentWords, ...queryWords]).size
    
    // Jaccard相似度
    return overlap / union
  }

  /**
   * 提取关键词（简化版）
   */
  private extractKeywords(text: string): string[] {
    // 简单分词，实际项目可用jieba等分词库
    const words: string[] = []
    
    // 中文：按字分（简化）
    for (const char of text) {
      if (/[\u4e00-\u9fa5]/.test(char)) {
        words.push(char)
      }
    }
    
    // 英文：按单词分
    const englishWords = text.match(/[a-zA-Z]+/g) || []
    words.push(...englishWords.map(w => w.toLowerCase()))
    
    // 2-gram组合（提高匹配精度）
    const bigrams: string[] = []
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.push(words[i] + words[i + 1])
    }
    
    return [...words, ...bigrams]
  }

  /**
   * 时间衰减分数
   * 最近的记忆分数最高，越早的记忆分数越低
   * 
   * @param memory 记忆
   * @returns 分数 (0-1)
   */
  private timeDecay(memory: LongTermMemory): number {
    // 如果没有时间戳，返回中等分数
    if (!memory.createdAt) {
      return 0.5
    }
    
    const createdAt = new Date(memory.createdAt).getTime()
    const now = Date.now()
    const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60)
    
    // 指数衰减: 一周(168小时)后分数降到0.5
    return Math.exp(-hoursSinceCreated / 168)
  }

  /**
   * 上下文相关度
   * 和最近对话相关的记忆权重更高
   * 
   * @param memory 记忆
   * @param recentContext 最近上下文
   * @returns 分数 (0-1)
   */
  private contextRelevance(memory: LongTermMemory, recentContext: RecentMessage[]): number {
    if (recentContext.length === 0) {
      return 0.5
    }
    
    // 提取记忆的关键词
    const memoryWords = this.extractKeywords(memory.content)
    
    let maxOverlap = 0
    
    // 和每条最近消息计算重叠度
    for (const msg of recentContext.slice(-5)) {
      const msgWords = this.extractKeywords(msg.content)
      
      if (msgWords.length === 0 || memoryWords.length === 0) {
        continue
      }
      
      const overlap = memoryWords.filter(w => msgWords.includes(w)).length
      const overlapRatio = overlap / Math.max(memoryWords.length, msgWords.length)
      
      maxOverlap = Math.max(maxOverlap, overlapRatio)
    }
    
    return maxOverlap
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.embeddingCache.clear()
  }
}
