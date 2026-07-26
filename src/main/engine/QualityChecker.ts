// src/main/engine/QualityChecker.ts
// 对话质量自检 — 灵感来源: Xiaomi-Robotics-U0 的视觉 token 约束机制
// U0源码: logits_processor.py (in_image_logits_processor 中的 token mask)
// 核心思想: 通过检查确保回复质量合格

/**
 * 质量检查结果
 */
export interface QualityCheckResult {
  passed: boolean
  issues: string[]
  severity: 'ok' | 'warn' | 'fail'
}

/**
 * 角色配置（用于语气检测）
 */
export interface PersonaConfig {
  style: 'gentle' | 'playful' | 'serious' | 'tsundere'
  catchphrases: string[]
  bannedWords: string[]
}

export class QualityChecker {
  /**
   * 全面质量检查
   * 检查维度: 空回复、长度异常、重复检测、人设偏离、语气一致性
   */
  check(reply: string, context: {
    recentMessages: string[]     // 最近的回复 (检测重复)
    persona?: PersonaConfig     // 角色配置 (检测语气)
    userMessage?: string        // 用户消息 (检测相关性)
  }): QualityCheckResult {
    const issues: string[] = []

    // 1. 空回复检测
    if (!reply.trim()) {
      issues.push('空回复')
      return { passed: false, issues, severity: 'fail' }
    }

    // 2. 长度异常检测
    if (reply.length > 500) {
      issues.push('回复过长')
    }
    if (reply.length < 2 && !this.isEmoji(reply)) {
      issues.push('回复过短')
    }

    // 3. 重复检测 (使用编辑距离算法)
    if (this.isRepetitive(reply, context.recentMessages)) {
      issues.push('回复内容与之前重复')
    }

    // 4. 人设偏离检测
    if (this.isOutOfCharacter(reply)) {
      issues.push('回复偏离人设')
    }

    // 5. 语气一致性检测
    if (context.persona && !this.isToneConsistent(reply, context.persona.style)) {
      issues.push('语气与人设不一致')
    }

    // 6. 禁用词检测
    if (context.persona?.bannedWords && this.containsBannedWords(reply, context.persona.bannedWords)) {
      issues.push('使用了禁用词')
    }

    const severity = issues.length === 0 ? 'ok' : issues.length <= 1 ? 'warn' : 'fail'
    return { passed: issues.length === 0, issues, severity }
  }

  /**
   * 重复检测 - 使用编辑距离算法
   * 检查回复是否和最近的回复高度相似
   */
  private isRepetitive(reply: string, recent: string[]): boolean {
    // 检查与最近回复的相似度
    for (const prev of recent.slice(-5)) {
      const similarity = this.stringSimilarity(reply, prev)
      if (similarity > 0.7) return true
    }
    
    // 检查是否包含重复的句子
    const sentences = reply.split(/[。！？~]/g).filter(s => s.trim().length > 5)
    const uniqueSentences = new Set(sentences)
    if (sentences.length - uniqueSentences.size > 1) return true

    return false
  }

  /**
   * 字符串相似度 - Levenshtein编辑距离
   * 比原来的字符集交集算法更准确
   */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0
    
    // 限制比较长度，避免长文本计算过慢
    const maxLen = 100
    const s1 = a.slice(0, maxLen)
    const s2 = b.slice(0, maxLen)
    
    // 构建编辑距离矩阵
    const matrix: number[][] = []
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j
    }
    
    // 填充矩阵
    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // 删除
          matrix[i][j - 1] + 1,      // 插入
          matrix[i - 1][j - 1] + cost // 替换
        )
      }
    }
    
    const distance = matrix[s1.length][s2.length]
    return 1 - distance / Math.max(s1.length, s2.length)
  }

  /**
   * 人设偏离检测
   * 检查是否暴露AI身份或提及模型名
   */
  private isOutOfCharacter(reply: string): boolean {
    const oocPatterns = [
      /作为(一个)?AI/i,
      /我(是|作为)(语言模型|助手|程序)/i,
      /OpenAI|ChatGPT|Claude|DeepSeek|MiMo/i,
      /我(没有|无法)(情感|感受|情绪)/i,
    ]
    return oocPatterns.some(p => p.test(reply))
  }

  /**
   * 语气一致性检测
   * 检查回复是否符合角色设定的语气风格
   */
  private isToneConsistent(reply: string, style: PersonaConfig['style']): boolean {
    // 温柔人设不说粗话
    if (style === 'gentle' && /滚|烦|闭嘴|切|笨蛋/.test(reply)) return false
    
    // 活泼人设不说太正式的话
    if (style === 'playful' && /严肃|认真|正经|抱歉/.test(reply)) return false
    
    // 傲娇人设不说太直接的表白
    if (style === 'tsundere' && /喜欢你|爱你|想你/.test(reply)) return false
    
    return true
  }

  /**
   * 禁用词检测
   */
  private containsBannedWords(reply: string, bannedWords: string[]): boolean {
    return bannedWords.some(word => reply.includes(word))
  }

  /**
   * 检查是否为纯emoji
   */
  private isEmoji(text: string): boolean {
    return /^[\p{Emoji}\s]+$/u.test(text)
  }
}
