// src/main/knowledge/KnowledgeManager.ts
// 知识库管理器 — 每个角色 5 个 MD 文件的读写
// SQLite 是原料库，MD 文件是 SQLite 的下游产物

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

const DATA_ROOT = PATHS.characters

// ========== 结构化记忆类型定义 ==========

export interface StructuredMemory {
  // L1 核心记忆（永远注入）
  l1_core: {
    name: string
    role: string
    core_personality: string[]
    speech_style: string
    relationship_start: string
  }
  // L2 重要记忆（按话题注入）
  l2_important: {
    preferences: Record<string, {
      likes: string[]
      dislikes: string[]
      weight: 'high' | 'medium' | 'low'
      lastMentioned: string
    }>
    key_events: Array<{
      date: string
      event: string
      details: string
      emotional_weight: 'high' | 'medium' | 'low'
      lastMentioned: string
    }>
    taboos: string[]
    milestones: string[]
  }
}

export const DEFAULT_STRUCTURED_MEMORY: StructuredMemory = {
  l1_core: {
    name: '',
    role: '女朋友',
    core_personality: [],
    speech_style: '',
    relationship_start: ''
  },
  l2_important: {
    preferences: {},
    key_events: [],
    taboos: [],
    milestones: []
  }
}

export interface KnowledgeFiles {
  persona: string          // 人设档案（只读，用户手动改）
  userProfile: string      // 用户画像（模型自动提取）
  chatSummary: string      // 对话摘要（模型自动压缩）
  styleLearning: string    // 风格学习（模型自动学习）
  chatLogs: string         // 聊天记录归档（给人看）
}

export class KnowledgeManager {
  private characterId: string
  private knowledgeDir: string
  private cache: Map<string, string> = new Map()

  constructor(characterId: string) {
    this.characterId = characterId
    this.knowledgeDir = join(DATA_ROOT, characterId, 'knowledge')
    this.ensureDir()
  }

  // ========== 读取 ==========

  /** 读取人设档案 */
  readPersona(): string {
    return this.readFile('persona.md')
  }

  /** 读取用户画像 */
  readUserProfile(): string {
    return this.readFile('user_profile.md')
  }

  /** 读取对话摘要 */
  readChatSummary(): string {
    return this.readFile('chat_summary.md')
  }

  /** 读取风格学习 */
  readStyleLearning(): string {
    return this.readFile('style_learning.md')
  }

  /** 读取聊天记录归档 */
  readChatLogs(): string {
    return this.readFile('chat_logs.md')
  }

  /** 读取全部知识文件，返回合并内容供 Prompt 注入 */
  readAll(): KnowledgeFiles {
    return {
      persona: this.readPersona(),
      userProfile: this.readUserProfile(),
      chatSummary: this.readChatSummary(),
      styleLearning: this.readStyleLearning(),
      chatLogs: this.readChatLogs()
    }
  }

  // ========== 写入 ==========

  /** 写入人设档案（用户手动触发） */
  writePersona(content: string): void {
    this.writeFile('persona.md', content)
    logger.info(`角色 ${this.characterId} 人设档案已更新`)
  }

  /** 写入用户画像（模型自动提取） */
  writeUserProfile(content: string): void {
    this.writeFile('user_profile.md', content)
    logger.info(`角色 ${this.characterId} 用户画像已更新`)
  }

  /** 写入对话摘要（模型自动压缩） */
  writeChatSummary(content: string): void {
    this.writeFile('chat_summary.md', content)
    logger.info(`角色 ${this.characterId} 对话摘要已更新`)
  }

  /** 写入风格学习（模型自动学习） */
  writeStyleLearning(content: string): void {
    this.writeFile('style_learning.md', content)
    logger.info(`角色 ${this.characterId} 风格学习已更新`)
  }

  // ========== 归档 ==========

  /** 读取归档文件 */
  readArchive(name: string): string {
    return this.readFile(`archive_${name}.md`)
  }

  /** 追加到归档文件 */
  appendArchive(name: string, content: string): void {
    const filePath = this.getFilePath(`archive_${name}.md`)
    const header = `\n---\n> ${new Date().toLocaleDateString('zh-CN')} 归档\n\n`
    appendFileSync(filePath, header + content + '\n', 'utf-8')
    this.cache.delete(`archive_${name}.md`)
  }

  // ========== 结构化记忆 ==========

