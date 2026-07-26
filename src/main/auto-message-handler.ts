// src/main/auto-message-handler.ts
// 自动消息处理器 — 管理所有角色的自动消息，触发时调用模型生成

import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { SimpleAutoMessage } from './proactive/SimpleAutoMessage'
import { getNotificationWindow } from './notification/NotificationWindow'
import { ModelRouter } from './engine/ModelRouter'
import { PATHS } from './utils/dataPath'
import { logger } from './utils/logger'

const modelRouter = new ModelRouter()

export type TriggerType = 'morning' | 'night' | 'missYou'

export class AutoMessageHandler {
  private handlers: Map<string, SimpleAutoMessage> = new Map()
  private mainWindow: any

  constructor(mainWindow: any) {
    this.mainWindow = mainWindow
  }

  start(characterId: string): void {
    if (this.handlers.has(characterId)) {
      this.handlers.get(characterId)!.stop()
    }

    const handler = new SimpleAutoMessage(characterId)
    handler.start((triggerType: TriggerType) => {
      this.onTrigger(characterId, triggerType)
    })
    this.handlers.set(characterId, handler)
    logger.info(`[AutoMessageHandler] 启动: ${characterId}`)
  }

  stop(characterId: string): void {
    const handler = this.handlers.get(characterId)
    if (handler) {
      handler.stop()
      this.handlers.delete(characterId)
    }
  }

  stopAll(): void {
    this.handlers.forEach(h => h.stop())
    this.handlers.clear()
  }

  setLastMessageTime(characterId: string, time: number): void {
    const handler = this.handlers.get(characterId)
    if (handler) {
      handler.setLastMessageTime(time)
    }
  }

  /**
   * 触发回调 — 调用模型生成消息
   */
  private async onTrigger(characterId: string, triggerType: TriggerType): Promise<void> {
    logger.info(`[AutoMessageHandler] 触发: ${characterId}, 类型=${triggerType}`)

    try {
      const characterInfo = this.getCharacterInfo(characterId)

      // 直接调用模型 API — 完全控制 prompt
      const systemPrompt = this.buildSystemPrompt(triggerType, characterInfo)
      const now = new Date()
      const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

      const response = await modelRouter.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `[系统提示：当前时间 ${timeStr}，请根据上面的指令生成消息]` }
        ],
        provider: characterInfo.provider || 'mimo',
        model: characterInfo.model || 'mimo-v2.5',
        temperature: characterInfo.temperature ?? 0.85,
        maxTokens: 200,
        apiKey: characterInfo.apiKey,
        baseUrl: characterInfo.baseUrl
      })

      let message = response.content.trim()
      logger.info(`[AutoMessageHandler] 模型回复: ${message.substring(0, 50)}...`)

      // 模型返回空内容时用兜底消息
      if (!message) {
        message = this.getFallbackMessage(triggerType)
        logger.info(`[AutoMessageHandler] 模型返回空，使用兜底: ${message}`)
      }

      // 通知前端显示（不保存到聊天记录文件，避免堆积）
      if (this.mainWindow) {
        this.mainWindow.webContents.send('proactive:message', {
          characterId,
          content: message
        })
      }

      // 显示系统级通知
      this.showNotification(characterId, message, characterInfo)
    } catch (err) {
      logger.error(`[AutoMessageHandler] 生成消息失败: ${characterId}`, err)
      const fallback = this.getFallbackMessage(triggerType)
      this.showNotification(characterId, fallback, this.getCharacterInfo(characterId))
    }
  }

  /**
   * 构建 system prompt — 让模型主动生成消息
   */
  private buildSystemPrompt(triggerType: TriggerType, info: { name: string; persona?: string }): string {
    const now = new Date()
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

    const persona = info.persona || '你是一个温柔体贴的恋人'

    switch (triggerType) {
      case 'morning':
        return `${persona}\n\n现在是${dateStr} ${timeStr}（早上）。\n你正在给对方发一条早安消息。直接输出消息内容，不要加任何前缀、标签或解释。像真人发微信一样简短亲切。`
      case 'night':
        return `${persona}\n\n现在是${dateStr} ${timeStr}（深夜）。\n你正在给对方发一条晚安消息。直接输出消息内容，不要加任何前缀、标签或解释。温柔一点。`
      case 'missYou':
        return `${persona}\n\n现在是${dateStr} ${timeStr}。\n对方已经很久没回复你了，你正在给对方发一条消息表达想念。直接输出消息内容，不要加任何前缀、标签或解释。带点撒娇的语气。`
      default:
        return `${persona}\n\n你正在主动给对方发一条消息。直接输出消息内容。`
    }
  }

  /**
   * 兜底消息（模型调用失败时）
   */
  private getFallbackMessage(triggerType: TriggerType): string {
    switch (triggerType) {
      case 'morning': return '早安呀~ 新的一天开始了 ☀️'
      case 'night': return '晚安啦~ 做个好梦 🌙'
      case 'missYou': return '想你了...你怎么还不来找我 🥺'
      default: return '在吗？'
    }
  }

  private showNotification(characterId: string, message: string, characterInfo?: { name: string; avatarEmoji: string; persona?: string }): void {
    try {
      const info = characterInfo || this.getCharacterInfo(characterId)
      logger.info(`[AutoMessageHandler] 通知: name=${info.name}, avatarEmoji=${info.avatarEmoji}, avatarLen=${info.avatarEmoji.length}`)
      const nw = getNotificationWindow()
      nw.show(info.name, message, info.avatarEmoji)
    } catch (err) {
      logger.error('显示通知失败:', err)
    }
  }

  private getCharacterInfo(characterId: string): { name: string; avatarEmoji: string; persona?: string; provider?: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number } {
    try {
      const yaml = require('yaml')
      const possiblePaths = [
        join(PATHS.characters, characterId, 'config.yaml')
      ]

      for (const configPath of possiblePaths) {
        if (existsSync(configPath)) {
          const config = yaml.parse(readFileSync(configPath, 'utf-8'))
          logger.info(`[AutoMessageHandler] 读取角色配置: path=${configPath}, name=${config.name}, avatar=${config.avatar}, avatarType=${typeof config.avatar}`)
          return {
            name: config.name || 'AI助手',
            avatarEmoji: (config.avatar && config.avatar.length <= 2) ? config.avatar : '🤖',
            persona: config.persona,
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            temperature: config.temperature
          }
        }
      }
    } catch (err) {
      logger.error('获取角色信息失败:', err)
    }
    return { name: 'AI助手', avatarEmoji: '🤖' }
  }
}

// 模块级单例引用
let _instance: AutoMessageHandler | null = null

export function setAutoMessageHandlerInstance(handler: AutoMessageHandler): void {
  _instance = handler
}

export function getAutoMessageHandlerInstance(): AutoMessageHandler | null {
  return _instance
}
