// src/main/music/MusicSourceManager.ts
// LX Music 音源管理器 — 加载并执行音源JS脚本

import * as vm from 'vm'
import * as https from 'https'
import * as http from 'http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

const SOURCE_CACHE_DIR = 'sources'

interface SourceScriptInfo {
  name: string
  description: string
  version: string
  author: string
}

interface SourceInitData {
  sources: Record<string, {
    name: string
    type: string
    actions: string[]
    qualitys: string[]
  }>
  openDevTools?: boolean
}

interface MusicRequestHandler {
  (data: { source: string; action: string; info: unknown }): Promise<unknown>
}

function getDataDir(): string {
  return PATHS.base
}

function getSourceCacheDir(): string {
  const dir = join(getDataDir(), SOURCE_CACHE_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function httpGet(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'))
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, maxRedirects - 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`))
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', (err) => reject(new Error(`Network error: ${err.message} from ${url}`)))
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)) })
  })
}

/**
 * 验证音源脚本内容是否有效
 */
// HTTP GET 并返回 JSON
function httpGetJSON(url: string, headers?: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, {
      headers: headers || {},
      timeout: 15000
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid JSON response'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function isValidSourceScript(content: string): boolean {
  if (!content || content.length < 100) return false
  // LX 音源以 /*! 开头
  if (!content.startsWith('/*!') && !content.startsWith('/**')) return false
  // 包含 lx 相关关键字
  if (!content.includes('lx') && !content.includes('musicUrl')) return false
  return true
}

/**
 * 尝试通过 GitHub 镜像下载（国内加速）
 */
async function fetchWithMirror(url: string): Promise<string> {
  // 直接尝试原地址
  try {
    const buf = await httpGet(url)
    const content = buf.toString('utf-8')
    if (isValidSourceScript(content)) {
      logger.info(`直接下载成功: ${url}, ${content.length} 字节`)
      return content
    }
  } catch (e) {
    logger.warn(`直接下载失败: ${url}`, (e as Error).message)
  }

  // 如果是 GitHub raw 链接，尝试镜像
  if (url.includes('raw.githubusercontent.com')) {
    const path = url.split('raw.githubusercontent.com/')[1]
    const mirrors = [
      `https://ghfast.top/https://raw.githubusercontent.com/${path}`,
      `https://mirror.ghproxy.com/https://raw.githubusercontent.com/${path}`,
      `https://gh-proxy.com/https://raw.githubusercontent.com/${path}`
    ]
    for (const mirror of mirrors) {
      try {
        const buf = await httpGet(mirror)
        const content = buf.toString('utf-8')
        if (isValidSourceScript(content)) {
          logger.info(`镜像下载成功: ${mirror}, ${content.length} 字节`)
          return content
        }
        logger.warn(`镜像内容无效: ${mirror}`)
      } catch (e) {
        logger.warn(`镜像下载失败: ${mirror}`, (e as Error).message)
      }
    }
  }

  throw new Error(`无法访问: ${url}（所有源均失败，请检查网络或使用其他音源URL）`)
}

export class MusicSourceManager {
  private requestHandler: MusicRequestHandler | null = null
  private sources: Record<string, { name: string; actions: string[]; qualitys: string[] }> = {}
  private sourceInfo: SourceScriptInfo | null = null
  private loaded = false
  private sourceUrl: string | null = null
  private defaultSourceKey = 'wy'

  /**
   * 设置音源URL并加载
   */
  async loadSource(url: string): Promise<boolean> {
    try {
      logger.info(`加载音源: ${url}`)
      this.sourceUrl = url

      // 下载音源脚本（自动使用镜像加速）
      const scriptContent = await fetchWithMirror(url)

      if (!scriptContent || scriptContent.length < 100) {
        logger.error('音源脚本内容为空或过短')
        throw new Error('下载的音源脚本无效')
      }

      // 缓存到本地
      const cachePath = join(getSourceCacheDir(), 'current_source.js')
      writeFileSync(cachePath, scriptContent, 'utf-8')

      logger.info(`音源脚本下载成功, 大小: ${scriptContent.length} 字节`)

      // 执行音源脚本
      return await this.executeScript(scriptContent)
    } catch (error) {
      logger.error('加载音源失败', error)
      // 尝试从缓存加载
      return this.loadFromCache()
    }
  }

