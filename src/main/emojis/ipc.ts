// src/main/emojis/ipc.ts
// IPC通信层 — 表情包相关通道

import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { EmojiManager } from './EmojiManager'
import { EMOJI_CHANNELS } from '../../shared/ipc-channels'

export function registerEmojiIPC(emojiManager: EmojiManager): void {
  // 上传表情包（通过 dialog 选择文件）
  ipcMain.handle(EMOJI_CHANNELS.UPLOAD, async (_: any, characterId: string) => {
    const result = await dialog.showOpenDialog({
      title: '选择表情包',
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled) return { success: false }

    const uploaded = []
    for (const filePath of result.filePaths) {
      try {
        const emoji = await emojiManager.upload(characterId, filePath, [], 'neutral')
        uploaded.push(emoji)
      } catch (err) {
        console.error('上传失败:', err)
      }
    }

    return { success: true, emojis: uploaded }
  })

  // 通过文件数据上传表情包（前端读取文件后发送）
  ipcMain.handle('emoji:upload-data', async (_: any, characterId: string, params: {
    fileName: string
    fileData: string // base64
    tags?: string[]
    emotion?: string
  }) => {
    try {
      const emoji = emojiManager.uploadFromData(
        characterId,
        params.fileName,
        params.fileData,
        params.tags || [],
        params.emotion || 'neutral'
      )
      return { success: true, emoji }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 删除
  ipcMain.handle(EMOJI_CHANNELS.DELETE, (_: any, characterId: string, emojiId: string) => {
    try {
      emojiManager.delete(characterId, emojiId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取所有
  ipcMain.handle(EMOJI_CHANNELS.GET_ALL, (_: any, characterId: string) => {
    return emojiManager.getAll(characterId)
  })

  // 获取文件路径
  ipcMain.handle(EMOJI_CHANNELS.GET_FILE, (_: any, characterId: string, emojiId: string) => {
    return emojiManager.getFilePath(characterId, emojiId)
  })

  // 获取表情包图片 base64（用于显示）
  ipcMain.handle('emoji:get-image', (_: any, characterId: string, emojiId: string) => {
    const filePath = emojiManager.getFilePath(characterId, emojiId)
    if (!filePath || !fs.existsSync(filePath)) return null
    
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    }
    const mime = mimeTypes[ext] || 'image/png'
    return `data:${mime};base64,${buffer.toString('base64')}`
  })

  // 更新配置
  ipcMain.handle(EMOJI_CHANNELS.UPDATE_CONFIG, (_: any, characterId: string, config: any) => {
    emojiManager.updateConfig(characterId, config)
    return { success: true }
  })

  // 获取配置
  ipcMain.handle('emoji:get-config', (_: any, characterId: string) => {
    return emojiManager.getConfig(characterId)
  })
}
