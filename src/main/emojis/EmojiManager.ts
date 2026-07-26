// src/main/emojis/EmojiManager.ts
// 表情包管理核心 — 上传/删除/存储

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export interface EmojiMeta {
  id: string
  file: string
  originalName: string
  tags: string[]
  emotion: string
  usageCount: number
  lastUsed: string | null
  addedAt: string
}

export interface EmojiConfig {
  maxCount: number
  maxSize: number
  frequencyMode: 'follow_user' | 'every_message' | 'random'
}

export interface EmojiStats {
  totalMessages: number
  emojiMessages: number
  userEmojiRatio: number
}

export interface EmojiData {
  emojis: EmojiMeta[]
  config: EmojiConfig
  stats: EmojiStats
}

export class EmojiManager {
  private dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  /**
   * 上传表情包
   */
  async upload(
    characterId: string,
    filePath: string,
    tags: string[],
    emotion: string
  ): Promise<EmojiMeta> {
    const emojisDir = path.join(this.dataDir, 'characters', characterId, 'emojis')
    fs.mkdirSync(emojisDir, { recursive: true })

    // 检查数量限制
    const meta = this.loadMeta(characterId)
    if (meta.emojis.length >= meta.config.maxCount) {
      throw new Error(`表情包数量已达上限（${meta.config.maxCount}个）`)
    }

    // 检查文件大小
    const stat = fs.statSync(filePath)
    if (stat.size > meta.config.maxSize) {
      throw new Error(`文件太大，最大${meta.config.maxSize / 1024 / 1024}MB`)
    }

    // 检查格式
    const ext = path.extname(filePath).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      throw new Error('不支持的格式，只支持 png/jpg/webp')
    }

    // 复制文件
    const id = crypto.randomUUID()
    const destPath = path.join(emojisDir, `${id}${ext}`)
    fs.copyFileSync(filePath, destPath)

    // 保存元数据
    const emoji: EmojiMeta = {
      id,
      file: `${id}${ext}`,
      originalName: path.basename(filePath),
      tags,
      emotion,
      usageCount: 0,
      lastUsed: null,
      addedAt: new Date().toISOString()
    }

    meta.emojis.push(emoji)
    this.saveMeta(characterId, meta)

    return emoji
  }

  /**
   * 通过 base64 数据上传表情包（带完整校验）
   */
  uploadFromData(
    characterId: string,
    fileName: string,
    fileData: string,
    tags: string[],
    emotion: string
  ): EmojiMeta {
    const emojisDir = path.join(this.dataDir, 'characters', characterId, 'emojis')
    fs.mkdirSync(emojisDir, { recursive: true })

    const meta = this.loadMeta(characterId)

    // 校验数量
    if (meta.emojis.length >= meta.config.maxCount) {
      throw new Error(`表情包数量已达上限（${meta.config.maxCount}个）`)
    }

    const ext = path.extname(fileName).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      throw new Error('不支持的格式，只支持 png/jpg/webp')
    }

    const buffer = Buffer.from(fileData, 'base64')

    // 校验大小
    if (buffer.length > meta.config.maxSize) {
      throw new Error(`文件太大，最大${meta.config.maxSize / 1024 / 1024}MB`)
    }

    const id = crypto.randomUUID()
    const destPath = path.join(emojisDir, `${id}${ext}`)
    fs.writeFileSync(destPath, buffer)

    const emoji: EmojiMeta = {
      id,
      file: `${id}${ext}`,
      originalName: fileName,
      tags,
      emotion,
      usageCount: 0,
      lastUsed: null,
      addedAt: new Date().toISOString()
    }

    meta.emojis.push(emoji)
    this.saveMeta(characterId, meta)

    return emoji
  }

  /**
   * 删除表情包
   */
  delete(characterId: string, emojiId: string): void {
    const meta = this.loadMeta(characterId)
    const emoji = meta.emojis.find(e => e.id === emojiId)
    if (!emoji) return

    // 删除文件
    const filePath = path.join(this.dataDir, 'characters', characterId, 'emojis', emoji.file)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除元数据
    meta.emojis = meta.emojis.filter(e => e.id !== emojiId)
    this.saveMeta(characterId, meta)
  }

  /**
   * 获取所有表情包
   */
  getAll(characterId: string): EmojiMeta[] {
    return this.loadMeta(characterId).emojis
  }

  /**
   * 获取表情包文件路径
   */
  getFilePath(characterId: string, emojiId: string): string | null {
    const meta = this.loadMeta(characterId)
    const emoji = meta.emojis.find(e => e.id === emojiId)
    if (!emoji) return null
    return path.join(this.dataDir, 'characters', characterId, 'emojis', emoji.file)
  }

  /**
   * 更新表情包使用次数
   */
  updateUsage(characterId: string, emojiId: string): void {
    const meta = this.loadMeta(characterId)
    const emoji = meta.emojis.find(e => e.id === emojiId)
    if (!emoji) return

    emoji.usageCount++
    emoji.lastUsed = new Date().toISOString()
    this.saveMeta(characterId, meta)
  }

  /**
   * 获取配置
   */
  getConfig(characterId: string): EmojiConfig {
    return this.loadMeta(characterId).config
  }

  /**
   * 更新配置
   */
  updateConfig(characterId: string, config: Partial<EmojiConfig>): void {
    const meta = this.loadMeta(characterId)
    meta.config = { ...meta.config, ...config }
    this.saveMeta(characterId, meta)
  }

  /**
   * 更新统计数据
   */
  updateStats(characterId: string, isEmoji: boolean): void {
    const meta = this.loadMeta(characterId)
    meta.stats.totalMessages++
    if (isEmoji) {
      meta.stats.emojiMessages++
    }
    meta.stats.userEmojiRatio = meta.stats.totalMessages > 0
      ? meta.stats.emojiMessages / meta.stats.totalMessages
      : 0
    this.saveMeta(characterId, meta)
  }

  /**
   * 获取统计数据
   */
  getStats(characterId: string): EmojiStats {
    return this.loadMeta(characterId).stats
  }

  private loadMeta(characterId: string): EmojiData {
    const metaPath = path.join(this.dataDir, 'characters', characterId, 'emojis', 'meta.json')
    if (!fs.existsSync(metaPath)) {
      return {
        emojis: [],
        config: {
          maxCount: 50,
          maxSize: 5 * 1024 * 1024,
          frequencyMode: 'follow_user'
        },
        stats: {
          totalMessages: 0,
          emojiMessages: 0,
          userEmojiRatio: 0
        }
      }
    }
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  }

  private saveMeta(characterId: string, meta: EmojiData): void {
    const metaPath = path.join(this.dataDir, 'characters', characterId, 'emojis', 'meta.json')
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  }
}
