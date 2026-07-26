// src/main/ipc/avatar.ts
// 头像 IPC — 保存用户上传的图片到磁盘

import { ipcMain } from 'electron'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'
import { PATHS } from '../utils/dataPath'

const AVATAR_DIR = PATHS.avatars

const ensureDir = (): void => {
  if (!existsSync(AVATAR_DIR)) {
    mkdirSync(AVATAR_DIR, { recursive: true })
  }
}

export const registerAvatarIPC = (): void => {
  ipcMain.handle('avatar:save', (_event, params: { id: string; dataUrl: string }) => {
    try {
      ensureDir()
      const { id, dataUrl } = params

      const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!matches) {
        return { success: false, error: '无效的图片格式' }
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
      const base64 = matches[2]
      const filePath = join(AVATAR_DIR, `${id}.${ext}`)

      writeFileSync(filePath, Buffer.from(base64, 'base64'))

      logger.info(`头像保存成功: ${id}.${ext}`)
      return { success: true, path: filePath }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  ipcMain.handle('avatar:load', (_event, params: { id: string }) => {
    try {
      const { id } = params
      for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
        const filePath = join(AVATAR_DIR, `${id}.${ext}`)
        if (existsSync(filePath)) {
          const buffer = readFileSync(filePath)
          const base64 = buffer.toString('base64')
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
          return { success: true, dataUrl: `data:${mimeType};base64,${base64}` }
        }
      }
      return { success: false, error: '头像文件不存在' }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })
}
