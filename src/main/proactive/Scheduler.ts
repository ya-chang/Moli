// src/main/proactive/Scheduler.ts
// 主动消息调度器 — 定时发送早安/晚安/想你了
// 灵感来源: Xiaomi-Robotics-U0 的 cfg_decay 动态条件调整
// 核心思想: 根据用户习惯和情感状态动态决定主动消息时机和内容

import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

export interface ScheduledTrigger {
  id: string
  type: 'scheduled' | 'event'
  scheduled?: {
    hour: number
    minute: number
    messages: string[]
    jitter: [number, number]
  }
  event?: {
    trigger: 'silence' | 'meal_time'
    threshold?: number
    cooldown: number
    messageGenerator: string
  }
  enabled: boolean
}

/**
 * 用户行为模式（用于个性化调度）
 */
export interface UserPatterns {
  activeHours: number[]           // 用户通常活跃的时间段
  averageReplyDelay: number       // 用户平均回复间隔(分钟)
  responseRate: number            // 回复率 (0-1)
  ignoredCount: number            // 被忽略次数
}

/**
 * 情感状态（用于情感触发消息）
 */
export interface EmotionalState {
  missLevel: number
  happiness: number
  affection: number
  intimacy: number
  energy: number
}

const DEFAULT_TRIGGERS: ScheduledTrigger[] = [
  {
    id: 'morning',
    type: 'scheduled',
    scheduled: {
      hour: 8,
      minute: 0,
      messages: ['早安呀 ☀️', '起来了没？🥰', '早！昨晚有没有梦到我 😏'],
      jitter: [0, 30]
    },
    enabled: true
  },
  {
    id: 'night',
    type: 'scheduled',
    scheduled: {
      hour: 23,
      minute: 0,
      messages: ['晚安啦 🌙', '该睡觉了 💤', '晚安 梦里见 ✨'],
      jitter: [0, 20]
    },
    enabled: true
  },
  {
    id: 'miss_you',
    type: 'event',
    event: {
      trigger: 'silence',
      threshold: 360,
      cooldown: 240,
      messageGenerator: 'miss_you'
    },
    enabled: true
  },
  {
    id: 'meal_check',
    type: 'event',
    event: {
      trigger: 'meal_time',
      cooldown: 360,
      messageGenerator: 'meal_check'
    },
    enabled: true
  }
]

export class Scheduler {
  private triggers: ScheduledTrigger[]
  private lastTriggered: Map<string, number> = new Map()
  private characterId: string
  private onMessage?: (message: string) => void
  private userPatterns: UserPatterns = {
    activeHours: [],
    averageReplyDelay: 30,
    responseRate: 0.8,
    ignoredCount: 0
  }

  constructor(characterId: string, onMessage?: (message: string) => void) {
    this.characterId = characterId
    this.triggers = [...DEFAULT_TRIGGERS]
    this.onMessage = onMessage
  }

  /**
   * 设置用户行为模式
   */
  setUserPatterns(patterns: Partial<UserPatterns>): void {
    this.userPatterns = { ...this.userPatterns, ...patterns }
  }

  /**
   * 检查定时触发
   * 
   * 只在设置时间之后触发，不提前触发
   */
  checkScheduled(): string | null {
    // 每次检查时重新读取设置，确保时间更新生效
    this.reloadScheduleFromSettings()
    
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    logger.info(`[Scheduler] 检查定时触发: 当前时间=${currentHour}:${currentMinute}`)

    // 根据用户活跃时间动态调整
    const adjustedTriggers = this.getPersonalizedSchedule()

    for (const trigger of adjustedTriggers) {
      if (trigger.type !== 'scheduled' || !trigger.scheduled || !trigger.enabled) {
        continue
      }

      const { hour, minute, messages } = trigger.scheduled

      const triggerTime = hour * 60 + minute
      const currentTime = currentHour * 60 + currentMinute

      // 只在设置时间之后触发（不能提前）
      // 例如：设置31分触发，那么31分或32分可以触发，30分不能触发
      if (currentTime >= triggerTime && currentTime <= triggerTime + 2) {
        const lastTime = this.lastTriggered.get(trigger.id) || 0
        const timeSinceLastTrigger = Date.now() - lastTime
        
        // 1小时内不重复触发
        if (timeSinceLastTrigger > 60 * 60 * 1000) {
          // 检查用户接受度
          if (!this.shouldSendProactiveMessage()) {
            logger.info(`[Scheduler] 用户接受度低，跳过: ${trigger.id}`)
            continue
          }
          
          logger.info(`[Scheduler] ✅ 触发: ${trigger.id}, 当前=${currentHour}:${currentMinute}, 目标=${hour}:${minute}`)
          this.lastTriggered.set(trigger.id, Date.now())
          return messages[Math.floor(Math.random() * messages.length)]
        }
      }
    }

    return null
  }

