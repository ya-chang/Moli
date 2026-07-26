// src/main/index.ts
// Electron 主进程入口

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { registerChatIPC, getChatEngine } from './ipc/chat'
import { registerCharacterIPC } from './ipc/character'
import { registerMomentsIPC } from './ipc/moments'
import { registerSettingsIPC } from './ipc/settings'
import { registerAvatarIPC } from './ipc/avatar'
import { registerKnowledgeIPC } from './ipc/knowledge'
import { registerBannedWordsIPC } from './ipc/bannedWords'
import { registerLxMusicIPC } from './music/lxMusicIpc'
import { MusicState } from './music/MusicState'
import { MusicInfoService } from './music/MusicInfoService'
import { MusicContextInjector } from './music/MusicContextInjector'
import { registerMusicIPC } from './music/ipc'
import { MusicSourceManager } from './music/MusicSourceManager'
import { registerSourceIPC, registerAudioProxy } from './music/sourceIpc'
import { MusicWindow } from './music/MusicWindow'
import { NeteaseDetector } from './music/NeteaseDetector'
import { AutoMessageHandler, setAutoMessageHandlerInstance } from './auto-message-handler'
import { PluginManager } from './plugins/PluginManager'
import { registerPluginIPC } from './plugins/ipc'
import { AutoBackup } from './backup/AutoBackup'
import { CrashRecovery } from './backup/CrashRecovery'
import { TTSService } from './tts/TTSService'
import { TTSState } from './tts/TTSState'
import { registerTTSIPC } from './tts/ipc'
import { EmojiManager } from './emojis/EmojiManager'
import { registerEmojiIPC } from './emojis/ipc'
import { PATHS } from './utils/dataPath'
import { logger } from './utils/logger'
import { getNotificationWindow } from './notification/NotificationWindow'

// 全局错误捕获 — 防止进程崩溃
process.on('uncaughtException', (error) => {
  logger.error('未捕获异常', error.message, error.stack)
})

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', String(reason))
})

let mainWindow: BrowserWindow | null = null
let autoMessageHandler: AutoMessageHandler | null = null
let musicState: MusicState | null = null
let musicInfoService: MusicInfoService | null = null
let musicContextInjector: MusicContextInjector | null = null
let musicSourceManager: MusicSourceManager | null = null
let musicWindow: MusicWindow | null = null
let neteaseDetector: NeteaseDetector | null = null
let pluginManager: PluginManager | null = null
let autoBackup: AutoBackup | null = null
let crashRecovery: CrashRecovery | null = null
let ttsService: TTSService | null = null
let ttsState: TTSState | null = null
let emojiManager: EmojiManager | null = null

const isDev = !app.isPackaged

// 禁用 GPU 加速（解决 BrowserView 白屏问题）
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 注册窗口控制IPC
const registerWindowControls = (): void => {
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close()
  })

  // 打开外部链接
  ipcMain.on('shell:open', (_event, url: string) => {
    import('electron').then(({ shell }) => {
      shell.openExternal(url)
    })
  })

  // 测试通知
  ipcMain.handle('test-notification', async (_event, data: { characterId: string; characterName: string; content: string }) => {
    try {
      const nw = getNotificationWindow()
      nw.show(data.characterName, data.content, '🤖')
      return true
    } catch (err) {
      logger.error('测试通知失败:', err)
      return false
    }
  })

  // 更新通知设置
  ipcMain.on('notification:settings-updated', (_event, settings: any) => {
    logger.info('[Notification] 设置已更新')
    try {
      const fs = require('fs')
      const settingsPath = join(PATHS.base, 'notification-settings.json')
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      logger.info(`[Notification] 设置已保存到: ${settingsPath}`)
    } catch (err) {
      logger.error('[Notification] 保存设置失败', err)
    }
  })

  // 快捷切换应用内弹窗开关
  ipcMain.handle('notification:toggle', () => {
    try {
      const fs = require('fs')
      const settingsPath = join(PATHS.base, 'notification-settings.json')
      let settings: Record<string, unknown> = {}
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch {}
      // 切换 appEnabled（应用内弹窗），默认 true
      const currentVal = settings.appEnabled !== false
      settings.appEnabled = !currentVal
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      logger.info(`[Notification] 应用内弹窗切换为: ${settings.appEnabled}`)
      return { success: true, appEnabled: settings.appEnabled }
    } catch (err) {
      logger.error('[Notification] 弹窗切换失败', err)
      return { success: false }
    }
  })
}

