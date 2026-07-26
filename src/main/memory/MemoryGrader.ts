// src/main/memory/MemoryGrader.ts
// 记忆分级器 — 判断消息重要性
// 灵感来源: Xiaomi-Robotics-U0 的 token 类型差异化权重处理
// 核心思想: 不同类型的记忆有不同的保留权重

export type MemoryGrade = 'critical' | 'important' | 'normal'

export interface GradedMemory {
  id: string
  content: string
  grade: MemoryGrade
  importance: number
  timestamp: string
}

/**
 * 评分上下文
 */
export interface GradeContext {
  userEmotion?: string        // 用户情感状态
  isRecurring?: boolean       // 是否反复提到
  timeSinceLastMention?: number // 距离上次提到的小时数
}

/**
 * 情感关键词权重
 */
const EMOTIONAL_KEYWORDS = {
  high: ['爱', '喜欢', '讨厌', '恨', '害怕', '崩溃', '哭', '笑死', '感动', '幸福', '委屈'],
  mid: ['开心', '难过', '生气', '紧张', '期待', '失望', '委屈', '兴奋', '焦虑'],
  low: ['还行', '一般', '无所谓', '还好', '正常']
}

/**
 * 个人信息关键词
 */
const PERSONAL_KEYWORDS = ['生日', '名字', '家人', '工作', '学校', '喜欢', '讨厌', '习惯', '爱好', '梦想']

/**
 * 承诺/约定关键词
 */
const COMMITMENT_KEYWORDS = ['承诺', '答应', '保证', '一定', '约好', '说好了']

export class MemoryGrader {
  /**
   * 评估消息重要性
   * 
   * U0对应: logits_processor 中对视觉/文本 token 的差异化处理
   * 迁移: 对不同类型记忆用不同权重评分
   * 
   * 评分维度:
   * 1. 基础分: 0.5
   * 2. 情感强度加权: +0.3 (high), +0.15 (mid), -0.1 (low)
   * 3. 用户情感状态加权: +0.2 (crying/angry), +0.1 (excited)
   * 4. 重复强化: +0.15
   * 5. 个人信息关键词: +0.2
   * 6. 时间衰减: 基于距离上次提到的时间
   * 
   * @param content 消息内容
   * @param context 评分上下文
   * @returns 评分结果
   */
  grade(content: string, context?: GradeContext): { grade: MemoryGrade; importance: number } {
    let importance = 0.5 // 基础分

    // 1. 情感强度加权 (U0: visual token 获得更高 CFG 权重)
    if (EMOTIONAL_KEYWORDS.high.some(k => content.includes(k))) {
      importance += 0.3
    } else if (EMOTIONAL_KEYWORDS.mid.some(k => content.includes(k))) {
      importance += 0.15
    } else if (EMOTIONAL_KEYWORDS.low.some(k => content.includes(k))) {
      importance -= 0.1
    }

    // 2. 用户情感状态加权
    if (context?.userEmotion === 'crying' || context?.userEmotion === 'angry') {
      importance += 0.2
    }
    if (context?.userEmotion === 'excited') {
      importance += 0.1
    }

    // 3. 重复强化 (反复提到的事更重要)
    if (context?.isRecurring) {
      importance += 0.15
    }

    // 4. 个人信息关键词
    if (PERSONAL_KEYWORDS.some(k => content.includes(k))) {
      importance += 0.2
    }

    // 5. 承诺/约定关键词（非常重要）
    if (COMMITMENT_KEYWORDS.some(k => content.includes(k))) {
      importance += 0.25
    }

    // 6. 时间衰减（最近的记忆更重要）
    if (context?.timeSinceLastMention !== undefined) {
      // 一周(168小时)后权重降到一半
      const timeFactor = Math.exp(-context.timeSinceLastMention / 168)
      importance *= (0.5 + 0.5 * timeFactor)
    }

    // 限制在 0-1 范围
    importance = Math.max(0, Math.min(1, importance))

    // 分级
    const grade: MemoryGrade = importance > 0.7 ? 'critical' : importance > 0.4 ? 'important' : 'normal'
    
    return { grade, importance }
  }

  /**
   * 判断是否应该遗忘
   * 只对 normal 级别记忆进行遗忘
   */
  shouldForget(grade: MemoryGrade): boolean {
    if (grade === 'critical') return false
    if (grade === 'important') return false
    
    // normal 级别: 5% 概率遗忘
    return Math.random() < 0.05
  }

  /**
   * 获取重要性等级的中文描述
   */
  getGradeName(grade: MemoryGrade): string {
    const names: Record<MemoryGrade, string> = {
      critical: '关键记忆',
      important: '重要记忆',
      normal: '普通记忆'
    }
    return names[grade]
  }

  /**
   * 兼容旧接口
   * @deprecated 使用 grade(content, context) 代替
   */
  gradeLegacy(content: string): { grade: 'high' | 'medium' | 'low'; importance: number } {
    const result = this.grade(content)
    
    // 转换为旧格式
    const legacyGrade = result.importance > 0.7 ? 'high' : result.importance > 0.4 ? 'medium' : 'low'
    
    return {
      grade: legacyGrade,
      importance: result.importance
    }
  }
}
