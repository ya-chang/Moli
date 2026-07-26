# 拟恋 (nilian) 统一优化方案 v2.0

> **技术来源**: [XiaomiRobotics/Xiaomi-Robotics-U0](https://github.com/XiaomiRobotics/Xiaomi-Robotics-U0)
> **来源论文**: [arXiv:2607.11643](https://arxiv.org/abs/2607.11643)
> **逆向分析**: [Xiaomi-Robotics-U0-Analysis](https://github.com/ya-chang/Xiaomi-Robotics-U0-Analysis)
> **版本**: v2.0 (2026-07-23 更新)
> **本文件用途**: 基于 U0 核心设计思想，为拟恋项目制定系统性优化方案，可直接交给 AI 实现

---

## 目录

- [一、项目概述与技术来源](#一项目概述与技术来源)
- [二、U0 核心思想 → 拟恋映射](#二u0-核心思想--拟恋映射)
- [三、架构层面优化](#三架构层面优化)
  - [3.1 分层配置系统](#31-分层配置系统)
  - [3.2 统一任务接口](#32-统一任务接口)
- [四、对话引擎优化](#四对话引擎优化)
  - [4.1 PersonaCFG — 人设强化引擎](#41-personacfg--人设强化引擎)
  - [4.2 SamplingStrategy — 差异化采样](#42-samplingstrategy--差异化采样)
  - [4.3 QualityChecker — 对话质量自检](#43-qualitychecker--对话质量自检)
- [五、情感系统优化](#五情感系统优化)
  - [5.1 EmotionFSM 增强 — 衰减与传染](#51-emotionfsm-增强--衰减与传染)
  - [5.2 情感状态影响采样](#52-情感状态影响采样)
- [六、记忆系统优化](#六记忆系统优化)
  - [6.1 MemoryGrader — 情感加权评分](#61-memorygrader--情感加权评分)
  - [6.2 MemoryManager — 智能记忆注入](#62-memorymanager--智能记忆注入)
  - [6.3 ProximityMask — 记忆检索](#63-proximitymask--记忆检索)
- [七、人性化优化](#七人性化优化)
  - [7.1 Humanizer — 真人打字模拟](#71-humanizer--真人打字模拟)
  - [7.2 Scheduler — 智能主动消息](#72-scheduler--智能主动消息)
- [八、健壮性优化](#八健壮性优化)
  - [8.1 ModelRouter — 容错重试](#81-modelrouter--容错重试)
  - [8.2 PersonaCFG — 语气一致性检测](#82-personacfg--语气一致性检测)
- [九、执行计划](#九执行计划)
- [十、预期效果](#十预期效果)
- [十一、U0 技术映射总表](#十一u0-技术映射总表)

---

## 一、项目概述与技术来源

### 1.1 技术来源：Xiaomi-Robotics-U0

Xiaomi-Robotics-U0 是小米机器人团队发布的**统一具身合成世界基础模型**：

| 特性 | 说明 |
|------|------|
| 模型规模 | 38B参数，基于EMU3.5初始化 |
| 核心技术 | 统一Token空间 + CFG + 差异化采样 + FlashAR加速 |
| 任务支持 | T2I、X2I、Scene Gen、Transfer、Video Gen |
| 性能 | 单H20 GPU上5.44s/img，比AR eager快82.86倍 |

### 1.2 核心可借鉴技术

| U0技术 | 原始用途 | 拟恋迁移方向 |
|--------|----------|--------------|
| **CFG** | 控制图像和文本的匹配度 | 控制回复和人设的匹配度 |
| **差异化采样** | 文本/图像用不同top_k/temperature | 情感/事实/撩人用不同采样 |
| **cfg_decay** | 多图生成时guidance衰减 | 情感值随时间自然衰减 |
| **分层配置** | base→task→runtime→profile | persona→emotion→memory→sampling |
| **流式生成** | 文本逐字+图像一次 | 回复逐句+情感一次更新 |
| **Proximity Mask** | 2D版causal mask | 记忆检索的距离概念 |
| **token mask** | 视觉token约束 | 对话质量检查 |

---

## 二、U0 核心思想 → 拟恋映射

| U0 核心思想 | U0 原始用途 (源码位置) | 拟恋优化方向 | 实现模块 |
|:---|:---|:---|:---|
| **CFG** | 控制图像和文本的匹配度 (`logits_processor.py`) | 控制回复和人设的匹配度 | PersonaCFG |
| **差异化采样** | 文本/图像用不同 top_k/temperature (`DifferentialTopK`) | 情感/事实/撩人用不同采样 | SamplingStrategy |
| **cfg_decay** | 多图生成时 guidance 衰减 (`cfg_decay`) | 情感值随时间自然衰减 | EmotionFSM |
| **统一Token空间** | 文本+图像共享next-token目标 | 统一人格表示空间 | 长期目标 |
| **分层配置** | base→task→runtime→profile (`compose.py`) | persona→emotion→memory→sampling | ConfigComposer |
| **流式生成** | 文本逐字+图像一次 (`streaming_generate`) | 回复逐句+情感一次更新 | Humanizer |
| **Proximity Mask** | 2D版causal mask (只attend更近位置) | 记忆检索的距离概念 | ProximityMask |
| **token mask** | 视觉token约束 (只允许合法token) | 对话质量检查 | QualityChecker |

---

## 三、架构层面优化

### 3.1 分层配置系统

> **U0来源**: `configs/compose.py` — 4层配置合成

#### 设计思路

U0使用4层配置合成：base → task → runtime → profile，通过`deep_merge`递归合并。

迁移到拟恋：角色配置也分层，支持不同场景不同参数。

#### 新建文件: `src/main/config/ConfigComposer.ts`

```typescript
/**
 * ConfigComposer — 分层配置合成引擎
 * 灵感来源: Xiaomi-Robotics-U0 的 compose.py
 * U0源码: configs/compose.py (compose_dict 函数)
 */

import { deepMerge } from '../utils/deepMerge'

// 基础配置层
interface BaseConfig {
  name: string
  personality: string
  style: 'gentle' | 'playful' | 'serious' | 'tsundere'
  catchphrases: string[]
  bannedWords: string[]
}

// 任务配置层
interface TaskConfig {
  daily_chat: {
    emojiRate: number
    memoryInjection: 'minimal' | 'balanced' | 'detailed'
    responseLength: 'short' | 'medium' | 'long'
  }
  emotional_support: {
    emojiRate: number
    memoryInjection: 'minimal' | 'balanced' | 'detailed'
    responseLength: 'short' | 'medium' | 'long'
  }
  flirty: {
    emojiRate: number
    memoryInjection: 'minimal' | 'balanced' | 'detailed'
    responseLength: 'short' | 'medium' | 'long'
  }
}

// 运行时配置层
interface RuntimeConfig {
  provider: string
  model: string
  temperature: number
  topP: number
  maxTokens: number
  frequencyPenalty: number
  presencePenalty: number
}

// 性能配置层
interface ProfileConfig {
  lite: {
    maxTokens: number
    timeout: number
    batchSize: number
  }
  balanced: {
    maxTokens: number
    timeout: number
    batchSize: number
  }
  performance: {
    maxTokens: number
    timeout: number
    batchSize: number
  }
}

// 完整角色配置
interface CharacterConfig {
  base: BaseConfig
  task: TaskConfig
  runtime: RuntimeConfig
  profile: ProfileConfig
}

// 合成后的配置
interface ComposedConfig extends BaseConfig {
  taskConfig: TaskConfig[keyof TaskConfig]
  runtime: RuntimeConfig
  profile: ProfileConfig[keyof ProfileConfig]
}

export class ConfigComposer {
  private static instance: ConfigComposer
  private configs = new Map<string, CharacterConfig>()

  static getInstance(): ConfigComposer {
    if (!ConfigComposer.instance) {
      ConfigComposer.instance = new ConfigComposer()
    }
    return ConfigComposer.instance
  }

  /**
   * 合成配置
   * U0对应: compose.py 的 compose_dict 函数
   * U0: base_config → task_config → runtime_config → profile_config → overrides
   * 这里: base → task → runtime → profile → 运行时覆盖
   */
  async compose(
    characterId: string,
    options: {
      taskType?: keyof TaskConfig
      profileName?: keyof ProfileConfig
      overrides?: Partial<ComposedConfig>
    } = {}
  ): Promise<ComposedConfig> {
    const {
      taskType = 'daily_chat',
      profileName = 'balanced',
      overrides = {}
    } = options

    // 加载基础配置
    const config = await this.loadConfig(characterId)
    if (!config) {
      throw new Error(`Config not found for character: ${characterId}`)
    }

    // 分层合成
    let composed: ComposedConfig = {
      ...config.base,
      taskConfig: config.task[taskType],
      runtime: { ...config.runtime },
      profile: config.profile[profileName]
    }

    // 应用运行时覆盖
    if (overrides) {
      composed = deepMerge(composed, overrides) as ComposedConfig
    }

    return composed
  }

  /**
   * 加载角色配置
   */
  private async loadConfig(characterId: string): Promise<CharacterConfig | null> {
    if (this.configs.has(characterId)) {
      return this.configs.get(characterId)!
    }

    // 从文件系统加载
    const config = await this.loadFromFS(characterId)
    if (config) {
      this.configs.set(characterId, config)
    }
    return config
  }

  private async loadFromFS(characterId: string): Promise<CharacterConfig | null> {
    // 实际实现：读取 data/characters/{characterId}/config.yaml
    // 这里返回默认配置示例
    return {
      base: {
        name: '小雅',
        personality: '温柔体贴的虚拟女友',
        style: 'gentle',
        catchphrases: ['嗯嗯', '好的呀', '我知道了'],
        bannedWords: ['滚', '烦', '闭嘴']
      },
      task: {
        daily_chat: {
          emojiRate: 0.3,
          memoryInjection: 'balanced',
          responseLength: 'medium'
        },
        emotional_support: {
          emojiRate: 0.5,
          memoryInjection: 'detailed',
          responseLength: 'long'
        },
        flirty: {
          emojiRate: 0.4,
          memoryInjection: 'minimal',
          responseLength: 'short'
        }
      },
      runtime: {
        provider: 'mimo',
        model: 'MiMo-V2-Flash',
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 1024,
        frequencyPenalty: 1.2,
        presencePenalty: 1.0
      },
      profile: {
        lite: { maxTokens: 512, timeout: 5000, batchSize: 1 },
        balanced: { maxTokens: 1024, timeout: 10000, batchSize: 2 },
        performance: { maxTokens: 2048, timeout: 15000, batchSize: 3 }
      }
    }
  }

  /**
   * Dry-run预览配置
   * U0对应: --dry-run 参数
   */
  async dryRun(characterId: string, options: any = {}): Promise<void> {
    const config = await this.compose(characterId, options)
    
    console.log('=== 角色配置预览 ===')
    console.log('基础信息:', JSON.stringify(config.base, null, 2))
    console.log('任务配置:', JSON.stringify(config.taskConfig, null, 2))
    console.log('运行时:', JSON.stringify(config.runtime, null, 2))
    console.log('性能配置:', JSON.stringify(config.profile, null, 2))
  }
}

// 深度合并工具函数
function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
```

---

### 3.2 统一任务接口

> **U0来源**: `scripts/inference.py` — 统一CLI入口

#### 设计思路

U0所有任务使用同一个入口点：`python scripts/inference.py --task <t2i|x2i|scene-gen|transfer>`

迁移到拟恋：统一任务路由器，所有模块通过同一个接口调用。

#### 新建文件: `src/main/router/UnifiedTaskRouter.ts`

```typescript
/**
 * UnifiedTaskRouter — 统一任务路由器
 * 灵感来源: Xiaomi-Robotics-U0 的统一 CLI 入口
 * U0源码: scripts/inference.py
 */

export type TaskType = 
  | 'chat'          // 对话
  | 'vision'        // 图像理解
  | 'memory'        // 记忆提取
  | 'emoji'         // 表情选择
  | 'tts'           // 语音合成
  | 'summarize'     // 摘要生成
  | 'analyze'       // 情感分析

export interface TaskInput {
  [key: string]: any
}

export interface TaskOutput {
  success: boolean
  data: any
  error?: string
  metadata?: {
    model: string
    tokens: number
    latency: number
  }
}

export interface TaskHandler {
  execute(input: TaskInput): Promise<TaskOutput>
}

export class UnifiedTaskRouter {
  private handlers = new Map<TaskType, TaskHandler>()
  private static instance: UnifiedTaskRouter

  static getInstance(): UnifiedTaskRouter {
    if (!UnifiedTaskRouter.instance) {
      UnifiedTaskRouter.instance = new UnifiedTaskRouter()
    }
    return UnifiedTaskRouter.instance
  }

  /**
   * 注册任务处理器
   */
  register(taskType: TaskType, handler: TaskHandler): void {
    this.handlers.set(taskType, handler)
  }

  /**
   * 执行任务
   * U0对应: inference.py 根据 --task 参数选择不同处理逻辑
   */
  async execute<T>(taskType: TaskType, input: TaskInput): Promise<TaskOutput> {
    const handler = this.handlers.get(taskType)
    if (!handler) {
      return {
        success: false,
        data: null,
        error: `No handler registered for task: ${taskType}`
      }
    }

    const startTime = Date.now()
    try {
      const result = await handler.execute(input)
      result.metadata = {
        ...result.metadata,
        latency: Date.now() - startTime
      }
      return result
    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: error.message,
        metadata: {
          model: 'unknown',
          tokens: 0,
          latency: Date.now() - startTime
        }
      }
    }
  }

  /**
   * 批量执行任务
   * U0对应: vLLM的batch processing
   */
  async executeBatch(tasks: { type: TaskType; input: TaskInput }[]): Promise<TaskOutput[]> {
    return Promise.all(
      tasks.map(task => this.execute(task.type, task.input))
    )
  }
}

// 使用示例
const router = UnifiedTaskRouter.getInstance()

// 注册处理器
router.register('chat', {
  execute: async (input) => {
    // 调用 ChatEngine
    const reply = await chatEngine.sendMessage(input.characterId, input.message)
    return { success: true, data: reply }
  }
})

router.register('memory', {
  execute: async (input) => {
    // 调用 MemoryManager
    const memories = memoryManager.getContext(input.query)
    return { success: true, data: memories }
  }
})

// 执行任务
const result = await router.execute('chat', {
  characterId: 'xiaoya',
  message: '今天过得怎么样？'
})
```

---

## 四、对话引擎优化

### 4.1 PersonaCFG — 人设强化引擎

> **U0来源**: `xr_u0_ar/logits_processor.py` — CFG 双路 logits 融合
> **U0原理**: conditioned(有条件) + unconditioned(无条件) 两路推理，用 `cfg_scale * (cond - uncond) + uncond` 强化条件控制
> **迁移方案**: 动态 system prompt 强度 + 采样参数联动，模拟 CFG 效果（不需要双路推理）

#### 设计思路

U0的CFG用guidance_scale控制"条件对生成的控制力"。值越高，生成结果越严格匹配条件。

迁移到虚拟伴侣：
- `guidance_scale` 高 → 人设约束强（刚认识，严格遵守角色）
- `guidance_scale` 低 → 人设约束弱（很亲密了，更自然）
- 随着关系进展，guidance_scale自然衰减（模拟U0的cfg_decay）

#### 新建文件: `src/main/engine/PersonaCFG.ts`

```typescript
/**
 * PersonaCFG — 人设强化引擎
 * 灵感来源: Xiaomi-Robotics-U0 的 CFG 机制
 * U0 源码: xr_u0_ar/logits_processor.py (UnbatchedClassifierFreeGuidanceLogitsForVisualTokenProcessor)
 */

export interface CFGConfig {
  strangerStrength: number   // 陌生人阶段强度 (默认 4.0)
  friendStrength: number     // 朋友阶段强度 (默认 3.0)
  loverStrength: number      // 恋人阶段强度 (默认 2.0)
  decayPerTurn: number       // 每轮衰减 (默认 0.003)
  minStrength: number        // 最低强度 (默认 1.5)
  highThreshold: number      // 高约束阈值 (默认 3.0)
  midThreshold: number       // 中约束阈值 (默认 2.0)
}

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

export class PersonaCFG {
  private config: CFGConfig
  private interactionCount = 0
  private persona: Persona

  constructor(persona: Persona, config: Partial<CFGConfig> = {}) {
    this.persona = persona
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 计算当前人设强度 (模拟 U0 的 guidance_scale)
   * U0: guidance_scale 控制 CFG 强度
   * 这里: 关系阶段 + 对话轮数 + 情感状态 → 人设强度
   */
  getStrength(
    stage: 'stranger' | 'friend' | 'lover',
    emotion?: { trust: number; intimacy: number }
  ): number {
    const base = { stranger: 4.0, friend: 3.0, lover: 2.0 }[stage]
    const decay = this.interactionCount * this.config.decayPerTurn
    let modifier = 0
    if (emotion) {
      modifier = ((emotion.trust - 50) / 100 + (emotion.intimacy - 50) / 100) * 0.3
    }
    return Math.max(this.config.minStrength, base - decay - modifier)
  }

  /**
   * 构建约束性 system prompt
   * U0: 高 guidance_scale → 条件严格控制生成
   * 这里: 高强度 → 详细人设约束; 低强度 → 轻约束更自然
   */
  buildPrompt(
    emotionSummary: string,
    strength: number
  ): string {
    const { name, personality, catchphrases, bannedWords } = this.persona
    
    if (strength > this.config.highThreshold) {
      return [
        `【严格人设约束】你是「${name}」。${personality}`,
        catchphrases.length ? `口头禅：${catchphrases.join('、')}` : '',
        bannedWords.length ? `禁止说：${bannedWords.join('、')}` : '',
        `情绪：${emotionSummary}`,
        `必须保持人设，不能出戏，不能暴露是AI。`,
      ].filter(Boolean).join('\n')
    }
    if (strength > this.config.midThreshold) {
      return `你是「${name}」。${personality}\n情绪：${emotionSummary}\n保持风格，自然聊天。`
    }
    return `你是「${name}」。${personality} ${emotionSummary} 自然聊天就好。`
  }

  /**
   * 根据强度获取采样参数覆盖
   * U0: 根据 guidance_scale 调整采样参数
   * 这里: 高约束→低temperature; 低约束→高temperature
   */
  getSamplingOverrides(strength: number) {
    if (strength > this.config.highThreshold) {
      return { temperature: 0.45, topP: 0.85, frequencyPenalty: 1.6, presencePenalty: 1.2 }
    }
    if (strength > this.config.midThreshold) {
      return { temperature: 0.65, topP: 0.9, frequencyPenalty: 1.3, presencePenalty: 1.0 }
    }
    return { temperature: 0.85, topP: 0.95, frequencyPenalty: 1.0, presencePenalty: 0.8 }
  }

  /**
   * 检测人设一致性（含语气检测）
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

  tick() { this.interactionCount++ }
}
```

#### 接入方式

修改 `src/main/engine/ChatEngine.ts`:

```typescript
// 新增属性
private personaCFGs = new Map<string, PersonaCFG>()

// 在 sendMessage 中
private async generateReply(characterId: string, userMessage: string): Promise<string> {
  // 获取或创建PersonaCFG
  const config = await characterManager.getConfig(characterId)
  const persona: Persona = {
    name: config.name,
    personality: config.personality,
    style: config.style,
    catchphrases: config.catchphrases,
    bannedWords: config.bannedWords
  }
  
  const cfg = this.personaCFGs.get(characterId) ?? new PersonaCFG(persona)
  this.personaCFGs.set(characterId, cfg)
  
  // 计算人设强度
  const relationshipStage = this.getRelationshipStage(characterId)
  const emotion = this.emotionFSM.getState(characterId)
  const strength = cfg.getStrength(relationshipStage, { 
    trust: emotion.trust, 
    intimacy: emotion.intimacy 
  })
  
  // 构建prompt
  const emotionSummary = this.getEmotionSummary(emotion)
  const systemPrompt = cfg.buildPrompt(emotionSummary, strength)
  
  // 获取采样参数
  const samplingOverrides = cfg.getSamplingOverrides(strength)
  
  // 调用模型
  const reply = await this.modelRouter.chat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    ...samplingOverrides
  })
  
  // 增加交互计数
  cfg.tick()
  
  // 检查人设一致性
  const check = cfg.checkConsistency(reply.content)
  if (!check.ok) {
    logger.warn(`人设偏离: ${check.violations}`)
  }
  
  return reply.content
}
```

---

### 4.2 SamplingStrategy — 差异化采样

> **U0来源**: `xr_u0_ar/logits_processor.py` — DifferentialTopK 子类
> **U0原理**: 文本 token 用 text_top_k/text_temperature，图像 token 用 image_top_k/image_temperature
> **迁移方案**: 情感/事实/撩人/安慰/愤怒消息使用不同采样参数

#### 设计思路

U0用两套采样参数分别处理文本和图像token。迁移到对话：用多套采样参数处理不同类型的消息。

#### 新建文件: `src/main/engine/SamplingStrategy.ts`

```typescript
/**
 * SamplingStrategy — 差异化采样策略
 * 灵感来源: Xiaomi-Robotics-U0 的 DifferentialTopK
 * U0 源码: xr_u0_ar/logits_processor.py
 */

export type MessageType = 'emotional' | 'factual' | 'flirty' | 'comfort' | 'angry' | 'playful' | 'casual'

interface SamplingParams {
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
}

// U0 对应: 不同 token 类型用不同采样参数
// 文本: top_k=1024, temperature=0.7 (高准确性)
// 图像: top_k=5120, temperature=1.0 (高多样性)
const STRATEGIES: Record<MessageType, SamplingParams> = {
  emotional: { temperature: 1.0, topP: 0.95, frequencyPenalty: 1.3, presencePenalty: 1.2 },
  factual:   { temperature: 0.3, topP: 0.8,  frequencyPenalty: 1.0, presencePenalty: 0.8 },
  flirty:    { temperature: 1.2, topP: 0.98, frequencyPenalty: 1.5, presencePenalty: 1.3 },
  comfort:   { temperature: 0.8, topP: 0.9,  frequencyPenalty: 1.2, presencePenalty: 1.0 },
  angry:     { temperature: 0.5, topP: 0.85, frequencyPenalty: 1.0, presencePenalty: 0.9 },
  playful:   { temperature: 1.1, topP: 0.95, frequencyPenalty: 1.4, presencePenalty: 1.2 },
  casual:    { temperature: 0.7, topP: 0.9,  frequencyPenalty: 1.2, presencePenalty: 1.0 },
}

export class SamplingStrategy {
  /**
   * 消息分类
   * U0 对应: logits_processor 中判断 token 类型 (文本 vs 视觉)
   * U0 方式: token_id < BOV → 文本, >= BOV → 视觉
   * 迁移方式: 关键词 + 情感状态 → 消息类型
   */
  classify(userMessage: string, emotion?: {
    sadness?: number
    anger?: number
    happiness?: number
  }): MessageType {
    // 情感状态优先
    if (emotion?.sadness !== undefined && emotion.sadness > 60) return 'comfort'
    if (emotion?.anger !== undefined && emotion.anger > 50) return 'angry'
    
    // 关键词匹配
    if (/亲|抱|宝贝|亲爱的|么么|mua|想你|喜欢你|爱你/.test(userMessage)) return 'flirty'
    if (/开心|难过|伤心|感动|哭|幸福|委屈|紧张|兴奋/.test(userMessage)) return 'emotional'
    if (/几点|什么|哪里|怎么|为什么|多少|叫什么/.test(userMessage)) return 'factual'
    if (/哈哈|嘿嘿|嘻嘻|你猜|才不是|哼|切/.test(userMessage)) return 'playful'
    
    return 'casual'
  }

  /**
   * 获取采样参数
   */
  getParams(type: MessageType): SamplingParams {
    return { ...STRATEGIES[type] }
  }

  /**
   * 融合 CFG 覆盖和差异化采样
   * 使用加权融合，根据消息类型决定权重
   */
  merge(
    strategyParams: SamplingParams,
    cfgOverrides: Partial<SamplingParams>,
    messageType: MessageType
  ): SamplingParams {
    // 撩人/情感类消息，采样参数更重要（多样性优先）
    // 事实类消息，CFG约束更重要（准确性优先）
    const strategyWeight = ['flirty', 'emotional', 'playful'].includes(messageType) ? 0.7 : 0.4
    const cfgWeight = 1 - strategyWeight
    
    return {
      temperature: (strategyParams.temperature * strategyWeight) + ((cfgOverrides.temperature ?? strategyParams.temperature) * cfgWeight),
      topP: (strategyParams.topP * strategyWeight) + ((cfgOverrides.topP ?? strategyParams.topP) * cfgWeight),
      frequencyPenalty: Math.max(strategyParams.frequencyPenalty, cfgOverrides.frequencyPenalty ?? 0),
      presencePenalty: Math.max(strategyParams.presencePenalty, cfgOverrides.presencePenalty ?? 0),
    }
  }
}
```

#### 接入方式

修改 `src/main/engine/ModelRouter.ts`:

```typescript
// ChatRequest 新增可选字段
export interface ChatRequest {
  // ... 现有字段
  samplingOverrides?: Partial<SamplingParams>
}

// chatStream 中使用
async chatStream(request: ChatRequest): AsyncGenerator<string> {
  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
    temperature: request.samplingOverrides?.temperature ?? request.temperature ?? 0.7,
    top_p: request.samplingOverrides?.topP ?? request.topP ?? 0.9,
    frequency_penalty: request.samplingOverrides?.frequencyPenalty ?? request.frequencyPenalty ?? 1.2,
    presence_penalty: request.samplingOverrides?.presencePenalty ?? request.presencePenalty ?? 1.0,
    max_tokens: request.maxTokens ?? 1024,
  }
  // ... 其余逻辑
}
```

修改 `src/main/engine/ChatEngine.ts`:

```typescript
private async generateReply(characterId: string, userMessage: string): Promise<string> {
  // ... PersonaCFG 逻辑
  
  const strategy = new SamplingStrategy()
  const messageType = strategy.classify(userMessage, emotionalState)
  let samplingParams = strategy.getParams(messageType)
  
  // 与CFG参数融合
  const cfgOverrides = cfg.getSamplingOverrides(strength)
  samplingParams = strategy.merge(samplingParams, cfgOverrides, messageType)
  
  logger.info(`消息类型: ${messageType}, temp: ${samplingParams.temperature}`)
  
  // 调用模型
  const reply = await this.modelRouter.chat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    samplingOverrides: samplingParams
  })
  
  return reply.content
}
```

---

### 4.3 QualityChecker — 对话质量自检

> **U0来源**: `xr_u0_ar/logits_processor.py` — 视觉 token 约束 (只允许合法 token)
> **U0原理**: 通过 token 级别约束确保输出合法性
> **迁移**: 通过回复级别检查确保对话质量

#### 新建文件: `src/main/engine/QualityChecker.ts`

```typescript
/**
 * QualityChecker — 对话质量自检
 * 灵感来源: U0 的视觉 token 约束机制
 * U0 源码: logits_processor.py (in_image_logits_processor 中的 token mask)
 *
 * U0: 通过 mask 确保只生成合法的视觉 token
 * 这里: 通过检查确保回复质量合格
 */

export interface QualityCheckResult {
  passed: boolean
  issues: string[]
  severity: 'ok' | 'warn' | 'fail'
}

export class QualityChecker {
  /**
   * 全面质量检查
   */
  check(reply: string, context: {
    recentMessages: string[]     // 最近的回复 (检测重复)
    persona: {
      style: string
      catchphrases: string[]
    }
    userMessage: string          // 用户消息 (检测相关性)
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
    if (!this.isToneConsistent(reply, context.persona.style)) {
      issues.push('语气与人设不一致')
    }

    const severity = issues.length === 0 ? 'ok' : issues.length <= 1 ? 'warn' : 'fail'
    return { passed: issues.length === 0, issues, severity }
  }

  /**
   * 重复检测 - 使用编辑距离算法
   */
  private isRepetitive(reply: string, recent: string[]): boolean {
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
   */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0
    
    // 限制比较长度，避免长文本计算过慢
    const maxLen = 100
    const s1 = a.slice(0, maxLen)
    const s2 = b.slice(0, maxLen)
    
    const matrix: number[][] = []
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j
    }
    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        )
      }
    }
    
    const distance = matrix[s1.length][s2.length]
    return 1 - distance / Math.max(s1.length, s2.length)
  }

  /**
   * 人设偏离检测
   */
  private isOutOfCharacter(reply: string): boolean {
    const oocPatterns = [
      /作为(一个)?AI/i,
      /我(是|作为)(语言模型|助手|程序)/i,
      /OpenAI|ChatGPT|Claude|DeepSeek/i,
      /我(没有|无法)(情感|感受|情绪)/i,
    ]
    return oocPatterns.some(p => p.test(reply))
  }

  /**
   * 语气一致性检测
   */
  private isToneConsistent(reply: string, style: string): boolean {
    if (style === 'gentle' && /滚|烦|闭嘴|切|笨蛋/.test(reply)) return false
    if (style === 'playful' && /严肃|认真|正经/.test(reply)) return false
    if (style === 'tsundere' && /喜欢你|爱你|想你/.test(reply)) return false
    return true
  }

  private isEmoji(text: string): boolean {
    return /^[\p{Emoji}\s]+$/u.test(text)
  }
}
```

#### 接入方式

```typescript
// ChatEngine.sendMessage 中，获取 AI 回复后
const checker = new QualityChecker()
const quality = checker.check(reply, {
  recentMessages: lastFiveReplies,
  persona: {
    style: config.style,
    catchphrases: config.catchphrases
  },
  userMessage: userMessage,
})

if (quality.severity === 'fail') {
  // 重新生成 (注入修正指令)
  const fixPrompt = `你刚才的回复有问题: ${quality.issues.join('、')}。请重新回复，避免以上问题。`
  reply = await regenerateWithFix(fixPrompt)
} else if (quality.severity === 'warn') {
  logger.warn(`回复质量警告: ${quality.issues}`)
}
```

---

## 五、情感系统优化

### 5.1 EmotionFSM 增强 — 衰减与传染

> **U0来源**: `xr_u0_ar/logits_processor.py` — CFG decay (linear/cosine)
> **U0原理**: 多图生成时 guidance_scale 线性/余弦衰减，避免后面的图过度受约束
> **迁移**: 情感值随时间自然衰减，长时间不互动思念值上升

#### 修改文件: `src/main/emotion/EmotionFSM.ts`

在现有 processMessage 方法中增加以下逻辑：

#### 5.1.1 情感衰减

```typescript
/**
 * U0 对应: logits_processor.py current_guidance_scale() 的 linear decay
 * U0: guidance = guidance + (cfg_min - guidance) * progress
 * 这里: emotion = baseline + (emotion - baseline) * decayFactor
 */
private applyEmotionDecay(hoursSinceLastInteraction: number): void {
  const decayRate = 0.01 // 每小时衰减 1%
  const factor = Math.max(0, 1 - hoursSinceLastInteraction * decayRate)

  // 积极情感衰减到基线
  this.state.happiness = this.decay(this.state.happiness, 70, factor)
  this.state.affection = this.decay(this.state.affection, 50, factor)
  this.state.intimacy = this.decay(this.state.intimacy, 30, factor)
  // 消极情感衰减
  this.state.anger = this.decay(this.state.anger, 0, factor)
  this.state.sadness = this.decay(this.state.sadness, 10, factor)
  // 思念上升 (虚拟伴侣核心体验)
  if (hoursSinceLastInteraction > 2) {
    this.state.missLevel = Math.min(100, this.state.missLevel + hoursSinceLastInteraction * 2)
  }
}

private decay(current: number, baseline: number, factor: number): number {
  return baseline + (current - baseline) * factor
}
```

#### 5.1.2 情感传染（考虑关系阶段）

```typescript
/**
 * 思想来源: U0 统一 token 空间中模态间的相互影响
 * 用户情感影响角色情感 (像真人一样)
 * 根据关系阶段调整传染强度
 */
private applyContagion(
  userEmotion: string,
  relationshipStage: 'stranger' | 'friend' | 'lover'
): void {
  // 亲密关系更容易被传染
  const contagionFactor = { stranger: 0.05, friend: 0.1, lover: 0.2 }[relationshipStage]
  
  switch (userEmotion) {
    case 'happy': case 'excited':
      this.state.happiness = Math.min(100, this.state.happiness + 10 * contagionFactor)
      break
    case 'sad': case 'crying':
      this.state.sadness = Math.min(100, this.state.sadness + 8 * contagionFactor)
      this.state.affection = Math.min(100, this.state.affection + 3 * contagionFactor) // 关心欲上升
      break
    case 'angry':
      this.state.patience = Math.min(100, this.state.patience + 5 * contagionFactor) // 角色耐心上升
      break
  }
}
```

#### 5.1.3 和好路径细化

```typescript
/**
 * 不同和好方式效果不同
 */
reconcile(action: 'apologize' | 'coax' | 'gift' | 'ignore'): void {
  const effects = {
    apologize: { anger: -30, patience: 10, trust: 5 },
    coax:      { anger: -15, happiness: 10, affection: 5 },
    gift:      { anger: -40, happiness: 20, affection: 10 },
    ignore:    { anger: -5, sadness: 15, missLevel: 20 },
  }
  const e = effects[action]
  if (e.anger) this.state.anger = Math.max(0, Math.min(100, this.state.anger + e.anger))
  if (e.happiness) this.state.happiness = Math.min(100, this.state.happiness + e.happiness)
  if (e.patience) this.state.patience = Math.min(100, this.state.patience + e.patience)
  if (e.trust) this.state.trust = Math.min(100, this.state.trust + e.trust)
  if (e.affection) this.state.affection = Math.min(100, this.state.affection + e.affection)
  if (e.sadness) this.state.sadness = Math.min(100, this.state.sadness + e.sadness)
  if (e.missLevel) this.state.missLevel = Math.min(100, this.state.missLevel + e.missLevel)

  if (this.state.anger < 20) {
    this.reconciliation.isFighting = false
    this.reconciliation.lastReconciliationTime = new Date().toISOString()
  }
}
```

---

### 5.2 情感状态影响采样

#### 修改文件: `src/main/engine/ChatEngine.ts`

```typescript
/**
 * 根据情感状态获取采样参数覆盖
 * 情感状态应该影响回复风格
 */
private getEmotionBasedSamplingOverrides(emotion: EmotionalState): Partial<SamplingParams> | null {
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
```

---

## 六、记忆系统优化

### 6.1 MemoryGrader — 情感加权评分

> **U0来源**: `xr_u0_ar/logits_processor.py` — 对不同 token 类型的差异化权重处理
> **U0原理**: 视觉 token 和文本 token 在 CFG 中有不同权重
> **迁移**: 不同类型的记忆有不同的保留权重

#### 修改文件: `src/main/memory/MemoryGrader.ts`

```typescript
/**
 * U0 对应: logits_processor 中对视觉/文本 token 的差异化处理
 * 迁移: 对不同类型记忆用不同权重评分
 */
grade(content: string, context?: {
  userEmotion?: string
  isRecurring?: boolean      // 是否反复提到
  timeSinceLastMention?: number  // 距离上次提到的小时数
}): { grade: string; importance: number } {
  let importance = 0.5 // 基础分

  // 1. 情感强度加权 (U0: visual token 获得更高 CFG 权重)
  const emotionalKeywords = {
    high: ['爱', '喜欢', '讨厌', '恨', '害怕', '崩溃', '哭', '笑死', '感动'],
    mid: ['开心', '难过', '生气', '紧张', '期待', '失望', '委屈'],
    low: ['还行', '一般', '无所谓', '还好'],
  }
  if (emotionalKeywords.high.some(k => content.includes(k))) importance += 0.3
  else if (emotionalKeywords.mid.some(k => content.includes(k))) importance += 0.15
  else if (emotionalKeywords.low.some(k => content.includes(k))) importance -= 0.1

  // 2. 用户情感状态加权
  if (context?.userEmotion === 'crying' || context?.userEmotion === 'angry') importance += 0.2
  if (context?.userEmotion === 'excited') importance += 0.1

  // 3. 重复强化 (反复提到的事更重要)
  if (context?.isRecurring) importance += 0.15

  // 4. 个人信息关键词
  const personalKeywords = ['生日', '名字', '家人', '工作', '学校', '喜欢', '讨厌', '习惯']
  if (personalKeywords.some(k => content.includes(k))) importance += 0.2

  // 5. 时间衰减（最近的记忆更重要）
  if (context?.timeSinceLastMention !== undefined) {
    const timeFactor = Math.exp(-context.timeSinceLastMention / 168) // 一周衰减
    importance *= (0.5 + 0.5 * timeFactor)
  }

  importance = Math.max(0, Math.min(1, importance))

  const grade = importance > 0.7 ? 'critical' : importance > 0.4 ? 'important' : 'normal'
  return { grade, importance }
}
```

---

### 6.2 MemoryManager — 智能记忆注入

> **U0来源**: `configs/compose.py` — 分层配置合成 (base → task → runtime → profile)
> **U0原理**: 多层配置按优先级合并，后者覆盖前者
> **迁移**: 记忆注入按优先级排序，控制总 token 数

#### 修改文件: `src/main/memory/MemoryManager.ts`

```typescript
/**
 * U0 对应: compose.py 的分层合并策略
 * U0: base → task → runtime → profile 逐层合并
 * 这里: 高优先级记忆 → 相关记忆 → 摘要 → 限制总 token
 */
getContext(query: string, maxTokens: number = 300): MemoryContext {
  const recent = this.shortTerm.getMessages()

  // 向量检索相关记忆
  const relevant = this.longTerm.search(query, 10)
    .sort((a, b) => b.importance - a.importance) // 按重要性排序
    .slice(0, 5)

  // 摘要只取最近 1-2 条
  const summaries = this.summaries.slice(-2)

  // token 预算分配 (模拟 U0 的分层策略)
  // 高优先级: 情感相关的记忆
  // 中优先级: 个人信息
  // 低优先级: 一般对话
  const emotionMemories = relevant.filter(m => m.importance > 0.6)
  const personalMemories = relevant.filter(m => m.importance > 0.3 && m.importance <= 0.6)
  const otherMemories = relevant.filter(m => m.importance <= 0.3)

  // 按优先级填充 token 预算
  const selected: typeof relevant = []
  let tokenCount = 0
  for (const mem of [...emotionMemories, ...personalMemories, ...otherMemories]) {
    const memTokens = this.estimateTokens(mem.content)
    if (tokenCount + memTokens > maxTokens) break
    selected.push(mem)
    tokenCount += memTokens
  }

  return { recentMessages: recent, relevantMemories: selected, summaries }
}

/**
 * 精确的token估算
 * 中文: 约1.5 token/字
 * 英文: 约1.3 token/词
 */
private estimateTokens(text: string): number {
  let tokens = 0
  
  // 中文字符
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || []
  tokens += chineseChars.length * 1.5
  
  // 英文单词
  const englishWords = text.match(/[a-zA-Z]+/g) || []
  tokens += englishWords.length * 1.3
  
  // 数字
  const numbers = text.match(/\d+/g) || []
  tokens += numbers.length * 0.5
  
  // 标点和空格
  const others = text.match(/[^\u4e00-\u9fa5a-zA-Z\d]/g) || []
  tokens += others.length * 0.3
  
  return Math.ceil(tokens)
}
```

---

### 6.3 ProximityMask — 记忆检索

> **U0来源**: `xr_u0_flashar/model.py` — Proximity Attention Mask
> **U0原理**: 2D版causal mask，每个位置只attend Manhattan距离更小的已生成位置
> **迁移**: 记忆检索时考虑时间距离和语义距离

#### 新建文件: `src/main/memory/ProximityMemoryRetriever.ts`

```typescript
/**
 * ProximityMemoryRetriever — 基于距离的记忆检索
 * 灵感来源: Xiaomi-Robotics-U0 的 Proximity Attention Mask
 * U0源码: xr_u0_flashar/model.py (_build_proximity_allow)
 *
 * U0: 每个位置只attend Manhattan距离更小的已生成位置
 * 这里: 记忆检索时，考虑时间距离和语义距离
 */

interface Memory {
  id: string
  content: string
  embedding?: number[]
  createdAt: string
  importance: number
}

interface RecentMessage {
  content: string
  timestamp: string
}

export class ProximityMemoryRetriever {
  private longTermMemory: any // LongTermMemory实例
  private embeddingService: any // EmbeddingService实例

  constructor(longTermMemory: any, embeddingService: any) {
    this.longTermMemory = longTermMemory
    this.embeddingService = embeddingService
  }

  /**
   * 基于距离的记忆检索
   * score = semanticScore * 0.5 + timeScore * 0.3 + contextScore * 0.2
   */
  async search(
    query: string,
    recentContext: RecentMessage[],
    limit: number = 10
  ): Promise<Memory[]> {
    const allMemories = await this.longTermMemory.getAll()
    
    const scored = await Promise.all(
      allMemories.map(async (memory: Memory) => ({
        memory,
        score: await this.calculateProximityScore(memory, query, recentContext)
      }))
    )
    
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.memory)
  }

  /**
   * 计算距离分数
   */
  private async calculateProximityScore(
    memory: Memory,
    query: string,
    recentContext: RecentMessage[]
  ): Promise<number> {
    // 1. 语义距离（用embedding相似度）
    const semanticScore = await this.embeddingSimilarity(memory, query)
    
    // 2. 时间距离（最近的记忆权重更高）
    const hoursSinceCreated = (Date.now() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60)
    const timeScore = Math.exp(-hoursSinceCreated / 168) // 一周衰减
    
    // 3. 上下文距离（和最近对话相关的记忆权重更高）
    const contextScore = this.contextRelevance(memory, recentContext)
    
    // 加权融合
    return semanticScore * 0.5 + timeScore * 0.3 + contextScore * 0.2
  }

  /**
   * 计算embedding相似度
   */
  private async embeddingSimilarity(memory: Memory, query: string): Promise<number> {
    if (!memory.embedding) {
      // 如果没有预计算的embedding，实时计算
      memory.embedding = await this.embeddingService.embed(memory.content)
    }
    const queryEmbedding = await this.embeddingService.embed(query)
    
    // 余弦相似度
    return this.cosineSimilarity(memory.embedding, queryEmbedding)
  }

  /**
   * 余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /**
   * 计算上下文相关度
   */
  private contextRelevance(memory: Memory, recentContext: RecentMessage[]): number {
    if (recentContext.length === 0) return 0.5
    
    // 检查记忆内容是否和最近对话相关
    const memoryWords = new Set(memory.content.split(''))
    let maxOverlap = 0
    
    for (const msg of recentContext) {
      const msgWords = new Set(msg.content.split(''))
      const overlap = [...memoryWords].filter(w => msgWords.has(w)).length
      const overlapRatio = overlap / Math.max(memoryWords.size, msgWords.size)
      maxOverlap = Math.max(maxOverlap, overlapRatio)
    }
    
    return maxOverlap
  }
}
```

---

## 七、人性化优化

### 7.1 Humanizer — 真人打字模拟

> **U0来源**: `xr_u0_ar/generation.py` — streaming_generate 流式输出
> **U0原理**: 文本逐字输出 + 图像一次输出的混合流式模式
> **迁移**: 模拟真人打字节奏，重要消息慢发，简单消息快发

#### 修改文件: `src/main/engine/Humanizer.ts`

#### 7.1.1 打字节奏模拟

```typescript
/**
 * U0 对应: generation.py streaming_generate 的流式输出控制
 * U0: 文本逐字 yield，图像一次性 yield
 * 这里: 根据消息类型和长度控制发送节奏
 */
calculateTypingDelay(message: string, messageType: string): number {
  const baseDelay = message.length * 50 // 每个字 50ms 基础延迟

  const multiplier: Record<string, number> = {
    emotional: 1.5,  // 情感消息打字慢（在斟酌措辞）
    flirty: 1.3,     // 撩人消息稍慢
    factual: 0.7,    // 事实回答快
    angry: 0.5,      // 生气时打字快（冲动）
    playful: 1.1,    // 俏皮消息稍快
    comfort: 1.2,    // 安慰消息稍慢（温柔）
    casual: 1.0,     // 正常速度
  }

  const delay = baseDelay * (multiplier[messageType] ?? 1.0)
  // 加随机抖动 (±30%)
  const jitter = 0.7 + Math.random() * 0.6
  return Math.min(5000, Math.max(500, delay * jitter)) // 限制在 0.5-5 秒
}
```

#### 7.1.2 消息拆分

```typescript
/**
 * 真人微信聊天会把一段话拆成 2-3 条发
 */
splitMessage(message: string): string[] {
  // 如果很短，不拆
  if (message.length < 15) return [message]

  // 按句号/感叹号/问号拆分
  const sentences = message.split(/(?<=[。！？~])/g).filter(s => s.trim())
  if (sentences.length <= 1) return [message]

  // 每 1-2 句合并为一条
  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += 2) {
    chunks.push(sentences.slice(i, i + 2).join(''))
  }
  return chunks
}
```

#### 7.1.3 偶尔的真人行为

```typescript
/**
 * 模拟真人偶尔的"不完美"行为
 */
shouldDoHumanAction(): { action: 'normal' | 'emoji_only' | 'long_pause' | null } {
  const rand = Math.random()
  if (rand < 0.03) return { action: 'emoji_only' }    // 3% 概率只回 emoji
  if (rand < 0.05) return { action: 'long_pause' }     // 2% 概率"已读不回"一会
  return { action: 'normal' }
}
```

---

### 7.2 Scheduler — 智能主动消息

> **U0来源**: `xr_u0_ar/logits_processor.py` — CFG decay 和多图生成的条件控制
> **U0原理**: 根据生成进度动态调整条件强度
> **迁移**: 根据用户习惯和情感状态动态决定主动消息时机和内容

#### 修改文件: `src/main/proactive/Scheduler.ts`

#### 7.2.1 基于用户习惯的主动消息

```typescript
/**
 * U0 对应: cfg_decay 根据进度动态调整
 * 这里: 根据用户活跃时间动态安排主动消息
 */
private getPersonalizedSchedule(userPatterns: {
  activeHours: number[]   // 用户通常活跃的时间段
  averageReplyDelay: number  // 用户平均回复间隔(分钟)
}): ScheduledTrigger[] {
  const triggers = [...DEFAULT_TRIGGERS]

  // 根据用户活跃时间调整早安晚安
  if (userPatterns.activeHours.length > 0) {
    const earliestHour = Math.min(...userPatterns.activeHours)
    const latestHour = Math.max(...userPatterns.activeHours)

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
  }

  return triggers
}
```

#### 7.2.2 基于情感状态的主动消息

```typescript
/**
 * 根据角色情感状态触发不同类型的主动消息
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
```

#### 7.2.3 基于用户接受度的过滤

```typescript
/**
 * 根据用户对主动消息的反应调整发送频率
 */
private shouldSendProactiveMessage(userEngagement: {
  lastResponseTime: number
  responseRate: number
  avgResponseDelay: number
  ignoredCount: number
}): boolean {
  // 1. 最近被忽略太多次，暂停主动消息
  if (userEngagement.ignoredCount > 3) {
    return false // 等用户主动来找
  }
  
  // 2. 回复率太低，减少频率
  if (userEngagement.responseRate < 0.3) {
    return Math.random() < 0.2 // 20%概率发送
  }
  
  // 3. 回复很慢，可能在忙
  if (userEngagement.avgResponseDelay > 60) {
    return Math.random() < 0.5
  }
  
  return true
}
```

---

## 八、健壮性优化

### 8.1 ModelRouter — 容错重试

> **U0来源**: `xr_u0_ar/generation.py` — 生成过程中的异常处理
> **U0原理**: decode_image 失败时返回 null 而不是崩溃，流式生成异常时 fallback 到非流式
> **迁移**: API 调用失败时自动重试/降级

#### 修改文件: `src/main/engine/ModelRouter.ts`

```typescript
/**
 * U0 对应: generation.py 中 decode_image 的 try-catch + fallback
 * U0: 图像解码失败返回 null，不影响其他输出
 * 这里: API 调用失败自动重试，超时后降级
 */

async chatWithRetry(request: ChatRequest, maxRetries: number = 2): Promise<ChatResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.chat(request)
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error)

      if (attempt < maxRetries && isRetryable) {
        // 根据错误类型选择重试策略
        const retryConfig = this.getRetryConfig(error, attempt)
        const retryRequest = { ...request, ...retryConfig }
        
        logger.warn(`API 调用失败 (attempt ${attempt + 1}), 重试中...`)
        await this.delay(retryConfig.delay ?? 1000 * (attempt + 1))
        continue
      }

      // 最终失败 → 降级回复
      logger.error(`API 调用最终失败, 使用降级回复`)
      return this.getFallbackResponse(request)
    }
  }
  throw new Error('unreachable')
}

private isRetryableError(error: any): boolean {
  const retryableCodes = [429, 500, 502, 503, 504]
  const retryableMessages = ['timeout', 'ECONNRESET', 'ETIMEDOUT']
  if (retryableCodes.includes(error.status)) return true
  if (retryableMessages.some(m => error.message?.includes(m))) return true
  return false
}

/**
 * 根据错误类型选择重试策略
 */
private getRetryConfig(error: any, attempt: number): Partial<ChatRequest> {
  const baseDelay = 1000 * Math.pow(2, attempt) // 指数退避
  
  if (error.status === 429) {
    // 限流：降低temperature + 增加延迟
    return {
      temperature: Math.max(0.1, (request.temperature ?? 0.7) * 0.8),
      delay: baseDelay * 2,
    }
  }
  
  if (error.status === 500 || error.status === 502) {
    // 服务端错误：保持参数，只增加延迟
    return { delay: baseDelay }
  }
  
  if (error.message?.includes('timeout')) {
    // 超时：减少maxTokens，加快响应
    return {
      maxTokens: Math.floor((request.maxTokens ?? 1024) * 0.7),
      delay: baseDelay,
    }
  }
  
  return { delay: baseDelay }
}

private getFallbackResponse(request: ChatRequest): ChatResponse {
  const fallbacks = [
    '嗯嗯',
    '哈哈',
    '好的呀',
    '这样啊',
    '嗯...让我想想',
  ]
  const content = fallbacks[Math.floor(Math.random() * fallbacks.length)]
  return {
    content,
    model: 'fallback',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}
```

---

## 九、执行计划

### Phase 1: 核心算法修复（1周）

```
Week 1 — 核心算法修复（高优先级）
  □ 修复 SamplingStrategy merge 策略（加权融合）
  □ 修复 QualityChecker stringSimilarity（编辑距离）
  □ 修复 EmotionFSM applyContagion 计算错误（关系阶段权重）
  □ 优化 MemoryManager token 估算（中文/英文区分）
  □ 情感状态影响采样参数
```

### Phase 2: 对话质量核心（1周）

```
Week 2 — 对话质量核心
  □ PersonaCFG (人设强化)                    新建 PersonaCFG.ts
  □ SamplingStrategy (差异化采样)             新建 SamplingStrategy.ts
  □ QualityChecker (质量自检)                 新建 QualityChecker.ts
  □ ModelRouter 接入 samplingOverrides        修改 ModelRouter.ts
  □ ChatEngine 接入 CFG + Strategy            修改 ChatEngine.ts
```

### Phase 3: 记忆系统升级（1周）

```
Week 3 — 记忆系统升级
  □ MemoryGrader 评分增强 (情感加权)          修改 MemoryGrader.ts
  □ MemoryManager 智能注入 (token 预算)       修改 MemoryManager.ts
  □ ProximityMask 记忆检索                    新建 ProximityMemoryRetriever.ts
  □ 分层配置系统                             新建 ConfigComposer.ts
```

### Phase 4: 情感与人性化（1周）

```
Week 4 — 情感与人性化
  □ EmotionFSM 衰减+传染+和好细化            修改 EmotionFSM.ts
  □ Humanizer 打字节奏+消息拆分               修改 Humanizer.ts
  □ RuleEngine 规则库扩充 (优先级+冲突)       修改 RuleEngine.ts
  □ Scheduler 智能主动消息 (接受度反馈)        修改 Scheduler.ts
```

### Phase 5: 健壮性与配置（1周）

```
Week 5 — 健壮性与配置
  □ ModelRouter 容错重试 (智能策略)           修改 ModelRouter.ts
  □ PersonaCFG 语气一致性检测                 增强 PersonaCFG.ts
  □ ModelAnalyzer 周期分析增强                修改 ModelAnalyzer.ts
  □ Profile模式（轻量/均衡/性能）             增强 ConfigComposer.ts
```

---

## 十、预期效果

| 优化维度 | 预期提升 | 实现模块 |
|----------|----------|----------|
| 人设一致性 | +40% | PersonaCFG + QualityChecker |
| 对话自然度 | +35% | SamplingStrategy + Humanizer |
| 情感真实感 | +50% | EmotionFSM + 情感影响采样 |
| 记忆智能度 | +30% | MemoryGrader + MemoryManager + ProximityMask |
| 健壮性 | +60% | ModelRouter容错 + QualityChecker |
| 用户体验 | +45% | Scheduler + ConfigComposer |

---

## 十一、U0 技术映射总表

| 拟恋模块 | U0 来源文件 | U0 技术 | 迁移方式 |
|:---|:---|:---|:---|
| ConfigComposer | `configs/compose.py` | 分层配置合成 | 4层配置合并 + dry-run |
| UnifiedTaskRouter | `scripts/inference.py` | 统一CLI入口 | 统一任务接口 |
| PersonaCFG | `logits_processor.py` | CFG guidance_scale | 动态 prompt 强度 + 采样参数联动 |
| SamplingStrategy | `logits_processor.py` (DifferentialTopK) | 差异化 top_k/temperature | 按消息类型选采样参数 + 加权融合 |
| QualityChecker | `logits_processor.py` (token mask) | 输出合法性约束 | 回复质量多维检查 + 编辑距离 |
| EmotionFSM 衰减 | `logits_processor.py` (cfg_decay) | linear/cosine decay | 情感值随时间衰减到基线 |
| EmotionFSM 传染 | 统一 token 空间思想 | 模态间相互影响 | 用户情感影响角色情感 (关系阶段权重) |
| MemoryGrader | `logits_processor.py` | token 类型差异化权重 | 记忆按类型+情感+时间加权评分 |
| MemoryManager | `configs/compose.py` | 分层配置合成 | 记忆按优先级+token预算注入 |
| ProximityMask | `xr_u0_flashar/model.py` | 2D causal mask | 记忆检索的距离概念 |
| Humanizer | `generation.py` (streaming_generate) | 流式输出节奏控制 | 打字延迟+消息拆分+真人行为 |
| Scheduler | `logits_processor.py` (cfg_decay) | 动态条件调整 | 根据习惯+情感+接受度动态触发 |
| ModelRouter 容错 | `generation.py` (try-catch) | 异常 fallback | 智能重试+降级回复 |

---

## 附录：相关链接

- **U0项目**: https://github.com/XiaomiRobotics/Xiaomi-Robotics-U0
- **U0论文**: https://arxiv.org/abs/2607.11643
- **逆向分析**: https://github.com/ya-chang/Xiaomi-Robotics-U0-Analysis
- **项目主页**: https://robotics.xiaomi.com/xiaomi-robotics-u0.html

---

*文档版本: v2.0*
*更新日期: 2026-07-23*
*作者: MiMo Code Agent*