  /**
   * 从缓存加载音源
   */
  private async loadFromCache(): Promise<boolean> {
    try {
      const cachePath = join(getSourceCacheDir(), 'current_source.js')
      if (!existsSync(cachePath)) return false

      const scriptContent = readFileSync(cachePath, 'utf-8')
      if (!isValidSourceScript(scriptContent)) {
        logger.warn('缓存的音源脚本无效')
        return false
      }
      return await this.executeScript(scriptContent)
    } catch (error) {
      logger.error('从缓存加载音源失败', error)
      return false
    }
  }

  /**
   * 在VM中执行音源脚本
   */
  private vmContext: vm.Context | null = null
  private vmCallHandler: ((info: unknown) => Promise<unknown>) | null = null

  private async executeScript(scriptContent: string): Promise<boolean> {
    try {
      const registeredHandlers: Array<{ event: string; handler: Function }> = []
      let initedData: SourceInitData | null = null
      let initError: Error | null = null
      let resolveRequestHandler: ((handler: Function) => void) | null = null

      // 创建 mock 的 globalThis.lx 对象
      const lx = {
        version: 2,
        env: 'desktop',
        currentScriptInfo: {
          name: '',
          description: '',
          version: '',
          author: '',
          rawScript: scriptContent
        },
        EVENT_NAMES: {
          inited: 'inited',
          request: 'request',
          updateAlert: 'updateAlert'
        },
        on: (eventName: string, handler: Function) => {
          logger.info(`音源注册事件: ${eventName}`)
          registeredHandlers.push({ event: eventName, handler })
          if (eventName === 'request' && resolveRequestHandler) {
            (resolveRequestHandler as (h: Function) => void)(handler)
          }
        },
        send: (eventName: string, data: unknown) => {
          logger.info(`音源发送事件: ${eventName}`)
          if (eventName === 'inited') {
            initedData = data as SourceInitData
            this.sources = initedData.sources || {}
          }
        },
        request: (url: string, options: Record<string, unknown>, callback: (err: Error | null, resp: { statusCode: number; headers: Record<string, string> }, body: string) => void) => {
          const method = (options.method as string) || 'GET'
          const headers = { ...(options.headers as Record<string, string> || {}) }
          let body = options.body as string | undefined

          // 处理 form 选项（application/x-www-form-urlencoded）
          if (options.form && typeof options.form === 'object') {
            const form = options.form as Record<string, string>
            body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
          }

          // 处理 formData 选项
          if (options.formData && typeof options.formData === 'object') {
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2)
            const formData = options.formData as Record<string, string>
            const parts = Object.entries(formData).map(([k, v]) => {
              return `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
            })
            body = parts.join('') + `--${boundary}--\r\n`
            headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
          }

          logger.debug(`lx.request: ${method} ${url}`)

          const client = url.startsWith('https') ? https : http
          const req = client.request(url, {
            method: method.toUpperCase(),
            headers,
            timeout: (options.timeout as number) || 30000
          }, (res) => {
            let data = ''
            res.on('data', (chunk: Buffer) => { data += chunk.toString() })
            res.on('end', () => {
              logger.debug(`lx.request response: ${res.statusCode}, ${data.substring(0, 200)}`)
              try {
                callback(null, {
                  statusCode: res.statusCode || 200,
                  headers: (res.headers as Record<string, string>) || {}
                }, data)
              } catch (e) {
                logger.error('lx.request callback error', e)
              }
            })
          })

          req.on('error', (err) => {
            logger.error('lx.request error', err.message)
            try {
              callback(err, { statusCode: 0, headers: {} }, '')
            } catch (e) {
              logger.error('lx.request callback error', e)
            }
          })
          req.on('timeout', () => {
            req.destroy()
            try {
              callback(new Error('timeout'), { statusCode: 0, headers: {} }, '')
            } catch (e) {
              logger.error('lx.request callback error', e)
            }
          })

          if (body) req.write(body)
          req.end()

          return () => { req.destroy() }
        },
        utils: {
          buffer: {
            from: Buffer.from,
            bufToString: (buf: Buffer, format?: BufferEncoding) => buf.toString(format)
          },
          crypto: {
            aesEncrypt: (buf: Buffer, mode: unknown, key: unknown, iv: unknown) => {
              logger.debug('aesEncrypt called')
              return Buffer.alloc(0)
            },
            md5: (str: string) => {
              const crypto = require('crypto')
              return crypto.createHash('md5').update(str).digest('hex')
            },
            randomBytes: (size: number) => require('crypto').randomBytes(size).toString('hex'),
            rsaEncrypt: (buf: Buffer, key: unknown) => {
              logger.debug('rsaEncrypt called')
              return Buffer.alloc(0)
            }
          },
          zlib: {
            inflate: async (buf: Buffer) => {
              const zlib = require('zlib')
              return new Promise<Buffer>((resolve, reject) => {
                zlib.inflate(buf, (err: Error | null, result: Buffer) => {
                  if (err) reject(err)
                  else resolve(result)
                })
              })
            },
            deflate: async (buf: Buffer) => {
              const zlib = require('zlib')
              return new Promise<Buffer>((resolve, reject) => {
                zlib.deflate(buf, (err: Error | null, result: Buffer) => {
                  if (err) reject(err)
                  else resolve(result)
                })
              })
            }
          }
        }
      }

      // 创建沙箱环境 — 提供所有可能需要的全局对象
      const sandbox = {
        globalThis: { lx },
        lx,
        console: {
          log: (...args: unknown[]) => logger.debug('[source]', ...args),
          error: (...args: unknown[]) => logger.error('[source]', ...args),
          warn: (...args: unknown[]) => logger.warn('[source]', ...args),
          info: (...args: unknown[]) => logger.info('[source]', ...args),
          debug: (...args: unknown[]) => logger.debug('[source]', ...args)
        },
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Buffer,
        Promise,
        Array,
        Object,
        String,
        Number,
        Date,
        Math,
        RegExp,
        JSON,
        encodeURIComponent,
        decodeURIComponent,
        parseFloat,
        parseInt,
        isNaN,
        isFinite,
        atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),
        btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
        TextEncoder,
        TextDecoder,
        URL: require('url').URL,
        URLSearchParams: require('url').URLSearchParams
      }

      const context = vm.createContext(sandbox)
      this.vmContext = context

      // 执行脚本
      logger.info('开始执行音源脚本...')
      const script = new vm.Script(scriptContent, { filename: 'source.js' })
      script.runInContext(context)
      logger.info('音源脚本执行完成')

      // 检查是否已经收到 inited 事件（脚本可能同步发送了）
      if (initedData) {
        logger.info('音源已初始化（同步）')
        this.sourceInfo = lx.currentScriptInfo
        this.loaded = true

        // 找到 request 处理器
        for (const reg of registeredHandlers) {
          if (reg.event === 'request') {
            this.requestHandler = reg.handler as MusicRequestHandler
            break
          }
        }

        // 在 VM 中设置 handler 并创建包装器
        context.__lx_handler__ = this.requestHandler
        const wrapperScript = new vm.Script(`
          var __callRequestHandler__ = function(info) {
            return new Promise((resolve, reject) => {
              try {
                var result = __lx_handler__(info);
                if (result && typeof result.then === 'function') {
                  result.then(resolve).catch(reject);
                } else {
                  resolve(result);
                }
              } catch(e) {
                reject(e);
              }
            });
          };
          __callRequestHandler__;
        `, { filename: 'wrapper.js' })
        const callHandler = wrapperScript.runInContext(context)
        this.vmCallHandler = callHandler as (info: unknown) => Promise<unknown>
        logger.info(`vmCallHandler type: ${typeof this.vmCallHandler}`)

        const sourceNames = Object.keys(this.sources)
        logger.info(`音源加载成功: ${this.sourceInfo?.name || '未知'}, 支持源: ${sourceNames.join(', ')}`)
        return true
      }

      // 如果没有同步收到，等待异步初始化（5秒超时）
      logger.info('等待音源异步初始化...')
      const result = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn('音源异步初始化超时')
          resolve(false)
        }, 5000)

        // 轮询检查（因为 lx.send 可能在异步操作后调用）
        const checkInterval = setInterval(() => {
          if (initedData) {
            clearTimeout(timeout)
            clearInterval(checkInterval)
            resolve(true)
          }
        }, 100)
      })

      if (result && initedData) {
        this.sourceInfo = lx.currentScriptInfo
        this.loaded = true

        // 找到 request 处理器
        for (const reg of registeredHandlers) {
          if (reg.event === 'request') {
            this.requestHandler = reg.handler as MusicRequestHandler
            break
          }
        }

        // 在 VM 中设置 handler 并创建包装器
        context.__lx_handler__ = this.requestHandler
        const wrapperScript = new vm.Script(`
          var __callRequestHandler__ = function(info) {
            return new Promise((resolve, reject) => {
              try {
                var result = __lx_handler__(info);
                if (result && typeof result.then === 'function') {
                  result.then(resolve).catch(reject);
                } else {
                  resolve(result);
                }
              } catch(e) {
                reject(e);
              }
            });
          };
          __callRequestHandler__;
        `, { filename: 'wrapper.js' })
        const callHandler = wrapperScript.runInContext(context)
        this.vmCallHandler = callHandler as (info: unknown) => Promise<unknown>
        logger.info(`vmCallHandler type: ${typeof this.vmCallHandler}`)

        const sourceNames = Object.keys(this.sources)
        logger.info(`音源加载成功: ${this.sourceInfo?.name || '未知'}, 支持源: ${sourceNames.join(', ')}`)
      }

      return result
    } catch (error) {
      logger.error('执行音源脚本失败', error)
      this.loaded = false
      return false
    }
  }

  /**
   * 获取音乐播放URL
   */
  async getMusicUrl(songmid: string, name: string, _source?: string): Promise<string | null> {
    const source = _source || this.defaultSourceKey
    const quality = '320k'
    logger.info(`请求音乐URL: source=${source}, quality=${quality}, songmid=${songmid}, name=${name}`)

    // 方法1: 尝试直接调用 LX Music API 服务器
    try {
      const apiUrl = `https://88.lxmusic.xn--fiqs8s/url/${source}/${quality}/${songmid}`
      logger.info(`直接调用 API: ${apiUrl}`)
      const result = await httpGetJSON(apiUrl, {
        'key': 'lxmusic',
        'Accept': 'application/json'
      })
      logger.info(`API 响应: ${JSON.stringify(result).substring(0, 200)}`)
      if (result && typeof result === 'object') {
        const data = result as { code?: number; data?: { url?: string }; url?: string }
        if (data.data?.url) return data.data.url
        if (data.url) return data.url
      }
    } catch (e) {
      logger.warn('直接 API 调用失败:', (e as Error).message)
    }

    // 方法2: 如果有 vmCallHandler，尝试通过源脚本获取
    if (this.vmCallHandler) {
      try {
        const sourceInfo = this.sources[source]
        if (sourceInfo) {
          const requestInfo = {
            source,
            action: 'musicUrl',
            info: {
              type: sourceInfo.qualitys.includes('320k') ? '320k' : sourceInfo.qualitys[0],
              musicInfo: { songmid, name, singer: '', source }
            }
          }
          const result = await this.vmCallHandler(requestInfo)
          logger.info(`源脚本响应: ${typeof result}, ${JSON.stringify(result).substring(0, 200)}`)
          if (typeof result === 'string' && result.startsWith('http')) return result
          if (result && typeof result === 'object' && (result as { url?: string }).url) {
            return (result as { url: string }).url
          }
        }
      } catch (e) {
        logger.warn('源脚本调用失败:', (e as Error).message)
      }
    }

    logger.error('所有获取音乐URL的方法都失败了')
    return null
  }

  /**
   * 获取歌词
   */
  async getLyric(songmid: string, name: string): Promise<string> {
    if (!this.loaded || !this.vmCallHandler) return ''

    try {
      const requestInfo = {
        source: this.defaultSourceKey,
        action: 'lyric',
        info: {
          musicInfo: {
            songmid,
            name,
            singer: '',
            source: this.defaultSourceKey
          }
        }
      }

      const result = await this.vmCallHandler(requestInfo)

      if (result && typeof result === 'object') {
        const lyricData = result as { lyric?: string; tlyric?: string }
        return lyricData.lyric || ''
      }
      return typeof result === 'string' ? result : ''
    } catch {
      return ''
    }
  }

  /**
   * 获取封面图片URL
   */
  async getPic(songmid: string, name: string): Promise<string> {
    if (!this.loaded || !this.vmCallHandler) return ''

    try {
      const requestInfo = {
        source: this.defaultSourceKey,
        action: 'pic',
        info: {
          musicInfo: {
            songmid,
            name,
            singer: '',
            source: this.defaultSourceKey
          }
        }
      }

      const result = await this.vmCallHandler(requestInfo)

      return typeof result === 'string' ? result : ''
    } catch {
      return ''
    }
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getSourceInfo(): SourceScriptInfo | null {
    return this.sourceInfo
  }

  getSupportedSources(): Record<string, { name: string; actions: string[]; qualitys: string[] }> {
    return { ...this.sources }
  }

  setDefaultSource(source: string): void {
    this.defaultSourceKey = source
  }
}
