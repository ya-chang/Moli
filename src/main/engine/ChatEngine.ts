// src/main/engine/ChatEngine.ts
// 对话引擎 — 协调模型调用、记忆检索、学习分析、情感状态、知识库生成

import { ModelRouter, type ChatMessage, type ChatResponse } from './ModelRouter'
import { SamplingStrategy, type MessageType } from './SamplingStrategy'
import { QualityChecker } from './QualityChecker'
import { PersonaCFG, type RelationshipStage } from './PersonaCFG'
import { ConfigComposer } from '../config/ConfigComposer'
import { MemoryManager, type MemoryContext } from '../memory/MemoryManager'
import { LearningEngine } from '../learning/LearningEngine'
import { EmotionFSM, type EmotionalState } from '../emotion/EmotionFSM'
import { KnowledgeManager, type StructuredMemory } from '../knowledge/KnowledgeManager'
import { TopicClassifier, type Topic } from '../knowledge/TopicClassifier'
import { KnowledgeGenerator, type GenerateContext } from '../knowledge/KnowledgeGenerator'
import { BannedWordFilter } from '../filter/BannedWordFilter'
import { MusicContextInjector } from '../music/MusicContextInjector'
import { AwarenessManager } from '../awareness/AwarenessManager'
import { TTSService } from '../tts/TTSService'
import { TTSState } from '../tts/TTSState'
import { filterForTTS } from '../tts/TextFilter'
import { pluginPromptStore } from '../plugins/PluginPromptStore'
import { EmojiManager } from '../emojis/EmojiManager'
import { EmojiSelector } from '../emojis/EmojiSelector'
import { EmojiFrequency, type FrequencyMode } from '../emojis/EmojiFrequency'
import { loadModelsConfig } from '../utils/config'
import { logger } from '../utils/logger'

const bannedWordFilter = new BannedWordFilter()

// TODO: [P5] 人设 prompt 从角色配置读取
const DEFAULT_PERSONA =
  '你是一个温柔体贴的恋人，说话自然亲切，像真人微信聊天一样。' +
  '可以用表情、语气词、叠字。回复不要太长，像真人打字一样。' +
  '【重要】绝对不要重复自己说过的话，每句话只说一遍。' +
  '不要出现两段一模一样的内容，也不要换几个字再说一遍同样的意思。' +
  '如果你发现自己要重复前面说过的话，请换一个新话题或新角度。'

export interface SendMessageParams {
  content: string
  characterId: string
  history: ChatMessage[]
  persona?: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  quoteContent?: string
  userName?: string
  images?: string[]  // base64 data URLs
  // 视觉模型覆盖（有图片时使用）
  visionProvider?: string
  visionModel?: string
  visionApiKey?: string
  visionBaseUrl?: string
  currentSong?: {
    name: string
    artist: string
    album: string
    lyricsSnippet: string
    description: string
  }
}

export class ChatEngine {
  private router = new ModelRouter()
  private samplingStrategy = new SamplingStrategy()
  private qualityChecker = new QualityChecker()
  private configComposer = ConfigComposer.getInstance()
  private personaCFGs: Map<string, PersonaCFG> = new Map()
  private memoryManagers: Map<string, MemoryManager> = new Map()
  private learningEngines: Map<string, LearningEngine> = new Map()
  private emotionFSMs: Map<string, EmotionFSM> = new Map()
  private knowledgeManagers: Map<string, KnowledgeManager> = new Map()
  private knowledgeGenerator = new KnowledgeGenerator(this.router)
  private messageCounts: Map<string, number> = new Map()
  private musicContextInjector = new MusicContextInjector()
  private awarenessManager = new AwarenessManager()
  private topicClassifier = new TopicClassifier()
  private ttsService: TTSService | null = null
  private ttsState: TTSState | null = null
  private currentSongInfo: import('../music/MusicState').FullSongInfo | null = null
  private emojiManager: EmojiManager | null = null
  private emojiSelectors: Map<string, EmojiSelector> = new Map()
  // 存储最近的回复用于质量检查
  private recentReplies: Map<string, string[]> = new Map()
  // 存储关系阶段（用于PersonaCFG）
  private relationshipStages: Map<string, RelationshipStage> = new Map()

