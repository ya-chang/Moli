// src/main/filter/BannedWordFilter.ts
// 禁词箱子 — 过滤AI回复中不能使用的词语

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

interface BannedWordConfig {
  word: string
  action: 'remove' | 'replace'
  replacement?: string
}

const DATA_DIR = join(PATHS.base, 'global')
const CONFIG_FILE = join(DATA_DIR, 'banned_words.json')

export class BannedWordFilter {
  private bannedWords: Map<string, BannedWordConfig> = new Map()

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(CONFIG_FILE)) {
        const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as BannedWordConfig[]
        for (const item of data) {
          this.bannedWords.set(item.word, item)
        }
      }
    } catch {
      // ignore
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true })
      }
      const data = Array.from(this.bannedWords.values())
      writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      logger.error('保存禁词配置失败', error)
    }
  }

  addWord(word: string, action: 'remove' | 'replace' = 'remove', replacement?: string): void {
    this.bannedWords.set(word, { word, action, replacement })
    this.save()
  }

  removeWord(word: string): void {
    this.bannedWords.delete(word)
    this.save()
  }

  getWords(): BannedWordConfig[] {
    return Array.from(this.bannedWords.values())
  }

  filter(response: string): string {
    let filtered = response

    for (const [word, config] of this.bannedWords) {
      if (filtered.includes(word)) {
        if (config.action === 'remove') {
          filtered = filtered.replace(new RegExp(word, 'g'), '')
        } else if (config.action === 'replace' && config.replacement) {
          filtered = filtered.replace(new RegExp(word, 'g'), config.replacement)
        }
      }
    }

    // 清理多余空格
    filtered = filtered.replace(/\s+/g, ' ').trim()
    return filtered
  }

  buildPromptSection(): string {
    const words = Array.from(this.bannedWords.keys())
    if (words.length === 0) return ''

    return `\n## 禁止使用的词语\n在你的回复中，绝对不要使用以下词语：${words.join('、')}\n如果需要用类似意思的词，用其他表达替代。`
  }
}
