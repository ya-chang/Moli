// src/main/knowledge/KnowledgeGenerator.ts
// 知识生成器 — SQLite 的下游，异步触发调模型分析 → 写 MD 文件
// 每 30 条 → 风格学习，每 50 条 → 摘要，每 100 条 → 用户画像

import { KnowledgeManager } from './KnowledgeManager'
import { ModelRouter, type ChatMessage } from '../engine/ModelRouter'
import { loadModelsConfig } from '../utils/config'
import { logger } from '../utils/logger'

const TRIGGER_INTERVALS = {
  styleLearning: 30,   // 每 30 条触发风格学习
  chatSummary: 50,     // 每 50 条触发摘要更新
  userProfile: 100     // 每 100 条触发画像更新
} as const

export interface GenerateContext {
  characterId: string
  characterName: string
  persona: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>
  apiKey?: string
  baseUrl?: string
}

export class KnowledgeGenerator {
  private router: ModelRouter
  private managers: Map<string, KnowledgeManager> = new Map()
  private counters: Map<string, number> = new Map()
  private logger: typeof logger = logger

  constructor(router?: ModelRouter) {
    this.router = router || new ModelRouter()
  }

  private getManager(characterId: string): KnowledgeManager {
    if (!this.managers.has(characterId)) {
      this.managers.set(characterId, new KnowledgeManager(characterId))
    }
    return this.managers.get(characterId)!
  }

  /**
   * 检查角色是否有自己的 API Key
   * 没有 key 则跳过，不消耗 token
   * 全局配置不作为 fallback
   */
  private hasValidApiKey(ctx: GenerateContext): boolean {
    return !!(ctx.apiKey && ctx.apiKey.trim())
  }

  /**
   * 消息计数器 — 每次收到消息调用，达到阈值时触发生成
   */
  incrementAndCheck(characterId: string): {
    triggerStyleLearning: boolean
    triggerChatSummary: boolean
    triggerUserProfile: boolean
  } {
    const count = (this.counters.get(characterId) ?? 0) + 1
    this.counters.set(characterId, count)

    const result = {
      triggerStyleLearning: count % TRIGGER_INTERVALS.styleLearning === 0,
      triggerChatSummary: count % TRIGGER_INTERVALS.chatSummary === 0,
      triggerUserProfile: count % TRIGGER_INTERVALS.userProfile === 0
    }

    if (result.triggerStyleLearning) logger.info(`角色 ${characterId} 触发风格学习 (msg #${count})`)
    if (result.triggerChatSummary) logger.info(`角色 ${characterId} 触发摘要更新 (msg #${count})`)
    if (result.triggerUserProfile) logger.info(`角色 ${characterId} 触发画像更新 (msg #${count})`)

    return result
  }

