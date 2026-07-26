// src/main/proactive/SimpleAutoMessage.ts
// 简单自动消息 — 从角色 config.yaml 读取配置，定时检查触发

import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'
import type { TriggerType } from '../auto-message-handler'

interface ProactiveSettings {
  enabled?: boolean
  morningHour?: number
  morningMinute?: number
  nightHour?: number
  nightMinute?: number
  missYouDelay?: number
  maxMissYouPerDay?: number
}

interface PersistedState {
  lastMessageTime: number
  triggeredDates: Record<string, string[]> // { "2026-07-24": ["morning", "night"] }
  missYouCountDate: string
  missYouCountToday: number
}

export class SimpleAutoMessage {
  private checkInterval: NodeJS.Timeout | null = null
  private characterId: string
  private lastMessageTime: number = 0
  private triggeredDates: Record<string, string[]> = {}
  private missYouCountToday: number = 0
  private missYouCountDate: string = ''
  private lastMissYouTime: number = 0 // 上次"想你了"时间，用于冷却

  // 从角色 config.yaml 读取的配置
  private morningHour = -1
  private morningMinute = 0
  private nightHour = -1
  private nightMinute = 0
  private missYouDelay = 60
  private maxMissYouPerDay = 3

  private getStatePath(): string {
    return join(PATHS.base, 'global', `auto-state-${this.characterId}.json`)
  }

  constructor(characterId: string) {
    this.characterId = characterId
    this.loadConfig()
    this.loadState()
  }

  private loadConfig(): void {
    try {
      const configPath = join(PATHS.characters, this.characterId, 'config.yaml')
      if (existsSync(configPath)) {
        const yaml = require('yaml')
        const config = yaml.parse(readFileSync(configPath, 'utf-8'))
        const ps: ProactiveSettings = config?.proactiveSettings
        if (ps?.enabled) {
          this.morningHour = ps.morningHour ?? -1
          this.morningMinute = ps.morningMinute ?? 0
          this.nightHour = ps.nightHour ?? -1
          this.nightMinute = ps.nightMinute ?? 0
          this.missYouDelay = ps.missYouDelay ?? 60
          this.maxMissYouPerDay = ps.maxMissYouPerDay ?? 3
        }
      }
    } catch (err) {
      logger.error(`[Auto] ${this.characterId} 读取配置失败`, err)
    }
  }

  private loadState(): void {
    try {
      const statePath = this.getStatePath()
      if (existsSync(statePath)) {
        const data: PersistedState = JSON.parse(readFileSync(statePath, 'utf-8'))
        this.lastMessageTime = data.lastMessageTime || 0
        this.triggeredDates = data.triggeredDates || {}
        this.missYouCountDate = data.missYouCountDate || ''
        this.missYouCountToday = data.missYouCountToday || 0
      }
    } catch { /* ignore */ }
  }

  private saveState(): void {
    try {
      const statePath = this.getStatePath()
      const dir = join(PATHS.base, 'global')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const state: PersistedState = {
        lastMessageTime: this.lastMessageTime,
        triggeredDates: this.triggeredDates,
        missYouCountDate: this.missYouCountDate,
        missYouCountToday: this.missYouCountToday
      }
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  /** 是否有可用的触发器 */
  hasActiveTrigger(): boolean {
    return this.morningHour >= 0 || this.nightHour >= 0
  }

  start(onTrigger: (triggerType: TriggerType) => void): void {
    if (!this.hasActiveTrigger()) {
      logger.info(`[Auto] ${this.characterId} 无启用的触发器，跳过`)
      return
    }

    this.check(onTrigger)

    this.checkInterval = setInterval(() => {
      this.check(onTrigger)
    }, 10_000)

    logger.info(`[Auto] 已启动: ${this.characterId}`)
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  setLastMessageTime(time: number): void {
    this.lastMessageTime = time
    this.saveState()
  }

  private hasTriggeredToday(type: string): boolean {
    const today = new Date().toISOString().split('T')[0]
    return this.triggeredDates[today]?.includes(type) ?? false
  }

  private markTriggered(type: string): void {
    const today = new Date().toISOString().split('T')[0]
    if (!this.triggeredDates[today]) this.triggeredDates[today] = []
    if (!this.triggeredDates[today].includes(type)) {
      this.triggeredDates[today].push(type)
    }
    // 清理超过7天的记录
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    for (const date of Object.keys(this.triggeredDates)) {
      if (date < cutoff) delete this.triggeredDates[date]
    }
    this.saveState()
  }

  private check(onTrigger: (triggerType: TriggerType) => void): void {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()

    // 早安 — 精确匹配时:分，每天一次
    if (this.morningHour >= 0 && hour === this.morningHour && minute === this.morningMinute) {
      if (!this.hasTriggeredToday('morning')) {
        this.markTriggered('morning')
        logger.info(`[Auto] 触发早安: ${this.characterId}`)
        onTrigger('morning')
        return
      }
    }

    // 晚安 — 精确匹配时:分，每天一次
    if (this.nightHour >= 0 && hour === this.nightHour && minute === this.nightMinute) {
      if (!this.hasTriggeredToday('night')) {
        this.markTriggered('night')
        logger.info(`[Auto] 触发晚安: ${this.characterId}`)
        onTrigger('night')
        return
      }
    }

    // 想你了 — 每天最多 maxMissYouPerDay 次，且有冷却间隔
    if (this.lastMessageTime > 0) {
      const today = now.toISOString().split('T')[0]
      if (this.missYouCountDate !== today) {
        this.missYouCountDate = today
        this.missYouCountToday = 0
      }
      if (this.missYouCountToday < this.maxMissYouPerDay) {
        const minutesSinceLastMessage = (Date.now() - this.lastMessageTime) / 1000 / 60
        const minutesSinceLastMissYou = this.lastMissYouTime > 0 ? (Date.now() - this.lastMissYouTime) / 1000 / 60 : Infinity
        // 需要超过离开时间阈值，且距上次"想你了"至少冷却5分钟
        if (minutesSinceLastMessage >= this.missYouDelay && minutesSinceLastMissYou >= 5) {
          this.lastMissYouTime = Date.now()
          this.missYouCountToday++
          this.saveState()
          logger.info(`[Auto] 触发想你了: ${this.characterId} (${this.missYouCountToday}/${this.maxMissYouPerDay})`)
          onTrigger('missYou')
        }
      }
    }
  }
}