  private getMemoryManager(characterId: string): MemoryManager {
    if (!this.memoryManagers.has(characterId)) {
      this.memoryManagers.set(characterId, new MemoryManager(characterId))
    }
    return this.memoryManagers.get(characterId)!
  }

  private getLearningEngine(characterId: string): LearningEngine {
    if (!this.learningEngines.has(characterId)) {
      this.learningEngines.set(characterId, new LearningEngine())
    }
    return this.learningEngines.get(characterId)!
  }

  private getEmotionFSM(characterId: string): EmotionFSM {
    if (!this.emotionFSMs.has(characterId)) {
      this.emotionFSMs.set(characterId, new EmotionFSM(characterId))
    }
    return this.emotionFSMs.get(characterId)!
  }

  private getKnowledgeManager(characterId: string): KnowledgeManager {
    if (!this.knowledgeManagers.has(characterId)) {
      this.knowledgeManagers.set(characterId, new KnowledgeManager(characterId))
    }
    return this.knowledgeManagers.get(characterId)!
  }

  /**
   * 获取或创建 PersonaCFG 实例
   */
  private async getOrCreatePersonaCFG(characterId: string): Promise<PersonaCFG> {
    if (!this.personaCFGs.has(characterId)) {
      // 从配置获取角色信息
      const composedConfig = await this.configComposer.compose(characterId)
      
      const persona = {
        name: composedConfig.name,
        personality: composedConfig.personality,
        style: composedConfig.style,
        catchphrases: composedConfig.catchphrases,
        bannedWords: composedConfig.bannedWords
      }
      
      this.personaCFGs.set(characterId, new PersonaCFG(persona))
    }
    return this.personaCFGs.get(characterId)!
  }

  /**
   * 获取关系阶段（基于亲密度）
   * stranger: < 30, friend: 30-70, lover: > 70
   */
  private getRelationshipStage(characterId: string): RelationshipStage {
    const emotionFSM = this.getEmotionFSM(characterId)
    const state = emotionFSM.getState()
    
    if (state.intimacy < 30) return 'stranger'
    if (state.intimacy < 70) return 'friend'
    return 'lover'
  }

