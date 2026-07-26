// src/main/config/ConfigComposer.ts
// 分层配置合成引擎 — 灵感来源: Xiaomi-Robotics-U0 的 compose.py
// U0源码: configs/compose.py
// 核心思想: 4层配置按优先级合并，支持运行时覆盖和dry-run预览

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PATHS } from '../utils/dataPath'
import { logger } from '../utils/logger'

/**
 * 基础配置层 — 角色基础信息
 */
export interface BaseConfig {
  name: string
  personality: string
  style: 'gentle' | 'playful' | 'serious' | 'tsundere'
  catchphrases: string[]
  bannedWords: string[]
}

/**
 * 任务配置层 — 不同场景的参数
 */
export interface TaskConfig {
  daily_chat: TaskParams
  emotional_support: TaskParams
  flirty: TaskParams
}

export interface TaskParams {
  emojiRate: number
  memoryInjection: 'minimal' | 'balanced' | 'detailed'
  responseLength: 'short' | 'medium' | 'long'
}

/**
 * 运行时配置层 — API调用参数
 */
export interface RuntimeConfig {
  provider: string
  model: string
  temperature: number
  topP: number
  maxTokens: number
  frequencyPenalty: number
  presencePenalty: number
}

/**
 * 性能配置层 — 不同性能模式
 */
export interface ProfileConfig {
  lite: ProfileParams
  balanced: ProfileParams
  performance: ProfileParams
}

export interface ProfileParams {
  maxTokens: number
  timeout: number
  batchSize: number
}

/**
 * 完整角色配置
 */
export interface CharacterConfig {
  base: BaseConfig
  task: TaskConfig
  runtime: RuntimeConfig
  profile: ProfileConfig
}

/**
 * 合成后的配置
 */
export interface ComposedConfig {
  name: string
  personality: string
  style: BaseConfig['style']
  catchphrases: string[]
  bannedWords: string[]
  taskConfig: TaskParams
  runtime: RuntimeConfig
  profile: ProfileParams
}

// 默认配置
const DEFAULT_BASE: BaseConfig = {
  name: '小雅',
  personality: '温柔体贴的虚拟女友',
  style: 'gentle',
  catchphrases: ['嗯嗯', '好的呀', '我知道了'],
  bannedWords: ['滚', '烦', '闭嘴']
}

const DEFAULT_TASK: TaskConfig = {
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
}

const DEFAULT_RUNTIME: RuntimeConfig = {
  provider: 'mimo',
  model: 'MiMo-V2-Flash',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 1024,
  frequencyPenalty: 1.2,
  presencePenalty: 1.0
}