  /** 读取结构化记忆 */
  readStructuredMemory(): StructuredMemory {
    const filePath = this.getFilePath('structured_memory.json')
    if (!existsSync(filePath)) {
      return { ...DEFAULT_STRUCTURED_MEMORY }
    }
    try {
      const content = readFileSync(filePath, 'utf-8')
      return { ...DEFAULT_STRUCTURED_MEMORY, ...JSON.parse(content) }
    } catch {
      return { ...DEFAULT_STRUCTURED_MEMORY }
    }
  }

  /** 写入结构化记忆 */
  writeStructuredMemory(memory: StructuredMemory): void {
    const filePath = this.getFilePath('structured_memory.json')
    writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8')
  }

  /** 更新 L2 偏好 */
  updatePreference(category: string, likes: string[], dislikes: string[]): void {
    const memory = this.readStructuredMemory()
    memory.l2_important.preferences[category] = {
      likes,
      dislikes,
      weight: 'high',
      lastMentioned: new Date().toISOString()
    }
    this.writeStructuredMemory(memory)
  }

  /** 添加重要事件 */
  addKeyEvent(event: string, details: string, emotionalWeight: 'high' | 'medium' | 'low' = 'medium'): void {
    const memory = this.readStructuredMemory()
    memory.l2_important.key_events.push({
      date: new Date().toISOString().split('T')[0],
      event,
      details,
      emotional_weight: emotionalWeight,
      lastMentioned: new Date().toISOString()
    })
    // 只保留最近 30 个事件
    if (memory.l2_important.key_events.length > 30) {
      memory.l2_important.key_events = memory.l2_important.key_events.slice(-30)
    }
    this.writeStructuredMemory(memory)
  }

  /** 添加禁忌 */
  addTaboo(taboo: string): void {
    const memory = this.readStructuredMemory()
    if (!memory.l2_important.taboos.includes(taboo)) {
      memory.l2_important.taboos.push(taboo)
      this.writeStructuredMemory(memory)
    }
  }

  /** 更新记忆的最后提及时间 */
  touchMemory(category: string): void {
    const memory = this.readStructuredMemory()
    if (memory.l2_important.preferences[category]) {
      memory.l2_important.preferences[category].lastMentioned = new Date().toISOString()
      this.writeStructuredMemory(memory)
    }
  }

  /** 追加聊天记录（每 10 条消息） */
  appendChatLog(entry: string): void {
    const filePath = this.getFilePath('chat_logs.md')
    appendFileSync(filePath, entry + '\n', 'utf-8')
    this.cache.delete('chat_logs.md')
  }

  // ========== 初始化 ==========

  /** 创建角色时初始化空文件 */
  initEmpty(): void {
    const files: Array<[string, string]> = [
      ['persona.md', '# 人设档案\n\n> 在设置页面编辑角色人设\n'],
      ['user_profile.md', '# 用户画像\n\n> AI 会自动从对话中提取关于你的信息\n\n## 基本信息\n\n## 喜好\n\n## 重要事件\n'],
      ['chat_summary.md', '# 对话摘要\n\n> AI 会自动压缩旧对话，保留脉络\n'],
      ['style_learning.md', '# 风格学习记录\n\n## 用户偏好（自动学习）\n\n## 反馈历史\n'],
      ['chat_logs.md', '# 聊天记录归档\n\n> 给人看的备份，不参与检索\n']
    ]

    for (const [filename, content] of files) {
      const filePath = this.getFilePath(filename)
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8')
      }
    }

    // 初始化结构化记忆
    const structPath = this.getFilePath('structured_memory.json')
    if (!existsSync(structPath)) {
      writeFileSync(structPath, JSON.stringify(DEFAULT_STRUCTURED_MEMORY, null, 2), 'utf-8')
    }
  }

  // ========== 缓存 ==========

  /** 清除缓存（MD 文件被外部修改时调用） */
  invalidateCache(): void {
    this.cache.clear()
  }

  // ========== 内部方法 ==========

  private readFile(filename: string): string {
    const cacheKey = filename
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    const filePath = this.getFilePath(filename)
    if (!existsSync(filePath)) {
      return ''
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      this.cache.set(cacheKey, content)
      return content
    } catch (error) {
      logger.error(`读取知识文件失败: ${filePath}`, error)
      return ''
    }
  }

  private writeFile(filename: string, content: string): void {
    const filePath = this.getFilePath(filename)
    writeFileSync(filePath, content, 'utf-8')
    this.cache.set(filename, content)
  }

  private getFilePath(filename: string): string {
    return join(this.knowledgeDir, filename)
  }

  private ensureDir(): void {
    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true })
    }
  }
}
