// src/main/notification/NotificationWindow.ts
// 灵动岛通知窗口 — 独立的 always-on-top 窗口，用于显示主动消息

import { BrowserWindow, screen, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

interface ScreenSettings {
  screenEnabled: boolean
  screenWidth: number
  screenHeight: number
  screenStaySeconds: number
  screenFontSize: number
  screenFontColor: string
  screenBgColor: string
}

const DEFAULT_SCREEN_SETTINGS: ScreenSettings = {
  screenEnabled: true,
  screenWidth: 400,
  screenHeight: 80,
  screenStaySeconds: 5,
  screenFontSize: 14,
  screenFontColor: '#1a1a1a',
  screenBgColor: 'rgba(255, 255, 255, 0.95)',
}

export class NotificationWindow {
  private window: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null
  private isVisible = false
  private pageReady = false
  private pendingShow: { characterName: string; content: string; avatar?: string; duration?: number } | null = null
  private cachedIconDataUrl: string = ''

  private getIconDataUrl(): string {
    if (this.cachedIconDataUrl) return this.cachedIconDataUrl
    // 打包后资源在 app.asar 同级的 resources 目录，开发时在项目根目录
    const possibleIconPaths = [
      join(__dirname, '../../resources/icon.png'),           // dev: out/main → resources
      join(process.cwd(), 'resources/icon.png'),             // dev fallback
      join(process.resourcesPath, 'icon.png'),               // packaged: resources/
      join(process.resourcesPath, '../icon.png'),            // packaged fallback
    ]
    for (const p of possibleIconPaths) {
      if (existsSync(p)) {
        this.cachedIconDataUrl = `data:image/png;base64,${readFileSync(p).toString('base64')}`
        logger.info(`[NotificationWindow] 图标加载成功: ${p}`)
        return this.cachedIconDataUrl
      }
    }
    logger.warn('[NotificationWindow] 未找到应用图标')
    return ''
  }

  private loadSettings(): ScreenSettings {
    try {
      const settingsPath = join(PATHS.base, 'notification-settings.json')
      if (existsSync(settingsPath)) {
        const data = readFileSync(settingsPath, 'utf-8')
        return { ...DEFAULT_SCREEN_SETTINGS, ...JSON.parse(data) }
      }
    } catch {}
    return DEFAULT_SCREEN_SETTINGS
  }

  create(): void {
    if (this.window) return

    this.pageReady = false
    const settings = this.loadSettings()
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize

    const windowWidth = settings.screenWidth || 400
    const windowHeight = settings.screenHeight || 80

    this.window = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: Math.floor((screenWidth - windowWidth) / 2),
      y: 5,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    const notificationPath = join(__dirname, '../renderer/notification.html')
    this.window.loadFile(notificationPath)

    this.window.webContents.on('did-finish-load', () => {
      this.pageReady = true
      logger.info('[NotificationWindow] 页面加载完成')
      // 如果有待显示的通知，立即显示
      if (this.pendingShow) {
        const pending = this.pendingShow
        this.pendingShow = null
        this.doShow(pending.characterName, pending.content, pending.avatar, pending.duration)
      }
    })

    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      logger.error(`[NotificationWindow] 加载失败: ${errorCode} - ${errorDescription}`)
    })

    this.window.on('closed', () => {
      this.window = null
      this.pageReady = false
      this.isVisible = false
    })
  }

  show(characterName: string, content: string, avatar?: string, duration?: number): void {
    const settings = this.loadSettings()

    if (!settings.screenEnabled) return

    if (!this.window) {
      this.create()
    }

    // 页面还没加载完，排队等待
    if (!this.pageReady) {
      this.pendingShow = { characterName, content, avatar, duration }
      return
    }

    this.doShow(characterName, content, avatar, duration)
  }

  private doShow(characterName: string, content: string, avatar?: string, duration?: number): void {
    if (!this.window || this.window.isDestroyed()) return

    const settings = this.loadSettings()
    this.window.setSize(settings.screenWidth, settings.screenHeight)
    this.window.showInactive()
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.isVisible = true

    logger.info(`[NotificationWindow] 发送IPC: name=${characterName}`)

    const iconDataUrl = this.getIconDataUrl()

    this.window.webContents.send('notification:show', {
      characterName,
      content,
      avatar: avatar || '',
      iconDataUrl,
      timestamp: Date.now(),
      settings
    })

    const stayDuration = duration || (settings.screenStaySeconds * 1000)
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => this.hide(), stayDuration)

    logger.info(`[NotificationWindow] 已显示: ${characterName} - ${content.substring(0, 30)}`)
  }

  hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.window?.hide()
    this.isVisible = false
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    if (this.window) {
      this.window.destroy()
      this.window = null
    }
    this.isVisible = false
    this.pageReady = false
  }

  isShowing(): boolean {
    return this.isVisible
  }
}

let notificationWindow: NotificationWindow | null = null

export function getNotificationWindow(): NotificationWindow {
  if (!notificationWindow) {
    notificationWindow = new NotificationWindow()
  }
  return notificationWindow
}

function existsSync(path: string): boolean {
  try {
    require('fs').accessSync(path)
    return true
  } catch {
    return false
  }
}