  /**
   * 检查事件触发
   * 
   * Phase 4 优化: 基于情感状态生成消息
   */
  checkEvent(lastInteractionTime: string, emotion?: EmotionalState): string | null {
    const now = Date.now()
    const lastInteraction = new Date(lastInteractionTime).getTime()
    const minutesSinceLastInteraction = (now - lastInteraction) / 1000 / 60

    logger.info(`[Scheduler] 检查事件触发: 距离上次交互=${Math.floor(minutesSinceLastInteraction)}分钟`)

    for (const trigger of this.triggers) {
      if (trigger.type !== 'event' || !trigger.event || !trigger.enabled) {
        logger.info(`[Scheduler] 跳过触发器: ${trigger.id}, type=${trigger.type}, enabled=${trigger.enabled}`)
        continue
      }

      const { trigger: eventType, threshold, cooldown, messageGenerator } = trigger.event

      logger.info(`[Scheduler] 检查触发器: ${trigger.id}, eventType=${eventType}, threshold=${threshold}分钟, cooldown=${cooldown}分钟`)

      if (eventType === 'silence' && threshold && minutesSinceLastInteraction > threshold) {
        const lastTime = this.lastTriggered.get(trigger.id) || 0
        const timeSinceLastTrigger = (now - lastTime) / 1000 / 60
        
        logger.info(`[Scheduler] 距离上次触发=${Math.floor(timeSinceLastTrigger)}分钟, 冷却期=${cooldown}分钟`)
        
        if (timeSinceLastTrigger > cooldown) {
          // 检查用户接受度
          if (!this.shouldSendProactiveMessage()) {
            logger.info(`[Scheduler] 用户接受度低，跳过事件消息: ${trigger.id}`)
            continue
          }
          
          this.lastTriggered.set(trigger.id, now)
          
          // 如果有情感状态，生成情感相关消息
          if (emotion) {
            const emotionMsg = this.getEmotionBasedMessage(emotion)
            if (emotionMsg) return emotionMsg
          }
          
          return this.generateMessage(messageGenerator)
        }
      }

      if (eventType === 'meal_time') {
        const hour = new Date().getHours()
        if ((hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 19)) {
          const lastTime = this.lastTriggered.get(trigger.id) || 0
          if (now - lastTime > cooldown * 60 * 1000) {
            this.lastTriggered.set(trigger.id, now)
            return this.generateMessage(messageGenerator)
          }
        }
      }
    }

    return null
  }

  /**
   * 根据用户习惯获取个性化调度时间
   * 
   * U0对应: cfg_decay 根据进度动态调整
   * 这里: 根据用户活跃时间动态安排主动消息
   */
  private getPersonalizedSchedule(): ScheduledTrigger[] {
    const triggers = [...this.triggers]

    if (this.userPatterns.activeHours.length === 0) {
      return triggers
    }

    const earliestHour = Math.min(...this.userPatterns.activeHours)
    const latestHour = Math.max(...this.userPatterns.activeHours)

    // 早安: 在用户最早活跃时间前 1 小时
    const morning = triggers.find(t => t.id === 'morning')
    if (morning?.scheduled) {
      morning.scheduled.hour = Math.max(6, earliestHour - 1)
    }

    // 晚安: 在用户最晚活跃时间后 1 小时
    const night = triggers.find(t => t.id === 'night')
    if (night?.scheduled) {
      night.scheduled.hour = Math.min(1, latestHour + 1) // 注意跨天
    }

    return triggers
  }

