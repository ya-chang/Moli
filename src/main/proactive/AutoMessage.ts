// src/main/proactive/AutoMessage.ts
// 自动消息生成器 — 根据人设自动生成消息并发送

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

interface CharacterConfig {
  id: string
  name: string
  persona: string
  style: string
}

interface AutoMessageConfig {
  enabled: boolean
  morningHour: number
  morningMinute: number
  nightHour: number
  nightMinute: number
  missYouDelay: number  // 离开多久后发送（分钟）
}

export class AutoMessage {
  private checkInterval: NodeJS.Timeout | null = null
  private characterId: string
  private lastMessageTime: number = 0
  private lastTriggered: Map<string, number> = new Map()
  private config: AutoMessageConfig = {
    enabled: true,
    morningHour: 8,
    morningMinute: 0,
    nightHour: 23,
    nightMinute: 0,
    missYouDelay: 60
  }

  constructor(characterId: string) {
    this.characterId = characterId
    this.loadConfig()
  }

  /**
   * 加载配置
   */
  private loadConfig(): void {
    try {
      const configPath = join(PATHS.base, 'notification-settings.json')
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        this.config = {
          enabled: true,
          morningHour: config.morningHour || 8,
          morningMinute: config.morningMinute || 0,
          nightHour: config.nightHour || 23,
          nightMinute: config.nightMinute || 0,
          missYouDelay: config.missYouDelay || 60
        }
        logger.info(`[AutoMessage] 加载配置: 早安=${this.config.morningHour}:${this.config.morningMinute}, 晚安=${this.config.nightHour}:${this.config.nightMinute}, 离开=${this.config.missYouDelay}分钟`)
      }
    } catch (err) {
      logger.error('加载自动消息配置失败', err)
    }
  }

  /**
   * 启动自动消息检查
   */
  start(onMessage: (message: string) => void): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    // 每30秒检查一次
    this.checkInterval = setInterval(() => {
      this.check(onMessage)
    }, 30000)

    logger.info(`[AutoMessage] 已启动: characterId=${this.characterId}`)
  }

  /**
   * 停止自动消息检查
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  /**
   * 检查是否应该发送消息
   */
  private check(onMessage: (message: string) => void): void {
    this.loadConfig() // 每次检查时重新加载配置

    if (!this.config.enabled) return

    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const currentTime = currentHour * 60 + currentMinute

    // 检查早安消息
    const morningTime = this.config.morningHour * 60 + this.config.morningMinute
    if (currentTime === morningTime && !this.hasTriggeredToday('morning')) {
      const message = this.generateMessage('morning')
      this.triggerMessage(message, onMessage)
      this.markTriggered('morning')
      return
    }

    // 检查晚安消息
    const nightTime = this.config.nightHour * 60 + this.config.nightMinute
    if (currentTime === nightTime && !this.hasTriggeredToday('night')) {
      const message = this.generateMessage('night')
      this.triggerMessage(message, onMessage)
      this.markTriggered('night')
      return
    }

    // 检查"想你了"消息
    if (this.lastMessageTime > 0) {
      const minutesSinceLastMessage = (Date.now() - this.lastMessageTime) / 1000 / 60
      if (minutesSinceLastMessage >= this.config.missYouDelay && !this.hasTriggeredToday('miss_you')) {
        const message = this.generateMessage('miss_you')
        this.triggerMessage(message, onMessage)
        this.markTriggered('miss_you')
        this.lastMessageTime = 0 // 重置
      }
    }
  }

  /**
   * 根据人设生成消息
   */
  private generateMessage(type: string): string {
    const messages: Record<string, string[]> = {
      morning: [
        '早安呀~',
        '起来了没？',
        '早！新的一天开始了',
        '昨晚睡得好吗？'
      ],
      night: [
        '晚安啦~',
        '该睡觉了哦',
        '晚安，做个好梦',
        '早点休息吧'
      ],
      miss_you: [
        '想你了...',
        '你在干嘛呀？',
        '好久没聊天了...',
        '今天怎么这么安静呀',
        '我好想你啊'
      ]
    }

    const options = messages[type] || ['你好呀~']
    return options[Math.floor(Math.random() * options.length)]
  }

  /**
   * 记录最后消息时间
   */
  setLastMessageTime(time: number): void {
    this.lastMessageTime = time
  }

  /**
   * 触发消息
   */
  private triggerMessage(message: string, onMessage: (message: string) => void): void {
    logger.info(`[AutoMessage] 触发消息: ${message}`)
    onMessage(message)
  }

  /**
   * 检查今天是否已触发
   */
  private hasTriggeredToday(type: string): boolean {
    const lastTime = this.lastTriggered.get(type) || 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return lastTime > today.getTime()
  }

  /**
   * 标记今天已触发
   */
  private markTriggered(type: string): void {
    this.lastTriggered.set(type, Date.now())
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoMessageConfig>): void {
    this.config = { ...this.config, ...config }
    logger.info(`[AutoMessage] 配置已更新`)
  }

  /**
   * 获取当前配置
   */
  getConfig(): AutoMessageConfig {
    return { ...this.config }
  }
}
