// src/main/engine/SamplingStrategy.ts
// 差异化采样策略 — 灵感来源: Xiaomi-Robotics-U0 的 DifferentialTopK
// U0源码: xr_u0_ar/logits_processor.py
// 核心思想: 不同类型的消息使用不同的采样参数

/**
 * 消息类型
 * U0对应: logits_processor 中判断 token 类型 (文本 vs 视觉)
 * U0方式: token_id < BOV → 文本, >= BOV → 视觉
 * 迁移方式: 关键词 + 情感状态 → 消息类型
 */
export type MessageType = 'emotional' | 'factual' | 'flirty' | 'comfort' | 'angry' | 'playful' | 'casual'

/**
 * 采样参数
 */
export interface SamplingParams {
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
}

/**
 * 不同消息类型的采样策略
 * U0对应: image_top_k=5120, image_temperature=1.0 (高多样性)
 *         text_top_k=1024, text_temperature=0.7 (高准确性)
 */
const STRATEGIES: Record<MessageType, SamplingParams> = {
  // 情感类消息: 高温度，更多样化
  emotional: { temperature: 1.0, topP: 0.95, frequencyPenalty: 1.3, presencePenalty: 1.2 },
  // 事实类消息: 低温度，更准确
  factual:   { temperature: 0.3, topP: 0.8,  frequencyPenalty: 1.0, presencePenalty: 0.8 },
  // 撩人类消息: 高温度，创意优先
  flirty:    { temperature: 1.2, topP: 0.98, frequencyPenalty: 1.5, presencePenalty: 1.3 },
  // 安慰类消息: 中等温度，温暖稳定
  comfort:   { temperature: 0.8, topP: 0.9,  frequencyPenalty: 1.2, presencePenalty: 1.0 },
  // 生气类消息: 低温度，克制保守
  angry:     { temperature: 0.5, topP: 0.85, frequencyPenalty: 1.0, presencePenalty: 0.9 },
  // 俏皮类消息: 高温度，活泼有趣
  playful:   { temperature: 1.1, topP: 0.95, frequencyPenalty: 1.4, presencePenalty: 1.2 },
  // 日常类消息: 中等温度，平衡
  casual:    { temperature: 0.7, topP: 0.9,  frequencyPenalty: 1.2, presencePenalty: 1.0 },
}

export class SamplingStrategy {
  /**
   * 消息分类
   * 根据用户消息内容和情感状态判断消息类型
   */
  classify(userMessage: string, emotion?: {
    sadness?: number
    anger?: number
    happiness?: number
  }): MessageType {
    // 1. 情感状态优先判断
    if (emotion?.sadness !== undefined && emotion.sadness > 60) return 'comfort'
    if (emotion?.anger !== undefined && emotion.anger > 50) return 'angry'
    
    // 2. 关键词匹配
    if (/亲|抱|宝贝|亲爱的|么么|mua|想你|喜欢你|爱你/.test(userMessage)) return 'flirty'
    if (/开心|难过|伤心|感动|哭|幸福|委屈|紧张|兴奋/.test(userMessage)) return 'emotional'
    if (/几点|什么|哪里|怎么|为什么|多少|叫什么/.test(userMessage)) return 'factual'
    if (/哈哈|嘿嘿|嘻嘻|你猜|才不是|哼|切/.test(userMessage)) return 'playful'
    
    // 3. 默认日常
    return 'casual'
  }

  /**
   * 获取指定消息类型的采样参数
   */
  getParams(type: MessageType): SamplingParams {
    return { ...STRATEGIES[type] }
  }

  /**
   * 获取消息类型的中文描述（用于日志）
   */
  getTypeName(type: MessageType): string {
    const names: Record<MessageType, string> = {
      emotional: '情感类',
      factual: '事实类',
      flirty: '撩人类',
      comfort: '安慰类',
      angry: '生气类',
      playful: '俏皮类',
      casual: '日常类',
    }
    return names[type]
  }

  /**
   * 融合 CFG 覆盖和差异化采样
   * 使用加权融合，根据消息类型决定权重
   * 
   * 策略:
   * - 撩人/情感/俏皮类消息: 采样参数更重要（多样性优先），权重0.7
   * - 其他类型消息: CFG约束更重要（准确性优先），权重0.4
   */
  merge(
    strategyParams: SamplingParams,
    cfgOverrides: Partial<SamplingParams>,
    messageType: MessageType
  ): SamplingParams {
    // 根据消息类型决定融合权重
    const strategyWeight = ['flirty', 'emotional', 'playful'].includes(messageType) ? 0.7 : 0.4
    const cfgWeight = 1 - strategyWeight
    
    return {
      temperature: (strategyParams.temperature * strategyWeight) + 
                   ((cfgOverrides.temperature ?? strategyParams.temperature) * cfgWeight),
      topP: (strategyParams.topP * strategyWeight) + 
            ((cfgOverrides.topP ?? strategyParams.topP) * cfgWeight),
      frequencyPenalty: Math.max(strategyParams.frequencyPenalty, cfgOverrides.frequencyPenalty ?? 0),
      presencePenalty: Math.max(strategyParams.presencePenalty, cfgOverrides.presencePenalty ?? 0),
    }
  }
}