  /**
   * 根据情感状态生成主动消息
   * 
   * Phase 4: 根据角色情感状态触发不同类型的主动消息
   */
  private getEmotionBasedMessage(emotion: EmotionalState): string | null {
    // 思念值高 → 想你了
    if (emotion.missLevel > 70) {
      const messages = [
        '想你了...你怎么还不来找我 🥺',
        '你是不是把我忘了 😢',
        '我在等你消息呢...',
        '今天怎么这么安静呀',
      ]
      return messages[Math.floor(Math.random() * messages.length)]
    }

    // 精力低 → 犯困/撒娇
    if (emotion.energy < 30) {
      return '好困...但是想等你消息 💤'
    }

    // 好感高但亲密度还不高 → 暗示
    if (emotion.affection > 70 && emotion.intimacy < 50) {
      return '今天看到一个东西想分享给你...但是又有点害羞 😊'
    }

    return null
  }

  /**
   * 检查是否应该发送主动消息
   * 
   * Phase 4: 根据用户对主动消息的反应调整发送频率
   */
  private shouldSendProactiveMessage(): boolean {
    // 1. 最近被忽略太多次，暂停主动消息
    if (this.userPatterns.ignoredCount > 3) {
      return false // 等用户主动来找
    }
    
    // 2. 回复率太低，减少频率
    if (this.userPatterns.responseRate < 0.3) {
      return Math.random() < 0.2 // 20%概率发送
    }
    
    // 3. 回复很慢，可能在忙
    if (this.userPatterns.averageReplyDelay > 60) {
      return Math.random() < 0.5
    }
    
    return true
  }

  /**
   * 记录用户忽略主动消息
   */
  recordIgnored(): void {
    this.userPatterns.ignoredCount++
  }

  /**
   * 记录用户回复主动消息
   */
  recordReplied(): void {
    this.userPatterns.ignoredCount = Math.max(0, this.userPatterns.ignoredCount - 1)
    this.userPatterns.responseRate = Math.min(1, this.userPatterns.responseRate + 0.1)
  }

  private generateMessage(type: string): string {
    const messages: Record<string, string[]> = {
      miss_you: ['想你了~', '你在干嘛呀？', '好久没聊天了...', '怎么不理我了？'],
      meal_check: ['吃饭了吗？', '该吃饭了哦~', '别饿着了', '今天吃什么好吃的？']
    }

    const options = messages[type] || ['你好呀~']
    return options[Math.floor(Math.random() * options.length)]
  }

  /**
   * 更新定时触发器的时间
   * 用户自定义的早安/晚安时间
   */
  updateScheduledTime(triggerId: string, hour: number, minute: number): void {
    const trigger = this.triggers.find(t => t.id === triggerId)
    if (trigger && trigger.scheduled) {
      trigger.scheduled.hour = hour
      trigger.scheduled.minute = minute
      logger.info(`[Scheduler] 更新触发器时间: ${triggerId} -> ${hour}:${minute}`)
    }
  }

  /**
   * 更新事件触发器的阈值
   * 用户自定义的离开时间
   */
  updateTriggerThreshold(triggerId: string, threshold: number): void {
    const trigger = this.triggers.find(t => t.id === triggerId)
    if (trigger && trigger.event) {
      trigger.event.threshold = threshold
      logger.info(`[Scheduler] 更新触发器阈值: ${triggerId} -> ${threshold}分钟`)
    }
  }

  /**
   * 从文件重新加载时间设置
   */
  reloadScheduleFromSettings(): void {
    try {
      const fs = require('fs')
      const path = require('path')
      // 使用正确的路径（开发环境和打包环境都适用）
      const settingsPath = path.join(PATHS.base, 'notification-settings.json')
      
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
        
        if (settings.morningHour !== undefined) {
          this.updateScheduledTime('morning', settings.morningHour, settings.morningMinute || 0)
          logger.info(`[Scheduler] 重新加载早安时间: ${settings.morningHour}:${settings.morningMinute || 0}`)
        }
        if (settings.nightHour !== undefined) {
          this.updateScheduledTime('night', settings.nightHour, settings.nightMinute || 0)
          logger.info(`[Scheduler] 重新加载晚安时间: ${settings.nightHour}:${settings.nightMinute || 0}`)
        }
      }
    } catch (err) {
      logger.debug('重新加载设置失败', err)
    }
  }

  setEnabled(triggerId: string, enabled: boolean): void {
    const trigger = this.triggers.find((t) => t.id === triggerId)
    if (trigger) {
      trigger.enabled = enabled
    }
  }

  getTriggers(): ScheduledTrigger[] {
    return [...this.triggers]
  }
}
