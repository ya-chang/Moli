// src/main/tts/TTSService.ts
// TTS 服务 — 调用 MiMo V2.5 TTS API 合成语音

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { logger } from '../utils/logger'

const MIMO_TTS_BASE = 'https://api.xiaomimimo.com/v1'

// TTS 模型类型
export type TTSModelType = 'preset' | 'voicedesign' | 'voiceclone'

// TTS 模型配置
export const TTS_MODELS: Record<TTSModelType, { id: string; name: string; description: string }> = {
  preset: {
    id: 'mimo-v2.5-tts',
    name: '精品音色',
    description: '内置多款高质量精品音色，支持语速、情绪、语气控制'
  },
  voicedesign: {
    id: 'mimo-v2.5-tts-voicedesign',
    name: '音色设计',
    description: '通过一句话快速定义并生成全新音色'
  },
  voiceclone: {
    id: 'mimo-v2.5-tts-voiceclone',
    name: '音色克隆',
    description: '基于少量音频样本高保真复刻目标音色'
  }
}

const PRESET_VOICES = [
  { id: 'mimo_default', name: '冰糖', lang: '中文', gender: '女' },
  { id: '茉莉', name: '茉莉', lang: '中文', gender: '女' },
  { id: '苏打', name: '苏打', lang: '中文', gender: '男' },
  { id: '白桦', name: '白桦', lang: '中文', gender: '男' },
  { id: 'Mia', name: 'Mia', lang: '英文', gender: '女' },
  { id: 'Chloe', name: 'Chloe', lang: '英文', gender: '女' },
  { id: 'Milo', name: 'Milo', lang: '英文', gender: '男' },
  { id: 'Dean', name: 'Dean', lang: '英文', gender: '男' }
]

export class TTSService {
  private apiKey: string = ''
  private cacheDir: string
  private configPath: string
  private configDir: string

  constructor(dataDir: string) {
    this.cacheDir = join(dataDir, 'tts-cache')
    this.configDir = join(dataDir, 'tts')
    this.configPath = join(dataDir, 'tts', 'config.json')
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
    this.loadConfig()
  }

  private loadConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        const config = JSON.parse(readFileSync(this.configPath, 'utf-8'))
        if (config.apiKey) this.apiKey = config.apiKey
      }
    } catch { /* ignore */ }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify({ apiKey: this.apiKey }, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  init(apiKey: string): void {
    this.apiKey = apiKey
    this.saveConfig()
    this.saveConfig()
  }

  /** 获取当前 API Key（脱敏显示） */
  getApiKey(): string {
    return this.apiKey
  }

  /** 获取脱敏后的 Key */
  getMaskedApiKey(): string {
    if (!this.apiKey) return ''
    if (this.apiKey.length <= 8) return '****'
    return this.apiKey.slice(0, 4) + '****' + this.apiKey.slice(-4)
  }

  isReady(): boolean {
    return !!this.apiKey
  }

  /**
   * 合成语音
   * @param text 纯对话文本（已过滤描写状态）
   * @param voiceId 音色ID / 参考音频 base64（voiceclone 模式）
   * @param stylePrompt 风格指令 / 音色设计描述
   * @param modelType TTS模型类型 (preset/voicedesign/voiceclone)
   * @returns WAV 音频 Buffer
   */
  async synthesize(text: string, voiceId: string, stylePrompt?: string, modelType: TTSModelType = 'preset'): Promise<Buffer | null> {
    if (!this.apiKey) {
      logger.warn('[TTS] API Key 未配置')
      return null
    }
    if (!text.trim()) return null

    // 截取前500字
    const safeText = text.length > 500 ? text.slice(0, 500) : text

    // 检查缓存（只有 preset 模型缓存）
    const cacheKey = this.getCacheKey(safeText, voiceId, modelType)
    const cachedPath = join(this.cacheDir, `${cacheKey}.wav`)
    if (modelType === 'preset' && existsSync(cachedPath)) {
      return readFileSync(cachedPath)
    }

    try {
      // 构建请求体
      const messages = [
        { role: 'user', content: stylePrompt || '用自然的语气说话' },
        { role: 'assistant', content: safeText }
      ]

      const audio: Record<string, string> = { format: 'wav' }

      let apiModel: string
      switch (modelType) {
        case 'voicedesign':
          apiModel = 'mimo-v2.5-tts-voicedesign'
          break
        case 'voiceclone':
          apiModel = 'mimo-v2.5-tts-voiceclone'
          // voiceId 是参考音频的 base64 数据
          break
        default:
          apiModel = 'mimo-v2.5-tts'
          audio.voice = voiceId
          break
      }

      const requestBody: Record<string, unknown> = {
        model: apiModel,
        messages,
        audio
      }

      // voiceclone: 传参考音频数据
      if (modelType === 'voiceclone' && voiceId) {
        requestBody.reference_audio = voiceId
      }

      logger.info(`[TTS] API调用: model=${apiModel}, voice=${voiceId}, modelType=${modelType}, text=${safeText.slice(0, 30)}...`)
      logger.info(`[TTS] 请求体:`, JSON.stringify(requestBody).slice(0, 300))

      const response = await fetch(`${MIMO_TTS_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`[TTS] API调用失败: ${response.status}`, errorText)
        throw new Error(`API错误 ${response.status}: ${errorText.slice(0, 200)}`)
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { audio?: { data?: string } } }>
      }

      const audioBase64 = data.choices?.[0]?.message?.audio?.data
      if (!audioBase64) {
        logger.error('[TTS] 响应中没有音频数据', data)
        return null
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64')

      // 只缓存 preset 模型的结果
      if (modelType === 'preset') {
        writeFileSync(cachedPath, audioBuffer)
      }

      return audioBuffer
    } catch (err) {
      logger.error('[TTS] 合成失败', err)
      return null
    }
  }

  getPresetVoices(): typeof PRESET_VOICES {
    return PRESET_VOICES
  }

  getCacheSize(): number {
    let totalSize = 0
    try {
      const files = readdirSync(this.cacheDir)
      for (const file of files) {
        totalSize += statSync(join(this.cacheDir, file)).size
      }
    } catch { /* ignore */ }
    return totalSize
  }

  clearCache(): void {
    try {
      const files = readdirSync(this.cacheDir)
      for (const file of files) {
        unlinkSync(join(this.cacheDir, file))
      }
    } catch { /* ignore */ }
  }

  private getCacheKey(text: string, voice: string, modelType: string = 'preset'): string {
    return createHash('md5').update(`${modelType}:${voice}:${text}`).digest('hex')
  }

  getAvailableModels(): Array<{ id: TTSModelType; name: string; description: string }> {
    return Object.entries(TTS_MODELS).map(([id, config]) => ({
      id: id as TTSModelType,
      name: config.name,
      description: config.description
    }))
  }
}
