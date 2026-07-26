// src/main/memory/LongTerm.ts
// 长期记忆 — 关键信息存储（带分级）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MemoryGrader, type MemoryGrade } from './MemoryGrader'
import { PATHS } from '../utils/dataPath'

export interface LongTermMemory {
  id: string
  content: string
  grade: MemoryGrade
  importance: number
  createdAt: string
}

const DATA_DIR = PATHS.memories

export class LongTerm {
  private memories: LongTermMemory[] = []
  private grader = new MemoryGrader()

  constructor(characterId: string) {
    this.load(characterId)
  }

  add(content: string): LongTermMemory {
    const { grade, importance } = this.grader.grade(content)
    const memory: LongTermMemory = {
      id: `mem_${Date.now()}`,
      content,
      grade,
      importance,
      createdAt: new Date().toISOString()
    }
    this.memories.push(memory)
    return memory
  }

  search(query: string, limit: number = 5): LongTermMemory[] {
    const lowerQuery = query.toLowerCase()
    return this.memories
      .filter((m) => m.content.toLowerCase().includes(lowerQuery))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
  }

  getByGrade(grade: MemoryGrade): LongTermMemory[] {
    return this.memories.filter((m) => m.grade === grade)
  }

  getAll(): LongTermMemory[] {
    return [...this.memories]
  }

  private load(characterId: string): void {
    const filePath = join(DATA_DIR, `${characterId}.json`)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        this.memories = JSON.parse(content)
      } catch {
        this.memories = []
      }
    }
  }

  save(characterId: string): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }
    const filePath = join(DATA_DIR, `${characterId}.json`)
    writeFileSync(filePath, JSON.stringify(this.memories, null, 2), 'utf-8')
  }
}
