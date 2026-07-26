// src/main/utils/dataPath.ts
// 统一数据路径管理

import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

// 开发用 cwd/data，打包用 userData
const getBaseDir = (): string => {
  try {
    if (app && app.isPackaged) {
      return app.getPath('userData')
    }
  } catch {}
  return join(process.cwd(), 'data')
}

interface AppSettings {
  dataDir: string
  theme: string
  fontSize: number
}

const loadSettings = (): AppSettings => {
  try {
    const settingsFile = join(getBaseDir(), 'global', 'settings.json')
    if (existsSync(settingsFile)) {
      return JSON.parse(readFileSync(settingsFile, 'utf-8'))
    }
  } catch {}
  return { dataDir: '', theme: 'default', fontSize: 14 }
}

const saveSettings = (settings: AppSettings): void => {
  try {
    const dir = join(getBaseDir(), 'global')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(getBaseDir(), 'global', 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
  } catch {}
}

export const getDataDir = (): string => {
  const settings = loadSettings()
  return settings.dataDir || getBaseDir()
}

export const getSubDir = (subdir: string): string => {
  const dataDir = getDataDir()
  const fullPath = join(dataDir, subdir)
  if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true })
  return fullPath
}

export const getLogDir = (): string => {
  const logDir = join(getBaseDir(), 'logs')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  return logDir
}

export const PATHS = {
  get base() { return getBaseDir() },
  get avatars() { return getSubDir('avatars') },
  get characters() { return getSubDir('characters') },
  get memories() { return getSubDir('memories') },
  get emotions() { return getSubDir('emotions') },
  get moments() { return getSubDir('moments') },
  get logs() { return getLogDir() },
}
