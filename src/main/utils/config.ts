// src/main/utils/config.ts
// 配置读取工具 — 从 data/ 目录读取 YAML/JSON 配置

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { parse as parseYaml } from 'yaml'
import type { ModelConfig } from '../../shared/types'
import { PATHS } from './dataPath'

// 数据根目录：直接用 PATHS.base 统一路径
const getDataRoot = (): string => {
  return PATHS.base
}

/**
 * 打包后首次启动 — 将默认配置复制到 userData
 * 开发模式跳过
 */
const ensureDefaultConfig = (): void => {
  if (!app.isPackaged) return

  const dataRoot = getDataRoot()
  const globalDir = join(dataRoot, 'global')

  // 如果 models.yaml 已存在，不覆盖
  if (existsSync(join(globalDir, 'models.yaml'))) return

  mkdirSync(globalDir, { recursive: true })

  // 内置默认配置
  const defaultModelsYaml = `# data/global/models.yaml
# 模型配置文件 — API Key 从环境变量读取

providers:
  deepseek:
    name: DeepSeek
    baseUrl: https://api.deepseek.com
    apiKey: \${DEEPSEEK_API_KEY}
    models:
      - deepseek-v4-flash
      - deepseek-v4-pro
      - deepseek-chat
      - deepseek-reasoner
    supportsCache: true
  mimo:
    name: MiMo
    baseUrl: https://api.xiaomimimo.com/v1
    apiKey: \${MIMO_API_KEY}
    models:
      - mimo-v2.5-pro
      - mimo-v2.5
    supportsCache: false
  openai:
    name: OpenAI
    baseUrl: https://api.openai.com/v1
    apiKey: \${OPENAI_API_KEY}
    models:
      - gpt-4o
      - gpt-4o-mini
      - gpt-4-turbo
      - o1-preview
    supportsCache: false

default:
  provider: deepseek
  model: deepseek-v4-flash
  temperature: 0.7
  maxTokens: 1024
`
  writeFileSync(join(globalDir, 'models.yaml'), defaultModelsYaml, 'utf-8')
}

// 启动时确保配置存在
ensureDefaultConfig()

// TODO: [P1] 待实现 —— models.yaml 中的 apiKey 用 ${ENV_VAR} 引用环境变量
// 目前直接从环境变量读取，后续可以支持 .env 文件
const resolveEnvValue = (value: string): string => {
  if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
    const envKey = value.slice(2, -1)
    return process.env[envKey] ?? ''
  }
  return value
}

export interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  supportsCache: boolean
}

export interface ModelsConfig {
  providers: Record<string, ProviderConfig>
  default: {
    provider: string
    model: string
    temperature: number
    maxTokens: number
  }
}

export const loadModelsConfig = (): ModelsConfig => {
  const configPath = join(getDataRoot(), 'global', 'models.yaml')

  if (!existsSync(configPath)) {
    throw new Error(`模型配置文件不存在: ${configPath}`)
  }

  const content = readFileSync(configPath, 'utf-8')
  const raw = parseYaml(content) as ModelsConfig

  // 解析环境变量引用
  for (const provider of Object.values(raw.providers)) {
    provider.apiKey = resolveEnvValue(provider.apiKey)
  }

  return raw
}

export const getProviderConfig = (providerName: string): ProviderConfig => {
  const config = loadModelsConfig()
  const provider = config.providers[providerName]
  if (!provider) {
    throw new Error(`未知的模型提供商: ${providerName}`)
  }
  return provider
}

export const buildModelConfig = (
  providerName: string,
  modelName: string
): ModelConfig => {
  const provider = getProviderConfig(providerName)
  const config = loadModelsConfig()

  if (!provider.models.includes(modelName)) {
    throw new Error(
      `模型 ${modelName} 不在提供商 ${providerName} 的支持列表中`
    )
  }

  return {
    provider: providerName,
    model: modelName,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    temperature: config.default.temperature,
    maxTokens: config.default.maxTokens,
    supportsCache: provider.supportsCache
  }
}
