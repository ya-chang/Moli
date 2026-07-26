// src/main/engine/ModelRouter.ts
// 模型路由器 — 支持流式输出 + 多模态 + 容错重试
// 灵感来源: Xiaomi-Robotics-U0 的 generation.py 异常处理
// U0源码: xr_u0_ar/generation.py (try-catch + fallback)
// 核心思想: API调用失败时自动重试，超时后降级

import { getProviderConfig } from '../utils/config'
import { logger } from '../utils/logger'

// 多模态内容项
export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image_url'
  image_url: {
    url: string  // base64 data URL 或 http URL
  }
}

export type MultimodalContent = TextContent | ImageContent

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | MultimodalContent[]
}

export interface ChatRequest {
  messages: ChatMessage[]
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  apiKey?: string
  baseUrl?: string
  // 差异化采样参数覆盖
  samplingOverrides?: {
    temperature?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
  }
}

export interface ChatResponse {
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * 重试配置
 */
interface RetryConfig {
  delay: number           // 延迟时间 (ms)
  temperature?: number    // 覆盖temperature
  maxTokens?: number      // 覆盖maxTokens
}

export class ModelRouter {
  private maxRetries = 2  // 最大重试次数

  /**
   * 流式调用 — 返回 AsyncGenerator，逐 token 产出
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<{ content: string; done: boolean }> {
    // 优先使用传入的 apiKey/baseUrl，否则从全局配置读取
    let apiKey = request.apiKey
    let baseUrl = request.baseUrl
    if (!apiKey || !baseUrl) {
      const provider = getProviderConfig(request.provider)
      if (!apiKey) apiKey = provider.apiKey
      if (!baseUrl) baseUrl = provider.baseUrl
    }

    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.samplingOverrides?.temperature ?? request.temperature ?? 0.7,
      top_p: Math.round((request.samplingOverrides?.topP ?? 0.9) * 100) / 100,
      max_tokens: request.maxTokens ?? 1024,
      frequency_penalty: request.samplingOverrides?.frequencyPenalty ?? 0.6,
      presence_penalty: request.samplingOverrides?.presencePenalty ?? 0.5,
      stream: true
    }

    logger.info(`模型调用(流式): ${request.provider}/${request.model}, temp=${body.temperature}, baseUrl=${baseUrl}`)

    // 30秒超时防止无限等待
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!response.ok) {
      clearTimeout(timeout)
      const errorText = await response.text()
      logger.error(`API 调用失败: ${response.status}`, errorText)
      throw new Error(`API 调用失败: ${response.status} ${errorText}`)
    }

    clearTimeout(timeout)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法获取响应流')

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        // 每次读取最多 30 秒超时，防止流卡住
        const readResult = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('流式读取超时')), 30000))
        ])
        const { done, value } = readResult
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            yield { content: '', done: true }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              yield { content: delta, done: false }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (readError) {
      logger.error('流式读取中断', readError)
      throw new Error(`流式读取失败: ${readError instanceof Error ? readError.message : String(readError)}`)
    }

    yield { content: '', done: true }
  }

  /**
   * 非流式调用（带重试）
   * 
   * Phase 5 优化: 智能重试策略
   * - 429限流: 降低temperature + 增加延迟
   * - 500/502服务端错误: 保持参数，只增加延迟
   * - timeout超时: 减少maxTokens
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.chatOnce(request, attempt)
      } catch (error: any) {
        const isRetryable = this.isRetryableError(error)
        
        if (attempt < this.maxRetries && isRetryable) {
          const retryConfig = this.getRetryConfig(error, attempt)
          logger.warn(`[ModelRouter] API调用失败 (attempt ${attempt + 1}), ${retryConfig.delay}ms后重试...`)
          await this.delay(retryConfig.delay)
          
          // 应用重试配置
          if (retryConfig.temperature !== undefined) {
            request.temperature = retryConfig.temperature
          }
          if (retryConfig.maxTokens !== undefined) {
            request.maxTokens = retryConfig.maxTokens
          }
          continue
        }
        
        // 最终失败，返回降级回复
        logger.error(`[ModelRouter] API调用最终失败，使用降级回复`)
        return this.getFallbackResponse(request)
      }
    }
    
    // 不应该到达这里
    throw new Error('unreachable')
  }

  /**
   * 单次调用
   */
  private async chatOnce(request: ChatRequest, attempt: number): Promise<ChatResponse> {
    // 优先使用传入的 apiKey/baseUrl
    let apiKey = request.apiKey
    let baseUrl = request.baseUrl
    if (!apiKey || !baseUrl) {
      const provider = getProviderConfig(request.provider)
      if (!apiKey) apiKey = provider.apiKey
      if (!baseUrl) baseUrl = provider.baseUrl
    }

    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.samplingOverrides?.temperature ?? request.temperature ?? 0.7,
      top_p: Math.round((request.samplingOverrides?.topP ?? 0.9) * 100) / 100,
      max_tokens: request.maxTokens ?? 1024,
      frequency_penalty: request.samplingOverrides?.frequencyPenalty ?? 0.6,
      presence_penalty: request.samplingOverrides?.presencePenalty ?? 0.5,
      stream: false
    }