  async sendMessage(params: SendMessageParams): Promise<ChatResponse> {
    const config = loadModelsConfig()
    const defaultModel = config.default

    const memoryManager = this.getMemoryManager(params.characterId)
    const learningEngine = this.getLearningEngine(params.characterId)
    const emotionFSM = this.getEmotionFSM(params.characterId)

    // 规则引擎分析用户情绪
    const { emotion } = learningEngine.analyzeMessage(params.content)

    // 情感状态机处理
    const emotionalState = emotionFSM.processMessage(params.content, emotion)

    // 检查是否需要和好
    if (emotionFSM.shouldReconcile()) {
      emotionFSM.reconcile()
      logger.info('角色主动和好')
    }

    // 记录用户消息到记忆
    memoryManager.addMessage({
      role: 'user',
      content: params.content,
      timestamp: Date.now()
    })

    // 获取记忆上下文（带token预算控制）
    const memoryContext = await memoryManager.getContext(params.content, 300)

    // ====== PersonaCFG 人设强化（Phase 2 优化） ======
    const personaCFG = await this.getOrCreatePersonaCFG(params.characterId)
    const relationshipStage = this.getRelationshipStage(params.characterId)
    const strength = personaCFG.getStrength(relationshipStage, {
      trust: emotionalState.trust,
      intimacy: emotionalState.intimacy
    })
    
    // 构建人设约束的 system prompt
    const emotionSummary = `心情: ${emotionalState.currentMood}, 开心: ${emotionalState.happiness}, 思念: ${emotionalState.missLevel}`
    const personaPrompt = personaCFG.buildPrompt(emotionSummary, strength)
    
    logger.info(`[ChatEngine] 人设强度: ${strength.toFixed(2)}, 关系阶段: ${relationshipStage}`)

    // 构建带记忆的 system prompt（注入 MD 文件内容）
    const systemPrompt = this.buildSystemPrompt(
      params.persona || DEFAULT_PERSONA,
      memoryContext,
      params.content,
      emotion,
      emotionalState.currentMood,
      params.characterId,
      params.quoteContent,
      params.userName,
      params.currentSong,
      personaPrompt  // 新增：人设约束prompt
    )

    // ====== 差异化采样策略（Phase 1 优化） ======
    // 1. 消息分类
    const messageType = this.samplingStrategy.classify(params.content, {
      sadness: emotionalState.sadness,
      anger: emotionalState.anger,
      happiness: emotionalState.happiness
    })
    
    // 2. 获取差异化采样参数
    let samplingParams = this.samplingStrategy.getParams(messageType)
    
    // 3. PersonaCFG 采样参数覆盖（根据人设强度）
    const cfgOverrides = personaCFG.getSamplingOverrides(strength)
    samplingParams = this.samplingStrategy.merge(samplingParams, cfgOverrides, messageType)
    
    // 4. 情感状态影响采样（思念→更温柔，好感→更撩人，愤怒→更克制）
    const emotionOverrides = this.getEmotionBasedSamplingOverrides(emotionalState)
    if (emotionOverrides) {
      samplingParams = this.samplingStrategy.merge(samplingParams, emotionOverrides, messageType)
    }
    
    logger.info(`[ChatEngine] 消息类型: ${this.samplingStrategy.getTypeName(messageType)}, temp: ${samplingParams.temperature.toFixed(2)}`)

    // 组装用户消息（支持多模态：文字 + 图片）
    const userContent: string | import('./ModelRouter').MultimodalContent[] =
      params.images && params.images.length > 0
        ? [
            ...params.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
            { type: 'text' as const, text: params.content }
          ]
        : params.content

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...params.history,
      { role: 'user', content: userContent }
    ]

