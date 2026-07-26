// src/main/utils/dataExport.ts
// 数据导出导入 — 支持角色数据备份和恢复

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'
import { PATHS } from './dataPath'

export interface ExportData {
  version: string
  exportedAt: string
  characters: Record<string, unknown>[]
  memories: Record<string, unknown>
  emotions: Record<string, unknown>
  moments: Record<string, unknown>
}

const DATA_DIR = PATHS.base

export class DataExporter {
  exportAll(): ExportData {
    const data: ExportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      characters: this.exportCharacters(),
      memories: this.exportDirectory('memories'),
      emotions: this.exportDirectory('emotions'),
      moments: this.exportDirectory('moments')
    }

    logger.info('数据导出完成')
    return data
  }

  exportToFile(filePath: string): void {
    const data = this.exportAll()
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    logger.info(`数据导出到: ${filePath}`)
  }

  importFromFile(filePath: string): void {
    if (!existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    const content = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content) as ExportData

    if (!data.version || !data.characters) {
      throw new Error('无效的备份文件格式')
    }

    // 恢复数据
    this.importCharacters(data.characters)
    this.importDirectory('memories', data.memories)
    this.importDirectory('emotions', data.emotions)
    this.importDirectory('moments', data.moments)

    logger.info(`数据导入完成: version=${data.version}`)
  }

  private exportCharacters(): Record<string, unknown>[] {
    const charactersDir = join(DATA_DIR, 'characters')
    if (!existsSync(charactersDir)) return []

    const characters: Record<string, unknown>[] = []
    const dirs = readdirSync(charactersDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    for (const dir of dirs) {
      const configPath = join(charactersDir, dir, 'config.yaml')
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8')
          characters.push(JSON.parse(content))
        } catch {
          // 跳过损坏的配置
        }
      }
    }

    return characters
  }

  private exportDirectory(name: string): Record<string, unknown> {
    const dir = join(DATA_DIR, name)
    if (!existsSync(dir)) return {}

    const result: Record<string, unknown> = {}
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8')
      result[file.replace('.json', '')] = JSON.parse(content)
    }

    return result
  }

  private importCharacters(characters: Record<string, unknown>[]): void {
    const charactersDir = join(DATA_DIR, 'characters')
    if (!existsSync(charactersDir)) {
      mkdirSync(charactersDir, { recursive: true })
    }

    for (const char of characters) {
      if (char.id) {
        const charDir = join(charactersDir, String(char.id))
        if (!existsSync(charDir)) {
          mkdirSync(charDir, { recursive: true })
        }
        writeFileSync(join(charDir, 'config.yaml'), JSON.stringify(char, null, 2))
      }
    }
  }

  private importDirectory(name: string, data: Record<string, unknown>): void {
    const dir = join(DATA_DIR, name)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    for (const [key, value] of Object.entries(data)) {
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(value, null, 2))
    }
  }
}