const DEFAULT_PROFILE: ProfileConfig = {
  lite: { maxTokens: 512, timeout: 5000, batchSize: 1 },
  balanced: { maxTokens: 1024, timeout: 10000, batchSize: 2 },
  performance: { maxTokens: 2048, timeout: 15000, batchSize: 3 }
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
   * 
   * U0对应: compose.py 的 compose_dict 函数
   * U0: base_config → task_config → runtime_config → profile_config → overrides
   * 这里: base → task → runtime → profile → 运行时覆盖
   * 
   * @param characterId 角色ID
   * @param options 配置选项
   * @returns 合成后的配置
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
    
    // 分层合成
    let composed: ComposedConfig = {
      name: config.base.name,
      personality: config.base.personality,
      style: config.base.style,
      catchphrases: config.base.catchphrases,
      bannedWords: config.base.bannedWords,
      taskConfig: config.task[taskType],
      runtime: { ...config.runtime },
      profile: config.profile[profileName]
    }

    // 应用运行时覆盖
    if (overrides && Object.keys(overrides).length > 0) {
      composed = this.deepMerge(composed, overrides) as ComposedConfig
    }

    return composed
  }

  /**
   * 加载角色配置
   */
  private async loadConfig(characterId: string): Promise<CharacterConfig> {
    // 检查缓存
    if (this.configs.has(characterId)) {
      return this.configs.get(characterId)!
    }

    // 尝试从文件系统加载
    const configPath = join(PATHS.characters, characterId, 'config.yaml')
    let config: CharacterConfig

    if (existsSync(configPath)) {
      try {
        // 简化的YAML解析（实际项目可用yaml库）
        const content = readFileSync(configPath, 'utf-8')
        config = this.parseConfig(content, characterId)
      } catch (err) {
        logger.warn(`配置加载失败: ${characterId}, 使用默认配置`, err)
        config = this.getDefaultConfig(characterId)
      }
    } else {
      config = this.getDefaultConfig(characterId)
    }

    // 缓存配置
    this.configs.set(characterId, config)
    return config
  }

  /**
   * 解析配置文件
   */
  private parseConfig(content: string, characterId: string): CharacterConfig {
    // 简单解析，实际项目可用yaml库
    const defaultConfig = this.getDefaultConfig(characterId)
    
    // 尝试提取name
    const nameMatch = content.match(/name:\s*["']?([^"'\n]+)["']?/)
    if (nameMatch) {
      defaultConfig.base.name = nameMatch[1].trim()
    }

    // 尝试提取personality
    const personalityMatch = content.match(/personality:\s*["']?([^"'\n]+)["']?/)
    if (personalityMatch) {
      defaultConfig.base.personality = personalityMatch[1].trim()
    }

    return defaultConfig
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(characterId: string): CharacterConfig {
    return {
      base: { ...DEFAULT_BASE },
      task: JSON.parse(JSON.stringify(DEFAULT_TASK)),
      runtime: { ...DEFAULT_RUNTIME },
      profile: JSON.parse(JSON.stringify(DEFAULT_PROFILE))
    }
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target }
    
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }
    
    return result
  }

  /**
   * Dry-run预览配置
   * 
   * U0对应: --dry-run 参数，只打印配置不执行
   * 
   * @param characterId 角色ID
   * @param options 配置选项
   */
  async dryRun(characterId: string, options: any = {}): Promise<void> {
    console.log('=== 角色配置预览 ===')
    console.log(`角色ID: ${characterId}`)
    
    try {
      const config = await this.compose(characterId, options)
      
      console.log('\n--- 基础信息 ---')
      console.log(`名称: ${config.name}`)
      console.log(`人设: ${config.personality}`)
      console.log(`风格: ${config.style}`)
      console.log(`口头禅: ${config.catchphrases.join('、')}`)
      console.log(`禁用词: ${config.bannedWords.join('、')}`)
      
      console.log('\n--- 任务配置 ---')
      console.log(`表情频率: ${config.taskConfig.emojiRate}`)
      console.log(`记忆注入: ${config.taskConfig.memoryInjection}`)
      console.log(`回复长度: ${config.taskConfig.responseLength}`)
      
      console.log('\n--- 运行时 ---')
      console.log(`Provider: ${config.runtime.provider}`)
      console.log(`Model: ${config.runtime.model}`)
      console.log(`Temperature: ${config.runtime.temperature}`)
      console.log(`MaxTokens: ${config.runtime.maxTokens}`)
      
      console.log('\n--- 性能配置 ---')
      console.log(`MaxTokens: ${config.profile.maxTokens}`)
      console.log(`Timeout: ${config.profile.timeout}ms`)
      console.log(`BatchSize: ${config.profile.batchSize}`)
      
      console.log('\n=== 配置预览完成 ===')
    } catch (err) {
      console.error('配置预览失败:', err)
    }
  }

  /**
   * 清除配置缓存
   */
  clearCache(characterId?: string): void {
    if (characterId) {
      this.configs.delete(characterId)
    } else {
      this.configs.clear()
    }
  }

  /**
   * 获取 Profile 描述
   * 
   * Phase 5: Profile模式说明
   */
  getProfileDescription(profileName: keyof ProfileConfig): string {
    const descriptions: Record<keyof ProfileConfig, string> = {
      lite: '轻量模式 - 适合低配设备，响应快但功能简单',
      balanced: '均衡模式 - 功能与性能的平衡（推荐）',
      performance: '性能模式 - 最佳效果，适合高配设备'
    }
    return descriptions[profileName]
  }

  /**
   * 获取所有可用的 Profile
   */
  getAvailableProfiles(): Array<{ name: keyof ProfileConfig; description: string; params: ProfileParams }> {
    return [
      { name: 'lite', description: this.getProfileDescription('lite'), params: DEFAULT_PROFILE.lite },
      { name: 'balanced', description: this.getProfileDescription('balanced'), params: DEFAULT_PROFILE.balanced },
      { name: 'performance', description: this.getProfileDescription('performance'), params: DEFAULT_PROFILE.performance }
    ]
  }

  /**
   * 验证配置是否有效
   */
  validateConfig(config: ComposedConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!config.name || config.name.trim().length === 0) {
      errors.push('角色名称不能为空')
    }

    if (!config.personality || config.personality.trim().length === 0) {
      errors.push('角色人设不能为空')
    }

    if (config.runtime.temperature < 0 || config.runtime.temperature > 2) {
      errors.push('Temperature 应在 0-2 范围内')
    }

    if (config.runtime.maxTokens < 1 || config.runtime.maxTokens > 8192) {
      errors.push('MaxTokens 应在 1-8192 范围内')
    }

    if (config.profile.timeout < 1000) {
      errors.push('Timeout 应大于 1000ms')
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * 获取配置摘要（用于日志）
   */
  getConfigSummary(config: ComposedConfig): string {
    return `[${config.name}] style=${config.style}, model=${config.runtime.model}, temp=${config.runtime.temperature}`
  }
}
