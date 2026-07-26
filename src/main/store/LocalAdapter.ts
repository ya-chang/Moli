// src/main/store/LocalAdapter.ts
// 本地存储适配器 — 异步文件 I/O，不阻塞主进程

import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { SyncAdapter, MergeResult, TableMergeStrategy } from './SyncAdapter'
import { DEFAULT_MERGE_STRATEGY } from './SyncAdapter'
import { PATHS } from '../utils/dataPath'

const DATA_DIR = join(PATHS.base, 'sync')

export class LocalAdapter implements SyncAdapter {
  private mergeStrategy: TableMergeStrategy

  constructor(strategy?: TableMergeStrategy) {
    this.mergeStrategy = strategy || DEFAULT_MERGE_STRATEGY
    this.ensureDataDir().catch(() => {})
  }

  async save(table: string, data: Record<string, unknown>): Promise<void> {
    const filePath = this.getFilePath(table)
    const existing = await this.load(table)

    const index = existing.findIndex((item) => item.id === data.id)
    if (index >= 0) {
      existing[index] = { ...existing[index], ...data, updated_at: new Date().toISOString() }
    } else {
      existing.push({ ...data, created_at: new Date().toISOString(), sync_status: 'local' })
    }

    await writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8')
  }

  async load(table: string, query?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const filePath = this.getFilePath(table)

    try {
      await access(filePath)
    } catch {
      return []
    }

    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content) as Record<string, unknown>[]

      if (!query) return data

      return data.filter((item) =>
        Object.entries(query).every(([key, value]) => item[key] === value)
      )
    } catch {
      return []
    }
  }

  async delete(table: string, id: string): Promise<void> {
    const filePath = this.getFilePath(table)

    try {
      await access(filePath)
    } catch {
      return
    }

    const data = await this.load(table)
    const filtered = data.filter((item) => item.id !== id)
    await writeFile(filePath, JSON.stringify(filtered, null, 2), 'utf-8')
  }

  async merge(table: string, remote: Record<string, unknown>[]): Promise<MergeResult> {
    const strategy = this.mergeStrategy[table] || 'merge'
    const local = await this.load(table)

    const result: MergeResult = { added: 0, updated: 0, skipped: 0, conflicts: [] }

    for (const remoteItem of remote) {
      const localIndex = local.findIndex((item) => item.id === remoteItem.id)

      if (localIndex < 0) {
        local.push({ ...remoteItem, sync_status: 'synced' })
        result.added++
        continue
      }

      const localItem = local[localIndex]
      const localTime = new Date(localItem.updated_at as string || 0).getTime()
      const remoteTime = new Date(remoteItem.updated_at as string || 0).getTime()

      switch (strategy) {
        case 'append':
          result.skipped++
          break
        case 'merge':
          if (localTime < remoteTime) {
            local[localIndex] = { ...remoteItem, sync_status: 'synced' }
            result.updated++
          } else {
            result.skipped++
          }
          break
        case 'take_newer':
          if (remoteTime > localTime) {
            local[localIndex] = { ...remoteItem, sync_status: 'synced' }
            result.updated++
          } else {
            result.skipped++
          }
          break
        case 'ask_user':
          result.conflicts.push(localItem.id as string)
          break
      }
    }

    await writeFile(this.getFilePath(table), JSON.stringify(local, null, 2), 'utf-8')
    return result
  }

  private getFilePath(table: string): string {
    return join(DATA_DIR, `${table}.json`)
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await access(DATA_DIR)
    } catch {
      await mkdir(DATA_DIR, { recursive: true })
    }
  }
}
