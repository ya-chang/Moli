// src/main/ipc/character.ts
// 角色管理 IPC 处理器

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { CharacterManager, type CharacterConfig } from '../character/CharacterManager'
import { getAutoMessageHandlerInstance } from '../auto-message-handler'
import { logger } from '../utils/logger'

const manager = new CharacterManager()

export const registerCharacterIPC = (): void => {
  // 获取所有角色
  ipcMain.handle(IPC_CHANNELS.CHARACTER_LIST, () => {
    return manager.getAll()
  })

  // 获取当前活跃角色
  ipcMain.handle('character:active', () => {
    return manager.getActive()
  })

  // 创建角色（从模板）
  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_CREATE,
    (_event, params: {
      templateId?: string
      name: string
      avatar: string
      persona?: string
      traits?: string[]
      catchphrase?: string
      provider?: string
      model?: string
      apiKey?: string
      baseUrl?: string
    }) => {
      try {
        if (params.templateId) {
          return manager.createFromTemplate(
            params.templateId,
            params.name,
            params.avatar,
            {
              provider: params.provider,
              model: params.model,
              apiKey: params.apiKey,
              baseUrl: params.baseUrl,
              persona: params.persona,
              traits: params.traits,
              catchphrase: params.catchphrase
            }
          )
        }

        return manager.createCustom({
          name: params.name,
          avatar: params.avatar,
          persona: params.persona,
          traits: params.traits,
          catchphrase: params.catchphrase,
          provider: params.provider,
          model: params.model,
          apiKey: params.apiKey,
          baseUrl: params.baseUrl
        })
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误'
        logger.error(`角色创建失败: ${errMsg}`)
        return { error: errMsg }
      }
    }
  )

  // 切换角色
  ipcMain.handle(IPC_CHANNELS.CHARACTER_SWITCH, (_event, params: { characterId: string }) => {
    try {
      manager.setActive(params.characterId)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 更新角色
  ipcMain.handle(
    IPC_CHANNELS.CHARACTER_UPDATE,
    (_event, params: { id: string; updates: Partial<CharacterConfig> }) => {
      try {
        return manager.update(params.id, params.updates)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误'
        return { error: errMsg }
      }
    }
  )

  // 删除角色
  ipcMain.handle(IPC_CHANNELS.CHARACTER_DELETE, (_event, params: { id: string }) => {
    try {
      // 停止该角色的自动消息
      const amh = getAutoMessageHandlerInstance()
      if (amh) {
        amh.stop(params.id)
        logger.info(`[Character] 停止角色 ${params.id} 的自动消息`)
      }
      manager.delete(params.id)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })
}
