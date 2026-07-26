// src/main/social/MomentsManager.ts
// 朋友圈管理器 — 发布、点赞、评论、时间伪装

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

export interface Moment {
  id: string
  characterId: string
  content: string
  images: string[]
  mood: string
  likes: string[]
  comments: MomentComment[]
  displayTime: string
  createdAt: string
}

export interface MomentComment {
  id: string
  author: string
  content: string
  createdAt: string
}

const DATA_DIR = PATHS.moments

export class MomentsManager {
  private moments: Moment[] = []
  private characterId: string

  constructor(characterId: string) {
    this.characterId = characterId
    this.load()
  }

  // 发布朋友圈（带时间伪装）
  publish(content: string, images: string[] = [], mood: string = '日常'): Moment {
    const now = new Date()
    // 日常类：时间戳设为过去1-4小时内随机
    const hoursAgo = 1 + Math.random() * 3
    const displayTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)

    const moment: Moment = {
      id: `moment_${Date.now()}`,
      characterId: this.characterId,
      content,
      images,
      mood,
      likes: [],
      comments: [],
      displayTime: displayTime.toISOString(),
      createdAt: now.toISOString()
    }

    this.moments.unshift(moment)
    this.save()
    logger.info(`朋友圈发布: id=${moment.id}`)
    return moment
  }

  // 点赞
  like(momentId: string, userId: string): void {
    const moment = this.moments.find((m) => m.id === momentId)
    if (moment && !moment.likes.includes(userId)) {
      moment.likes.push(userId)
      this.save()
    }
  }

  // 取消点赞
  unlike(momentId: string, userId: string): void {
    const moment = this.moments.find((m) => m.id === momentId)
    if (moment) {
      moment.likes = moment.likes.filter((id) => id !== userId)
      this.save()
    }
  }

  // 评论
  comment(momentId: string, author: string, content: string): MomentComment {
    const moment = this.moments.find((m) => m.id === momentId)
    if (!moment) {
      throw new Error(`朋友圈不存在: ${momentId}`)
    }

    const comment: MomentComment = {
      id: `comment_${Date.now()}`,
      author,
      content,
      createdAt: new Date().toISOString()
    }

    moment.comments.push(comment)
    this.save()
    return comment
  }

  // 获取朋友圈列表
  getAll(): Moment[] {
    return [...this.moments].sort(
      (a, b) => new Date(b.displayTime).getTime() - new Date(a.displayTime).getTime()
    )
  }

  // 获取单条朋友圈
  get(momentId: string): Moment | undefined {
    return this.moments.find((m) => m.id === momentId)
  }

  // 删除朋友圈
  delete(momentId: string): void {
    this.moments = this.moments.filter((m) => m.id !== momentId)
    this.save()
  }

  private save(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }
    const filePath = join(DATA_DIR, `${this.characterId}.json`)
    writeFileSync(filePath, JSON.stringify(this.moments, null, 2), 'utf-8')
  }

  private load(): void {
    const filePath = join(DATA_DIR, `${this.characterId}.json`)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        this.moments = JSON.parse(content)
      } catch {
        this.moments = []
      }
    }
  }
}
