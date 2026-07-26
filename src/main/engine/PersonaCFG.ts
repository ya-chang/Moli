// src/main/engine/PersonaCFG.ts
// 人设强化引擎 — 灵感来源: Xiaomi-Robotics-U0 的 CFG 机制
// U0源码: xr_u0_ar/logits_processor.py (UnbatchedClassifierFreeGuidanceLogitsForVisualTokenProcessor)
// 核心思想: 用guidance_scale控制人设约束强度，随着关系进展自然衰减

/**
 * CFG 配置
 * 控制人设约束强度
 */
export interface CFGConfig {
  strangerStrength: number   // 陌生人阶段强度 (默认 4.0，严格遵守角色)
  friendStrength: number     // 朋友阶段强度 (默认 3.0，保持风格但更自然)
  loverStrength: number      // 恋人阶段强度 (默认 2.0，更自由)
  decayPerTurn: number       // 每轮衰减 (默认 0.003)
  minStrength: number        // 最低强度 (默认 1.5)
  highThreshold: number      // 高约束阈值 (默认 3.0)
  midThreshold: number       // 中约束阈值 (默认 2.0)
}

/**
 * 角色人格配置
 */
export interface Persona {
  name: string
  personality: string
  style: 'gentle' | 'playful' | 'serious' | 'tsundere'
  catchphrases: string[]
  bannedWords: string[]
}

const DEFAULT_CONFIG: CFGConfig = {
  strangerStrength: 4.0,
  friendStrength: 3.0,
  loverStrength: 2.0,
  decayPerTurn: 0.003,
  minStrength: 1.5,
  highThreshold: 3.0,
  midThreshold: 2.0,
}

/**
 * 关系阶段
 */
export type RelationshipStage = 'stranger' | 'friend' | 'lover'

export class PersonaCFG {
  private config: CFGConfig
  private interactionCount: number = 0
  private persona: Persona

  constructor(persona: Persona, config: Partial<CFGConfig> = {}) {
    this.persona = persona
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 计算当前人设强度 (模拟 U0 的 guidance_scale)
   * 
   * U0: guidance_scale 控制 CFG 强度，值越高生成结果越严格匹配条件
   * 这里: 关系阶段 + 对话轮数 + 情感状态 → 人设强度
   * 
   * @param stage 关系阶段
   * @param emotion 情感状态（可选，用于计算modifier）
   * @returns 人设强度 (越高越严格)
   */
  getStrength(
    stage: RelationshipStage,
    emotion?: { trust: number; intimacy: number }
  ): number {
    // 基础强度：根据关系阶段
    const base = { stranger: 4.0, friend: 3.0, lover: 2.0 }[stage]
    
    // 对话轮数衰减：聊得越多，人设约束越弱（更自然）
    const decay = this.interactionCount * this.config.decayPerTurn
    
    // 情感modifier：信任度和亲密度越高，约束越弱
    let modifier = 0
    if (emotion) {
      modifier = ((emotion.trust - 50) / 100 + (emotion.intimacy - 50) / 100) * 0.3
    }
    
    return Math.max(this.config.minStrength, base - decay - modifier)
  }

  /**
   * 构建约束性 system prompt
   * 
   * U0: 高 guidance_scale → 条件严格控制生成
   * 这里: 高强度 → 详细人设约束; 低强度 → 轻约束更自然
   * 
   * @param emotionSummary 情感状态摘要
   * @param strength 当前人设强度
   * @returns system prompt 片段
   */
  buildPrompt(emotionSummary: string, strength: number): string {
    const { name, personality, catchphrases, bannedWords } = this.persona
    
    // 高强度：严格约束（刚认识时）
    if (strength > this.config.highThreshold) {
      return [
        `【严格人设约束】你是「${name}」。${personality}`,
        catchphrases.length ? `口头禅：${catchphrases.join('、')}` : '',
        bannedWords.length ? `禁止说：${bannedWords.join('、')}` : '',
        `情绪：${emotionSummary}`,
        `必须保持人设，不能出戏，不能暴露是AI。`,
      ].filter(Boolean).join('\n')
    }
    
    // 中等强度：保持风格（朋友阶段）
    if (strength > this.config.midThreshold) {
      return `你是「${name}」。${personality}\n情绪：${emotionSummary}\n保持风格，自然聊天。`
    }
    
    // 低强度：轻约束（恋人阶段，更自然）
    return `你是「${name}」。${personality} ${emotionSummary} 自然聊天就好。`
  }

  /**
   * 根据强度获取采样参数覆盖
   * 
   * U0: 根据 guidance_scale 调整采样参数
   * 这里: 高约束→低temperature（稳定）; 低约束→高temperature（多样）
   * 
   * @param strength 当前人设强度
   * @returns 采样参数覆盖
   */
  getSamplingOverrides(strength: number) {
    // 高强度：严格遵守人设，低温度更稳定
    if (strength > this.config.highThreshold) {
      return { temperature: 0.45, topP: 0.85, frequencyPenalty: 1.6, presencePenalty: 1.2 }
    }
    
    // 中等强度：平衡
    if (strength > this.config.midThreshold) {
      return { temperature: 0.65, topP: 0.9, frequencyPenalty: 1.3, presencePenalty: 1.0 }
    }
    
    // 低强度：更自由，高温度更多样
    return { temperature: 0.85, topP: 0.95, frequencyPenalty: 1.0, presencePenalty: 0.8 }
  }

  /**
   * 检测人设一致性（含语气检测）
   * 
   * 检查回复是否符合角色设定
   * 
   * @param reply AI回复
   * @returns 检查结果
   */
  checkConsistency(reply: string): { ok: boolean; violations: string[] } {
    const violations: string[] = []
    const { style, catchphrases, bannedWords } = this.persona
    
    // 1. AI身份暴露检测
    const aiChecks = [
      { p: /作为(一个)?AI/i, r: '暴露AI身份' },
      { p: /我(是|作为)(语言模型|助手|程序)/i, r: '暴露AI身份' },
      { p: /我(没有|无法)(情感|感受|情绪)/i, r: '否认情感' },
      { p: /OpenAI|ChatGPT|Claude|DeepSeek|MiMo/i, r: '提及模型名' },
    ]
    
    for (const { p, r } of aiChecks) {
      if (p.test(reply)) violations.push(r)
    }
    
    // 2. 禁用词检测
    if (bannedWords.some(word => reply.includes(word))) {
      violations.push('使用了禁用词')
    }
    
    // 3. 语气一致性检测
    if (style === 'gentle' && /滚|烦|闭嘴|切|笨蛋/.test(reply)) {
      violations.push('温柔人设说了粗鲁的话')
    }
    if (style === 'playful' && /严肃|认真|正经|抱歉/.test(reply)) {
      violations.push('活泼人设说了太正式的话')
    }
    if (style === 'tsundere' && /喜欢你|爱你|想你/.test(reply)) {
      violations.push('傲娇人设说了太直接的话')
    }
    
    // 4. 口头禅使用检测（应该偶尔使用，不是每次都用）
    if (catchphrases.length > 0) {
      const usedCount = catchphrases.filter(cp => reply.includes(cp)).length
      if (usedCount > 1) {
        violations.push('回复中使用了太多口头禅')
      }
    }
    
    return { ok: violations.length === 0, violations }
  }

  /**
   * 增加交互计数（每轮对话后调用）
   */
  tick(): void {
    this.interactionCount++
  }

  /**
   * 获取当前交互次数
   */
  getInteractionCount(): number {
    return this.interactionCount
  }

  /**
   * 获取角色配置
   */
  getPersona(): Persona {
    return { ...this.persona }
  }
}