  /**
   * 生成风格学习 — 分析用户偏好的说话风格
   * 输入：最近 30 条消息
   * 输出：追加到 style_learning.md 的风格规则
   */
  async generateStyleLearning(ctx: GenerateContext): Promise<void> {
    if (!this.hasValidApiKey(ctx)) {
      this.logger.info(`角色 ${ctx.characterId} 跳过风格学习: 无可用 API Key`)
      return
    }

    const manager = this.getManager(ctx.characterId)
    const recentMessages = ctx.messages.slice(-30)

    if (recentMessages.length < 10) return

    const conversationText = recentMessages
      .map((m) => `${m.role === 'user' ? '用户' : ctx.characterName}：${m.content}`)
      .join('\n')

    const currentStyle = manager.readStyleLearning()

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个对话风格分析器。分析用户的聊天习惯，提取他们喜欢的对话风格。

规则：
1. 只提取用户明确表达的偏好（如"别叫我宝贝"、"你说话好可爱"）
2. 从行为推断偏好（如用户回复短 → 喜欢简洁）
3. 每次最多提取 3 条新规则
4. 用简洁的中文写入，格式："用户偏好：xxx"
5. 如果没有新发现，返回"无新发现"

不要分析 AI 的回复，只分析用户的消息模式。`
      },
      {
        role: 'user',
        content: `以下是最近的对话：

${conversationText}

当前风格学习记录：
${currentStyle}

请分析是否有新的用户风格偏好需要记录。如果有，输出新的偏好规则；如果没有，输出"无新发现"。`
      }
    ]

    try {
      const config = loadModelsConfig()
      const defaultModel = config.default

      const response = await this.router.chat({
        messages,
        provider: ctx.apiKey ? 'custom' : defaultModel.provider,
        model: defaultModel.model,
        temperature: 0.3,
        maxTokens: 500,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl
      })

      const result = response.content.trim()
      if (result === '无新发现' || result.includes('无新发现')) {
        logger.info(`角色 ${ctx.characterId} 风格学习：无新发现`)
        return
      }

      // 归档旧风格学习（超过 20 条时）
      const lines = currentStyle.split('\n').filter(l => l.trim().startsWith('-'))
      if (lines.length > 20) {
        const toArchive = lines.slice(0, lines.length - 20).join('\n')
        const keep = lines.slice(lines.length - 20).join('\n')
        manager.appendArchive('style_learning', toArchive)
        manager.writeStyleLearning('# 风格学习记录\n\n## 用户偏好（自动学习）\n\n' + keep)
        logger.info(`角色 ${ctx.characterId} 风格学习已归档 ${lines.length - 20} 条`)
      } else {
        // 追加到 style_learning.md
        const timestamp = new Date().toLocaleDateString('zh-CN')
        const entry = `\n- ${result} [隐式·${timestamp}]`
        const updated = currentStyle + entry
        manager.writeStyleLearning(updated)
      }
      logger.info(`角色 ${ctx.characterId} 风格学习已更新`)
    } catch (error) {
      logger.error(`风格学习生成失败: ${ctx.characterId}`, error)
    }
  }

  /**
   * 生成对话摘要 — 压缩最近对话脉络
   * 输入：最近 50 条消息
   * 输出：覆盖写入 chat_summary.md
   */
  async generateChatSummary(ctx: GenerateContext): Promise<void> {
    if (!this.hasValidApiKey(ctx)) {
      this.logger.info(`角色 ${ctx.characterId} 跳过摘要生成: 无可用 API Key`)
      return
    }

    const manager = this.getManager(ctx.characterId)
    const recentMessages = ctx.messages.slice(-50)

    if (recentMessages.length < 10) return

    const conversationText = recentMessages
      .map((m) => `${m.role === 'user' ? '用户' : ctx.characterName}：${m.content}`)
      .join('\n')

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个对话摘要生成器。将对话压缩成简洁的摘要，保留关键信息。

规则：
1. 按日期分组，每天一段摘要
2. 保留：讨论的话题、重要事件、用户的情绪变化、AI 的承诺
3. 丢弃：闲聊细节、重复内容
4. 用简洁的中文，每段 2-3 句话
5. 格式：日期：摘要内容
6. 只保留最近 7 天的摘要，更早的丢弃`
      },
      {
        role: 'user',
        content: `请为以下对话生成摘要：

${conversationText}`
      }
    ]

    try {
      const config = loadModelsConfig()
      const defaultModel = config.default

      const response = await this.router.chat({
        messages,
        provider: ctx.apiKey ? 'custom' : defaultModel.provider,
        model: defaultModel.model,
        temperature: 0.3,
        maxTokens: 800,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl
      })

      // 归档旧摘要（如果有的话）
      const currentSummary = manager.readChatSummary()
      const summaryBody = currentSummary.replace(/^#.*\n>.*\n\n?/m, '').trim()
      if (summaryBody.length > 50) {
        manager.appendArchive('chat_summary', summaryBody)
        logger.info(`角色 ${ctx.characterId} 旧摘要已归档`)
      }

      const header = '# 对话摘要\n\n> AI 会自动压缩旧对话，保留脉络\n\n'
      manager.writeChatSummary(header + response.content.trim())
      logger.info(`角色 ${ctx.characterId} 对话摘要已更新`)
    } catch (error) {
      logger.error(`对话摘要生成失败: ${ctx.characterId}`, error)
    }
  }

  /**
   * 生成用户画像 — 提取关于用户的事实
   * 输入：最近 100 条消息 + 当前画像
   * 输出：覆盖写入 user_profile.md
   */
  async generateUserProfile(ctx: GenerateContext): Promise<void> {
    if (!this.hasValidApiKey(ctx)) {
      this.logger.info(`角色 ${ctx.characterId} 跳过画像生成: 无可用 API Key`)
      return
    }

    const manager = this.getManager(ctx.characterId)
    const recentMessages = ctx.messages.slice(-100)

    if (recentMessages.length < 20) return

    const conversationText = recentMessages
      .map((m) => `${m.role === 'user' ? '用户' : ctx.characterName}：${m.content}`)
      .join('\n')

    const currentProfile = manager.readUserProfile()

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个用户画像提取器。从对话中提取关于用户的事实信息。

提取类别：
1. 基本信息：名字、年龄、生日、职业、所在地
2. 喜好：喜欢/讨厌的食物、活动、音乐、电影等
3. 习惯：作息、工作模式、聊天习惯
4. 重要事件：面试、升职、生日、旅行等
5. 情绪特征：压力来源、开心的事、敏感话题

规则：
1. 只提取用户明确提到或暗示的事实
2. 不要推测，只记录确定的信息
3. 每条事实注明来源（来自哪句话）
4. 如果新事实与旧事实矛盾，以新的为准
5. 输出格式：分类 + 事实 + 来源
6. 保留旧画像中仍然有效的信息`
      },
      {
        role: 'user',
        content: `当前用户画像：
${currentProfile}

最近对话：
${conversationText}

请更新用户画像，保留旧信息，添加新发现的事实。`
      }
    ]

    try {
      const config = loadModelsConfig()
      const defaultModel = config.default

      const response = await this.router.chat({
        messages,
        provider: ctx.apiKey ? 'custom' : defaultModel.provider,
        model: defaultModel.model,
        temperature: 0.3,
        maxTokens: 1000,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl
      })

      // 归档旧画像（如果有的话）
      const profileBody = currentProfile.replace(/^#.*\n>.*\n\n?/m, '').trim()
      if (profileBody.length > 50) {
        manager.appendArchive('user_profile', profileBody)
        logger.info(`角色 ${ctx.characterId} 旧画像已归档`)
      }

      const header = '# 用户画像\n\n> AI 会自动从对话中提取关于你的信息\n\n'
      manager.writeUserProfile(header + response.content.trim())
      logger.info(`角色 ${ctx.characterId} 用户画像已更新`)
    } catch (error) {
      logger.error(`用户画像生成失败: ${ctx.characterId}`, error)
    }
  }

  /**
   * 提取结构化记忆 — 分析对话提取偏好/事件/禁忌
   * 每 20 条触发
   */
  async generateStructuredMemory(ctx: GenerateContext): Promise<void> {
    if (!this.hasValidApiKey(ctx)) return

    const manager = this.getManager(ctx.characterId)
    const recentMessages = ctx.messages.slice(-20)

    if (recentMessages.length < 5) return

    const conversationText = recentMessages
      .map((m) => `${m.role === 'user' ? '用户' : ctx.characterName}：${m.content}`)
      .join('\n')

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个记忆提取器。从对话中提取需要记录到结构化记忆中的信息。

请以 JSON 格式输出（不要输出其他内容）：
{
  "preferences": {
    "类别名": { "likes": ["喜欢的东西"], "dislikes": ["不喜欢的东西"] }
  },
  "events": [
    { "event": "事件描述", "details": "细节", "emotional_weight": "high/medium/low" }
  ],
  "taboos": ["禁忌话题"]
}

规则：
1. 只提取用户明确提到或暗示的信息
2. 类别名用英文：food/music/game/movie/hobby/work/travel/pet/sleep
3. 如果没有新发现，返回空 JSON：{}
4. 每次最多提取 3 个偏好、2 个事件、1 个禁忌`
      },
      {
        role: 'user',
        content: `对话内容：\n${conversationText}`
      }
    ]

    try {
      const config = loadModelsConfig()
      const defaultModel = config.default

      const response = await this.router.chat({
        messages,
        provider: ctx.apiKey ? 'custom' : defaultModel.provider,
        model: defaultModel.model,
        temperature: 0.2,
        maxTokens: 800,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl
      })

      const result = response.content.trim()
      // 尝试解析 JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return

      const extracted = JSON.parse(jsonMatch[0]) as {
        preferences?: Record<string, { likes?: string[]; dislikes?: string[] }>
        events?: Array<{ event: string; details?: string; emotional_weight?: string }>
        taboos?: string[]
      }

      // 更新结构化记忆
      if (extracted.preferences) {
        for (const [category, pref] of Object.entries(extracted.preferences)) {
          if (pref.likes?.length || pref.dislikes?.length) {
            manager.updatePreference(category, pref.likes || [], pref.dislikes || [])
          }
        }
      }

      if (extracted.events) {
        for (const event of extracted.events) {
          manager.addKeyEvent(event.event, event.details || '', (event.emotional_weight as any) || 'medium')
        }
      }

      if (extracted.taboos) {
        for (const taboo of extracted.taboos) {
          manager.addTaboo(taboo)
        }
      }

      logger.info(`角色 ${ctx.characterId} 结构化记忆已更新`)
    } catch (error) {
      logger.error(`结构化记忆提取失败: ${ctx.characterId}`, error)
    }
  }
}
