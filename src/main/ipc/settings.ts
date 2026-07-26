// src/main/ipc/settings.ts
// 设置 IPC 处理器 — 主题切换 + 数据导出导入 + 用户配置持久化

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ThemeManager } from '../utils/theme'
import { DataExporter } from '../utils/dataExport'
import { PATHS } from '../utils/dataPath'
import { logger } from '../utils/logger'

const themeManager = new ThemeManager()
const dataExporter = new DataExporter()

// ─── 用户配置持久化（替代 localStorage） ───

interface UserProfile {
  avatar: string
  name: string
}

interface AppSettings {
  theme?: string
  fontSize?: number
  sourceUrl?: string
  notificationSettings?: Record<string, unknown>
}

const getGlobalDir = (): string => {
  const dir = join(PATHS.base, 'global')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const getUserProfilePath = (): string => join(getGlobalDir(), 'user_profile.json')
const getAppSettingsPath = (): string => join(getGlobalDir(), 'app_settings.json')

// 保存用户配置（头像 + 名字）
const saveUserProfile = (profile: UserProfile): void => {
  writeFileSync(getUserProfilePath(), JSON.stringify(profile, null, 2), 'utf-8')
}

// 加载用户配置
const loadUserProfile = (): UserProfile => {
  try {
    const filePath = getUserProfilePath()
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    logger.error('加载用户配置失败', err)
  }
  return { avatar: '👤', name: '' }
}

// 保存应用设置
const saveAppSettings = (settings: AppSettings): void => {
  const filePath = getAppSettingsPath()
  let existing: AppSettings = {}
  try {
    if (existsSync(filePath)) {
      existing = JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch { /* ignore */ }
  const merged = { ...existing, ...settings }
  writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
}

// 加载应用设置
const loadAppSettings = (): AppSettings => {
  try {
    const filePath = getAppSettingsPath()
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    logger.error('加载应用设置失败', err)
  }
  return {}
}

// ─── KV 存储 ───
import { IPC_CHANNELS } from '../../shared/ipc-channels'

let kvCache: Record<string, unknown> | null = null
const kvPath = () => join(getGlobalDir(), 'kv_store.json')

const loadKV = (): Record<string, unknown> => {
  if (kvCache) return kvCache
  try {
    if (existsSync(kvPath())) {
      kvCache = JSON.parse(readFileSync(kvPath(), 'utf-8'))
      return kvCache!
    }
  } catch { /* ignore */ }
  kvCache = {}
  return kvCache!
}

const saveKV = (): void => {
  if (!kvCache) return
  try { writeFileSync(kvPath(), JSON.stringify(kvCache, null, 2), 'utf-8') } catch { /* ignore */ }
}

export const registerSettingsIPC = (): void => {
  // ─── 用户配置 IPC ───
  ipcMain.handle('user:loadProfile', () => {
    return loadUserProfile()
  })

  ipcMain.handle('user:saveProfile', (_event, params: { avatar?: string; name?: string }) => {
    try {
      const profile = loadUserProfile()
      if (params.avatar !== undefined) profile.avatar = params.avatar
      if (params.name !== undefined) profile.name = params.name
      saveUserProfile(profile)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // ─── 应用设置 IPC ───
  ipcMain.handle('settings:load', () => {
    return loadAppSettings()
  })

  ipcMain.handle('settings:save', (_event, params: AppSettings) => {
    try {
      saveAppSettings(params)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 获取当前主题
  ipcMain.handle('theme:get', () => {
    return {
      name: themeManager.getTheme(),
      variables: themeManager.getThemeVariables()
    }
  })

  // 设置主题
  ipcMain.handle('theme:set', (_event, params: { name: string }) => {
    try {
      themeManager.setTheme(params.name as 'default' | 'dark' | 'pink')
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 获取可用主题列表
  ipcMain.handle('theme:list', () => {
    return themeManager.getAvailableThemes()
  })

  // ─── KV 存储 IPC ───
  ipcMain.handle(IPC_CHANNELS.KV_GET, (_event, key: string) => {
    return loadKV()[key] ?? null
  })

  ipcMain.handle(IPC_CHANNELS.KV_SET, (_event, key: string, value: unknown) => {
    const store = loadKV()
    store[key] = value
    saveKV()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.KV_DELETE, (_event, key: string) => {
    const store = loadKV()
    delete store[key]
    saveKV()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.KV_GET_ALL, () => {
    return { ...loadKV() }
  })

  // 导出数据
  ipcMain.handle('data:export', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(window!, {
      title: '导出数据',
      defaultPath: `wechat-ai-lover-backup-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (!result.canceled && result.filePath) {
      try {
        dataExporter.exportToFile(result.filePath)
        return { success: true, path: result.filePath }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误'
        logger.error(`数据导出失败: ${errMsg}`)
        return { success: false, error: errMsg }
      }
    }
    return { success: false, error: '用户取消' }
  })

  // 导入数据
  ipcMain.handle('data:import', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      title: '导入数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      try {
        dataExporter.importFromFile(result.filePaths[0])
        return { success: true }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误'
        logger.error(`数据导入失败: ${errMsg}`)
        return { success: false, error: errMsg }
      }
    }
    return { success: false, error: '用户取消' }
  })

  // 选择数据目录
  ipcMain.handle('data:chooseDir', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      title: '选择数据存放目录',
      properties: ['openDirectory', 'createDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] }
    }
    return { success: false, error: '用户取消' }
  })

  // 获取数据目录路径
  ipcMain.handle('data:getPath', () => {
    return PATHS.base
  })

  // 调度器时间更新（早安/晚安通知时间）
  ipcMain.on('scheduler:update-time', (_event, params: { type: string; hour: number; minute: number }) => {
    try {
      const fs = require('fs')
      const settingsPath = join(PATHS.base, 'notification-settings.json')
      let settings: Record<string, unknown> = {}
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch {}
      if (params.type === 'morning') {
        settings.morningHour = params.hour
        settings.morningMinute = params.minute
      } else if (params.type === 'night') {
        settings.nightHour = params.hour
        settings.nightMinute = params.minute
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      logger.info(`[Scheduler] 更新${params.type}时间: ${params.hour}:${params.minute}`)
    } catch (err) {
      logger.error('更新调度器时间失败', err)
    }
  })
}