    logger.info(`模型调用: ${request.provider}/${request.model}, temp=${body.temperature}, attempt=${attempt}`)

    // 30秒超时
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errorText = await response.text()
      const error = new Error(`API 调用失败: ${response.status} ${errorText}`) as any
      error.status = response.status
      throw error
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      model: string
      usage: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
    }

    const content = data.choices?.[0]?.message?.content ?? ''
    logger.info(`API 响应成功, tokens: ${data.usage?.total_tokens ?? 0}`)

    return {
      content,
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0
      }
    }
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: any): boolean {
    // HTTP状态码
    const retryableCodes = [429, 500, 502, 503, 504]
    if (error.status && retryableCodes.includes(error.status)) {
      return true
    }
    
    // 网络错误
    const retryableMessages = ['timeout', 'ECONNRESET', 'ETIMEDOUT', 'fetch failed']
    if (retryableMessages.some(m => error.message?.toLowerCase().includes(m.toLowerCase()))) {
      return true
    }
    
    return false
  }

  /**
   * 根据错误类型获取重试配置
   * 
   * Phase 5: 智能重试策略
   * - 429限流: 降低temperature + 增加延迟
   * - 500/502服务端错误: 保持参数，只增加延迟
   * - timeout超时: 减少maxTokens
   */
  private getRetryConfig(error: any, attempt: number): RetryConfig {
    const baseDelay = 1000 * Math.pow(2, attempt) // 指数退避: 1s, 2s, 4s...
    
    if (error.status === 429) {
      // 限流：降低temperature + 增加延迟
      return {
        delay: baseDelay * 2,
        temperature: Math.max(0.1, (request.temperature ?? 0.7) * 0.8)
      }
    }
    
    if (error.status === 500 || error.status === 502) {
      // 服务端错误：保持参数，只增加延迟
      return {
        delay: baseDelay
      }
    }
    
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      // 超时：减少maxTokens，加快响应
      return {
        delay: baseDelay,
        maxTokens: Math.floor((request.maxTokens ?? 1024) * 0.7)
      }
    }
    
    // 默认：指数退避
    return {
      delay: baseDelay
    }
  }

  /**
   * 生成降级回复
   * U0对应: generation.py 中 decode_image 失败返回 null
   */
  private getFallbackResponse(request: ChatRequest): ChatResponse {
    const fallbacks = [
      '嗯嗯',
      '哈哈',
      '好的呀',
      '这样啊',
      '嗯...让我想想',
      '我明白了',
      '知道了~',
    ]
    const content = fallbacks[Math.floor(Math.random() * fallbacks.length)]
    
    return {
      content,
      model: 'fallback',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    }
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