    try {
      // 有图片时优先使用视觉模型配置
      const hasImages = params.images && params.images.length > 0
      const useProvider = hasImages && params.visionProvider ? params.visionProvider : (params.provider || defaultModel.provider)
      const useModel = hasImages && params.visionModel ? params.visionModel : (params.model || defaultModel.model)
      const useApiKey = hasImages && params.visionApiKey ? params.visionApiKey : params.apiKey
      const useBaseUrl = hasImages && params.visionBaseUrl ? params.visionBaseUrl : params.baseUrl

      logger.info(`[ChatEngine] hasImages=${hasImages}, visionProvider=${params.visionProvider}, visionModel=${params.visionModel}, useProvider=${useProvider}, useModel=${useModel}`)

      const response = await this.router.chat({
        messages,
        provider: useProvider,
        model: useModel,
        temperature: defaultModel.temperature,
        maxTokens: defaultModel.maxTokens,
        apiKey: useApiKey,
        baseUrl: useBaseUrl,
        samplingOverrides: samplingParams  // 传入差异化采样参数
      })

      // ====== 质量检查 + 人设一致性检查（Phase 1+2 优化） ======
      const recentReplies = this.getRecentReplies(params.characterId)
      const qualityCheck = this.qualityChecker.check(response.content, {
        recentMessages: recentReplies,
        userMessage: params.content
      })
      
      // 人设一致性检查
      const consistencyCheck = personaCFG.checkConsistency(response.content)
      
      if (qualityCheck.severity === 'fail' || !consistencyCheck.ok) {
        const allIssues = [...qualityCheck.issues, ...consistencyCheck.violations]
        logger.warn(`[ChatEngine] 回复质量/人设检查失败: ${allIssues.join(', ')}`)
      } else if (qualityCheck.severity === 'warn') {
        logger.info(`[ChatEngine] 回复质量警告: ${qualityCheck.issues.join(', ')}`)
      }
      
      // 记录最近的回复
      this.addRecentReply(params.characterId, response.content)

      // 增加PersonaCFG交互计数
      personaCFG.tick()

      // 记录助手回复到记忆
      memoryManager.addMessage({
        role: 'assistant',
        content: response.content,
        timestamp: Date.now()
      })

      // 禁词过滤
      const filteredContent = bannedWordFilter.filter(response.content)
      if (filteredContent !== response.content) {
        response.content = filteredContent
      }

      // 异步触发知识库生成（不阻塞回复）
      this.triggerKnowledgeGeneration(params.characterId, params.apiKey, params.baseUrl)

      return response
    } catch (error) {
      logger.error('对话引擎调用失败', error)
      throw error
    }
  }

  /**
   * 根据情感状态获取采样参数覆盖
   * 情感状态应该影响回复风格
   */
  private getEmotionBasedSamplingOverrides(emotion: EmotionalState): Partial<import('./SamplingStrategy').SamplingParams> | null {
    // 高思念 → 更温柔的回复（更稳定）
    if (emotion.missLevel > 70) {
      return { temperature: 0.6, topP: 0.85 }
    }
    
    // 高好感 → 更撩人（更多样）
    if (emotion.affection > 70) {
      return { temperature: 1.0, topP: 0.95 }
    }
    
    // 高愤怒 → 更克制（更保守）
    if (emotion.anger > 50) {
      return { temperature: 0.5, topP: 0.8 }
    }
    
    // 高开心 → 更活泼
    if (emotion.happiness > 80) {
      return { temperature: 0.9, topP: 0.93 }
    }
    
    return null // 使用默认
  }

  /**
   * 获取最近的回复（用于质量检查）
   */
  private getRecentReplies(characterId: string): string[] {
    return this.recentReplies.get(characterId) || []
  }

  /**
   * 添加最近的回复
   */
  private addRecentReply(characterId: string, reply: string): void {
    const replies = this.recentReplies.get(characterId) || []
    replies.push(reply)
    // 只保留最近5条
    if (replies.length > 5) {
      replies.shift()
    }
    this.recentReplies.set(characterId, replies)
  }

  private buildSystemPrompt(
    persona: string,
    context: MemoryContext,
    userMessage: string,
    userEmotion?: string,
    characterMood?: string,
    characterId?: string,
    quoteContent?: string,
    userName?: string,
    currentSong?: SendMessageParams['currentSong'],
    personaPrompt?: string  // Phase 2: 人设约束prompt
  ): string {
    const parts: string[] = [persona]
    
    // Phase 2: 注入人设约束prompt（如果有）
    if (personaPrompt) {
      parts.push(`\n=== 人设约束 ===\n${personaPrompt}`)
    }

    // 开头注入用户名字（最高优先级）
    if (userName) {
      parts.unshift(`【重要规则】用户的名字是"${userName}"，你必须用"${userName}"来称呼用户。不要用其他人设中提到的任何名字。`)
    }

    // 注入感知模块（节假日+时间）
    try {
      const awarenessPrompt = this.awarenessManager.buildPrompt()
      if (awarenessPrompt) {
        parts.push(awarenessPrompt)
      }
    } catch (err) { logger.debug('感知模块注入失败', err) }

    // 注入用户名字
    if (userName) {
      parts.push(`\n## 用户信息\n- 名字：${userName}`)
    }

    // 注入当前歌曲（从参数或全局状态）
    const songInfo = currentSong || this.currentSongInfo
    if (songInfo && 'detail' in songInfo) {
      const musicContext = this.musicContextInjector.buildContext(songInfo as import('../music/MusicState').FullSongInfo)
      if (musicContext) {
        parts.push(musicContext)
      }
    }

    // 注入引用的消息
    if (quoteContent) {
      parts.push(`\n## 用户引用了之前的消息\n"${quoteContent}"\n请基于这条引用内容回复。`)
    }

    // 注入角色当前情绪
    if (characterMood && characterMood !== 'happy') {
      parts.push(`\n## 你当前的情绪\n${characterMood}`)
    }

    // 注入用户情绪
    if (userEmotion && userEmotion !== 'neutral') {
      parts.push(`\n## 用户当前情绪\n${userEmotion}`)
    }

    // ====== 分级记忆注入（借鉴 K3 架构） ======
    if (characterId) {
      const knowledge = this.getKnowledgeManager(characterId)
      const structuredMemory = knowledge.readStructuredMemory()

      // --- L1 核心记忆：永远置顶注入 ---
      const l1 = structuredMemory.l1_core
      if (l1.core_personality.length > 0 || l1.speech_style) {
        const personalityStr = l1.core_personality.length > 0
          ? `性格：${l1.core_personality.join('、')}`
          : ''
        const styleStr = l1.speech_style ? `说话风格：${l1.speech_style}` : ''
        parts.push(`\n## 核心设定\n${[personalityStr, styleStr].filter(Boolean).join('\n')}`)
      }

      // --- L2 重要记忆：按话题选择性注入 ---
      const topics = this.topicClassifier.classify(userMessage)
      const l2 = structuredMemory.l2_important
      const l2Parts: string[] = []

      // 按话题匹配偏好
      for (const topic of topics) {
        const pref = l2.preferences[topic]
        if (pref) {
          const likes = pref.likes.length > 0 ? `喜欢：${pref.likes.join('、')}` : ''
          const dislikes = pref.dislikes.length > 0 ? `不喜欢：${pref.dislikes.join('、')}` : ''
          l2Parts.push([likes, dislikes].filter(Boolean).join('，'))
          // 更新最后提及时间
          knowledge.touchMemory(topic)
        }
      }

      // 匹配相关事件
      if (topics.length > 0) {
        const relevantEvents = l2.key_events.filter(e => {
          const eventText = e.event + e.details
          return topics.some(t => {
            const keywords = this.topicClassifier['classify']?.(eventText) || []
            return keywords.includes(t)
          })
        }).slice(-3) // 最近3个相关事件
        for (const event of relevantEvents) {
          l2Parts.push(`${event.date}：${event.event}${event.details ? ' - ' + event.details : ''}`)
        }
      }

      // 禁忌（永远注入）
      if (l2.taboos.length > 0) {
        l2Parts.push(`禁忌/雷区：${l2.taboos.join('、')}`)
      }

      // 里程碑
      if (l2.milestones.length > 0) {
        l2Parts.push(`关系节点：${l2.milestones.join('、')}`)
      }

      if (l2Parts.length > 0) {
        parts.push(`\n## 关于用户的重要信息\n${l2Parts.join('\n')}`)
      }

      // --- L3 细节记忆：从 MD 文件注入（近期摘要 + 风格学习） ---
      const summaryAll = [
        this.extractUsefulContent(knowledge.readChatSummary(), 800),
        this.extractUsefulContent(knowledge.readArchive('chat_summary'), 500)
      ].filter(Boolean).join('\n\n(历史) ')
      if (summaryAll) {
        parts.push(`\n=== 近期对话摘要 ===\n${summaryAll}`)
      }

      const styleAll = [
        this.extractUsefulContent(knowledge.readStyleLearning(), 800),
        this.extractUsefulContent(knowledge.readArchive('style_learning'), 500)
      ].filter(Boolean).join('\n\n(历史) ')
      if (styleAll) {
        parts.push(`\n=== 用户偏好（自动学习） ===\n${styleAll}`)
      }
    }

    // 注入相关记忆（向量检索结果）
    if (context.relevantMemories.length > 0) {
      const memories = context.relevantMemories
        .map((m) => `- ${m.content}`)
        .join('\n')
      parts.push(`\n## 相关记忆\n${memories}`)
    }

    // 注入对话摘要（内存中的短期摘要）
    if (context.summaries.length > 0) {
      const latestSummary = context.summaries[context.summaries.length - 1]
      parts.push(`\n## 最近话题\n${latestSummary.summary}`)
    }

    // 注入插件全局 Prompt
    const globalPluginPrompts = pluginPromptStore.getGlobalPrompts()
    if (globalPluginPrompts.length > 0) {
      parts.push(globalPluginPrompts.join('\n\n'))
    }

    // 注入插件单角色 Prompt
    if (characterId) {
      const charPluginPrompts = pluginPromptStore.getCharacterPrompts(characterId)
      if (charPluginPrompts.length > 0) {
        parts.push(charPluginPrompts.join('\n\n'))
      }
    }

    // 注入禁词提示
    const bannedPrompt = bannedWordFilter.buildPromptSection()
    if (bannedPrompt) {
      parts.push(bannedPrompt)
    }

    // 最后注入用户名字（最高优先级，确保AI使用正确的名字）
    if (userName) {
      parts.push(`\n【重要】用户的真名是"${userName}"，请用这个名字称呼用户，不要用其他人设中提到的名字。`)
    }

    return parts.join('\n')
  }

  /** 估算 token 数（中文约 2 token/字，英文约 1 token/词） */
  private estimateTokens(text: string): number {
    let tokens = 0
    for (const ch of text) {
      // 中文及全角字符约 2 token
      if (ch.charCodeAt(0) > 0x2e80) {
        tokens += 2
      } else if (ch.trim()) {
        tokens += 0.5 // 英文字符约 0.5 token
      }
    }
    return Math.ceil(tokens)
  }

  /** 从 MD 文件内容中提取有用部分（去掉标题和注释），按 token 上限裁剪 */
  private extractUsefulContent(mdContent: string, maxTokens: number = 3000): string {
    if (!mdContent) return ''
    // 去掉 markdown 标题和引用注释行
    const lines = mdContent
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        if (!trimmed) return false
        if (trimmed.startsWith('#')) return false
        if (trimmed.startsWith('>')) return false
        return true
      })

    // 从后往前保留（最新的内容优先），直到达到 token 上限
    const result: string[] = []
    let tokenCount = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineTokens = this.estimateTokens(lines[i])
      if (tokenCount + lineTokens > maxTokens) break
      result.unshift(lines[i])
      tokenCount += lineTokens
    }

    return result.join('\n')
  }

  /**
   * 流式发送消息 — 返回 AsyncGenerator
   */
  async *sendMessageStream(params: SendMessageParams): AsyncGenerator<string> {
    const config = loadModelsConfig()
    const defaultModel = config.default

    const memoryManager = this.getMemoryManager(params.characterId)
    const learningEngine = this.getLearningEngine(params.characterId)
    const emotionFSM = this.getEmotionFSM(params.characterId)

    const { emotion } = learningEngine.analyzeMessage(params.content)
    const emotionalState = emotionFSM.processMessage(params.content, emotion)

    if (emotionFSM.shouldReconcile()) {
      emotionFSM.reconcile()
    }

    memoryManager.addMessage({
      role: 'user',
      content: params.content,
      timestamp: Date.now()
    })

    // Phase 2: PersonaCFG 人设强化
    const personaCFG = await this.getOrCreatePersonaCFG(params.characterId)
    const relationshipStage = this.getRelationshipStage(params.characterId)
    const strength = personaCFG.getStrength(relationshipStage, {
      trust: emotionalState.trust,
      intimacy: emotionalState.intimacy
    })
    
    const emotionSummary = `心情: ${emotionalState.currentMood}, 开心: ${emotionalState.happiness}, 思念: ${emotionalState.missLevel}`
    const personaPrompt = personaCFG.buildPrompt(emotionSummary, strength)

    const memoryContext = await memoryManager.getContext(params.content)
    const systemPrompt = this.buildSystemPrompt(
      params.persona || DEFAULT_PERSONA,
      memoryContext,
      params.content,
      emotion,
      undefined,
      params.characterId,
      params.quoteContent,
      params.userName,
      params.currentSong,
      personaPrompt
    )

    // 差异化采样
    const messageType = this.samplingStrategy.classify(params.content, {
      sadness: emotionalState.sadness,
      anger: emotionalState.anger,
      happiness: emotionalState.happiness
    })
    let samplingParams = this.samplingStrategy.getParams(messageType)
    const cfgOverrides = personaCFG.getSamplingOverrides(strength)
    samplingParams = this.samplingStrategy.merge(samplingParams, cfgOverrides, messageType)

    // 组装用户消息（支持多模态：文字 + 图片）
    const userContentStream: string | import('./ModelRouter').MultimodalContent[] =
      params.images && params.images.length > 0
        ? [
            ...params.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
            { type: 'text' as const, text: params.content }
          ]
        : params.content

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...params.history,
      { role: 'user', content: userContentStream }
    ]

    let fullContent = ''

    // 有图片时优先使用视觉模型配置
    const hasImages = params.images && params.images.length > 0
    const useProvider = hasImages && params.visionProvider ? params.visionProvider : (params.provider || defaultModel.provider)
    const useModel = hasImages && params.visionModel ? params.visionModel : (params.model || defaultModel.model)
    const useApiKey = hasImages && params.visionApiKey ? params.visionApiKey : params.apiKey
    const useBaseUrl = hasImages && params.visionBaseUrl ? params.visionBaseUrl : params.baseUrl

    if (hasImages) {
      logger.info(`[ChatEngine Stream] 使用视觉模型: ${useProvider}/${useModel}`)
    }

    for await (const chunk of this.router.chatStream({
      messages,
      provider: useProvider,
      model: useModel,
      temperature: samplingParams.temperature,
      maxTokens: defaultModel.maxTokens,
      apiKey: useApiKey,
      baseUrl: useBaseUrl,
      samplingOverrides: samplingParams
    })) {
      if (!chunk.done && chunk.content) {
        fullContent += chunk.content
        yield chunk.content
      }
    }

    // 流结束后记录助手回复到记忆
    memoryManager.addMessage({
      role: 'assistant',
      content: fullContent,
      timestamp: Date.now()
    })

    // TTS 合成由 ipc/chat.ts 在流结束后处理
    // 这里只记录日志

    // 异步触发知识库生成（不阻塞回复）
    this.triggerKnowledgeGeneration(params.characterId, params.apiKey, params.baseUrl)
  }

  getEmotionState(characterId: string) {
    return this.getEmotionFSM(characterId).getState()
  }

  /**
   * 获取 TTS 状态
   */
  getTTSState(): TTSState | null {
    return this.ttsState
  }

  /**
   * 获取 TTS 服务
   */
  getTTSService(): TTSService | null {
    return this.ttsService
  }

  /**
   * 设置当前播放歌曲信息（由音乐模块调用）
   */
  setCurrentSongInfo(songInfo: import('../music/MusicState').FullSongInfo | null): void {
    this.currentSongInfo = songInfo
  }

  startFighting(characterId: string): void {
    this.getEmotionFSM(characterId).startFighting()
  }

  saveMemories(): void {
    for (const manager of this.memoryManagers.values()) {
      manager.save()
    }
  }

  /**
   * 设置 TTS 服务和状态
   */
  setTTS(ttsService: TTSService, ttsState: TTSState): void {
    this.ttsService = ttsService
    this.ttsState = ttsState
  }

  /**
   * 获取过滤后的纯文本（用于 TTS 和展示）
   */
  getFilteredText(text: string): string {
    return filterForTTS(text)
  }

  /**
   * 获取当前角色的默认风格指令
   */
  getDefaultStylePrompt(characterId: string): string {
    const knowledge = this.getKnowledgeManager(characterId)
    const persona = knowledge.readPersona()
    if (!persona) return '用自然的语气说话'
    if (persona.includes('温柔') || persona.includes('体贴')) return '用温柔的语气说话'
    if (persona.includes('傲娇') || persona.includes('高冷')) return '用冷淡但偶尔傲娇的语气说话'
    if (persona.includes('搞笑') || persona.includes('活泼')) return '用活泼开朗的语气说话'
    return '用自然的语气说话'
  }

  /**
   * 设置 EmojiManager
   */
  setEmojiManager(emojiManager: EmojiManager): void {
    this.emojiManager = emojiManager
  }

  /**
   * 获取 EmojiSelector
   */
  private getEmojiSelector(characterId: string): EmojiSelector {
    if (!this.emojiSelectors.has(characterId)) {
      this.emojiSelectors.set(characterId, new EmojiSelector())
    }
    return this.emojiSelectors.get(characterId)!
  }

  /**
   * 获取 EmojiFrequency
   */
  private getEmojiFrequency(characterId: string): EmojiFrequency {
    // 每次从 EmojiManager 读取最新配置，确保设置变更后立即生效
    const config = this.emojiManager?.getConfig(characterId)
    return new EmojiFrequency(config ? { mode: config.frequencyMode } : undefined)
  }

  /**
   * 检查是否应该发送表情包
   */
  shouldSendEmoji(characterId: string): boolean {
    if (!this.emojiManager) return false

    const frequency = this.getEmojiFrequency(characterId)
    const stats = this.emojiManager.getStats(characterId)
    
    return frequency.shouldSend(stats.totalMessages, stats.emojiMessages)
  }

  /**
   * 选择表情包
   */
  selectEmoji(characterId: string, currentEmotion: string, userMessage: string): { id: string; filePath: string } | null {
    if (!this.emojiManager) return null

    const selector = this.getEmojiSelector(characterId)
    const emojis = this.emojiManager.getAll(characterId)
    
    if (emojis.length === 0) return null

    const selected = selector.select(currentEmotion, userMessage, emojis)
    if (!selected) return null

    const filePath = this.emojiManager.getFilePath(characterId, selected.id)
    if (!filePath) return null

    // 更新使用次数
    this.emojiManager.updateUsage(characterId, selected.id)

    return { id: selected.id, filePath }
  }

  /**
   * 异步触发知识库生成 — 不阻塞回复
   * 每 20 条 → 结构化记忆，每 30 条 → 风格学习，每 50 条 → 摘要，每 100 条 → 用户画像
   */
  private async triggerKnowledgeGeneration(
    characterId: string,
    apiKey?: string,
    baseUrl?: string
  ): Promise<void> {
    const count = (this.messageCounts.get(characterId) ?? 0) + 1
    this.messageCounts.set(characterId, count)

    const triggers = this.knowledgeGenerator.incrementAndCheck(characterId)
    const triggerStructured = count % 20 === 0

    if (!triggers.triggerStyleLearning && !triggers.triggerChatSummary && !triggers.triggerUserProfile && !triggerStructured) {
      return
    }

    // 异步执行，不阻塞主流程
    const memoryManager = this.getMemoryManager(characterId)
    const context = await memoryManager.getContext()
    const knowledgeManager = this.getKnowledgeManager(characterId)

    const ctx: GenerateContext = {
      characterId,
      characterName: '',
      persona: knowledgeManager.readPersona(),
      messages: context.recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp
      })),
      apiKey,
      baseUrl
    }

    if (triggerStructured) {
      this.knowledgeGenerator.generateStructuredMemory(ctx).catch((err) => {
        logger.error('异步结构化记忆提取失败', err)
      })
    }

    if (triggers.triggerStyleLearning) {
      this.knowledgeGenerator.generateStyleLearning(ctx).catch((err) => {
        logger.error('异步风格学习失败', err)
      })
    }

    if (triggers.triggerChatSummary) {
      this.knowledgeGenerator.generateChatSummary(ctx).catch((err) => {
        logger.error('异步摘要生成失败', err)
      })
    }

    if (triggers.triggerUserProfile) {
      this.knowledgeGenerator.generateUserProfile(ctx).catch((err) => {
        logger.error('异步画像生成失败', err)
      })
    }
  }
}