app.whenReady().then(() => {
  registerWindowControls()
  registerChatIPC()
  registerCharacterIPC()
  registerMomentsIPC()
  registerSettingsIPC()
  registerAvatarIPC()
  registerKnowledgeIPC()
  registerBannedWordsIPC()
  registerLxMusicIPC()
  createWindow()

  // 初始化音乐系统
  if (mainWindow) {
    musicState = new MusicState()
    musicInfoService = new MusicInfoService()
    musicContextInjector = new MusicContextInjector()

    registerMusicIPC(musicState, mainWindow)

    // 初始化音源管理器
    musicSourceManager = new MusicSourceManager()
    registerSourceIPC(musicSourceManager)
    registerAudioProxy()

    // 初始化网易云WebView
    musicWindow = new MusicWindow()
    neteaseDetector = new NeteaseDetector()

    // 监听歌曲变化请求
    mainWindow.webContents.on('did-finish-load', () => {
      ipcMain.on('music:song-change-request', async (_event, songId: string) => {
        if (musicState && musicInfoService) {
          await musicState.onSongChange(songId, musicInfoService)
        }
      })
    })

    // 前端请求创建网易云WebView
    ipcMain.handle('music:create-webview', () => {
      logger.info('收到 create-webview 请求')
      if (!mainWindow) {
        logger.error('mainWindow 为空')
        return { success: false }
      }

      musicWindow!.create(mainWindow)

      // 设置歌曲变化回调（只设置一次）
      if (!musicWindow!.hasSongChangeCallback()) {
        musicWindow!.onSongChange(async (songId) => {
          logger.info(`检测到歌曲变化: ${songId}`)
          if (musicState && musicInfoService) {
            try {
              await musicState.onSongChange(songId, musicInfoService)
              const songInfo = musicState.getState().songInfo
              if (songInfo) {
                // 通知前端
                if (mainWindow) {
                  logger.info(`发送歌曲信息到前端: ${songInfo.detail.name}`)
                  mainWindow.webContents.send('music:song-changed', {
                    songId,
                    songInfo
                  })
                }
                // 注入到AI聊天上下文
                const chatEngine = getChatEngine()
                chatEngine.setCurrentSongInfo(songInfo)
                logger.info(`歌曲信息已注入AI上下文: ${songInfo.detail.name}`)
              }
            } catch (err) {
              logger.error('处理歌曲变化失败:', err)
            }
          }
        })
      }

      // 确保显示
      musicWindow!.show()

      return { success: true }
    })

    // 前端请求显示WebView
    ipcMain.handle('music:show-webview', () => {
      musicWindow?.show()
      return { success: true }
    })

    // 前端请求隐藏WebView
    ipcMain.handle('music:hide-webview', () => {
      musicWindow?.hide()
      return { success: true }
    })
  }

  // 初始化插件系统
  pluginManager = new PluginManager(mainWindow!)
  registerPluginIPC(pluginManager)

  // 初始化表情包系统
  emojiManager = new EmojiManager(join(PATHS.base, 'emojis'))
  registerEmojiIPC(emojiManager)

  // 初始化备份系统
  crashRecovery = new CrashRecovery(PATHS.base)
  crashRecovery.check()

  autoBackup = new AutoBackup(PATHS.base)

  // 初始化 TTS 系统
  ttsService = new TTSService(PATHS.base)
  ttsState = new TTSState()
  registerTTSIPC(ttsService, ttsState, mainWindow!)

  // 将 TTS 服务注入 ChatEngine
  const chatEngine = getChatEngine()
  chatEngine.setTTS(ttsService, ttsState)

  logger.info('备份系统已初始化')

  // 初始化自动消息系统
  autoMessageHandler = new AutoMessageHandler(mainWindow)
  setAutoMessageHandlerInstance(autoMessageHandler)
  
  // 获取所有角色并启动自动消息
  try {
    const fs = require('fs')
    const charactersDir = PATHS.characters
    const discoveredIds = new Set<string>()
    
    logger.info(`[AutoMessage] 搜索角色目录: ${charactersDir}`)
    
    if (fs.existsSync(charactersDir)) {
      const allItems = fs.readdirSync(charactersDir)
      logger.info(`[AutoMessage] 目录内容: ${allItems.join(', ')}`)
      const characterDirs = allItems.filter((f: string) => {
        const fullPath = join(charactersDir, f)
        const isDir = fs.statSync(fullPath).isDirectory()
        const hasConfig = fs.existsSync(join(fullPath, 'config.yaml'))
        return isDir && hasConfig
      })
      logger.info(`[AutoMessage] 有效角色: ${characterDirs.join(', ')}`)
      for (const characterId of characterDirs) {
        if (!discoveredIds.has(characterId)) {
          discoveredIds.add(characterId)
          autoMessageHandler.start(characterId)
          logger.info(`[AutoMessage] 为角色 ${characterId} 启动自动消息`)
        }
      }
    }
    logger.info(`[AutoMessage] 共发现 ${discoveredIds.size} 个角色`)
  } catch (err) {
    logger.error('启动自动消息失败', err)
  }

  // 测试通知弹窗 — 前端可调用 'notification:test' 立即弹出
  ipcMain.handle('notification:test', (_event, params?: { name?: string; message?: string }) => {
    try {
      const nw = getNotificationWindow()
      nw.show(
        params?.name || '测试角色',
        params?.message || '这是一条测试通知消息 🎉',
        '💌'
      )
      logger.info('[Test] 通知弹窗已触发')
      return { success: true }
    } catch (err) {
      logger.error('[Test] 通知弹窗失败', err)
      return { success: false, error: String(err) }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  autoMessageHandler?.stopAll()
  crashRecovery?.cleanup()
  autoBackup?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前确保停止所有调度器
app.on('before-quit', () => {
  autoMessageHandler?.stopAll()
  logger.info('[App] 应用退出，停止所有自动消息')
})

export { mainWindow }
