// src/main/utils/theme.ts
// 主题系统 — 支持默认/暗色/粉色主题

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'
import { PATHS } from './dataPath'

export type ThemeName = 'default' | 'dark' | 'pink'

export interface ThemeConfig {
  name: ThemeName
  variables: Record<string, string>
}

const THEMES: Record<ThemeName, ThemeConfig> = {
  default: {
    name: 'default',
    variables: {
      '--primary-color': '#07C160',
      '--bg-primary': '#FFFFFF',
      '--bg-secondary': '#EFEFEF',
      '--text-primary': '#000000',
      '--text-secondary': '#999999',
      '--border-color': '#E6E6E6',
      '--bubble-self': '#95EC69',
      '--bubble-other': '#FFFFFF',
      '--unread-badge': '#FA5151'
    }
  },
  dark: {
    name: 'dark',
    variables: {
      '--primary-color': '#07C160',
      '--bg-primary': '#1A1A1A',
      '--bg-secondary': '#2A2A2A',
      '--text-primary': '#E5E5E5',
      '--text-secondary': '#808080',
      '--border-color': '#3A3A3A',
      '--bubble-self': '#3EB575',
      '--bubble-other': '#3A3A3A',
      '--unread-badge': '#FA5151'
    }
  },
  pink: {
    name: 'pink',
    variables: {
      '--primary-color': '#FF6B9D',
      '--bg-primary': '#FFF5F8',
      '--bg-secondary': '#FFE8EE',
      '--text-primary': '#333333',
      '--text-secondary': '#999999',
      '--border-color': '#FFD6E0',
      '--bubble-self': '#FFB3D1',
      '--bubble-other': '#FFFFFF',
      '--unread-badge': '#FA5151'
    }
  }
}

const DATA_DIR = join(PATHS.base, 'global')
const CONFIG_FILE = join(DATA_DIR, 'settings.json')

export class ThemeManager {
  private currentTheme: ThemeName = 'default'

  constructor() {
    this.load()
  }

  getTheme(): ThemeName {
    return this.currentTheme
  }

  setTheme(name: ThemeName): void {
    if (!THEMES[name]) {
      throw new Error(`未知主题: ${name}`)
    }
    this.currentTheme = name
    this.save()
    logger.info(`主题切换: ${name}`)
  }

  getThemeConfig(): ThemeConfig {
    return THEMES[this.currentTheme]
  }

  getThemeVariables(): Record<string, string> {
    return THEMES[this.currentTheme].variables
  }

  getAvailableThemes(): Array<{ name: ThemeName; label: string }> {
    return [
      { name: 'default', label: '默认' },
      { name: 'dark', label: '暗色' },
      { name: 'pink', label: '粉色' }
    ]
  }

  private save(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    let settings: Record<string, unknown> = {}
    if (existsSync(CONFIG_FILE)) {
      try {
        settings = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
      } catch {
        settings = {}
      }
    }

    settings.theme = this.currentTheme
    writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8')
  }

  private load(): void {
    if (existsSync(CONFIG_FILE)) {
      try {
        const settings = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
        if (settings.theme && THEMES[settings.theme as ThemeName]) {
          this.currentTheme = settings.theme as ThemeName
        }
      } catch {
        this.currentTheme = 'default'
      }
    }
  }
}
