// src/main/tts/ipc.ts
// TTS IPC 通信

import { ipcMain, BrowserWindow } from 'electron'
import { TTSService, TTSModelType } from './TTSService'
import { TTSState } from './TTSState'
import { logger } from '../utils/logger'

export function registerTTSIPC(
  ttsService: TTSService,
  ttsState: TTSState,
  mainWindow: BrowserWindow
): void {
  // 启用/停止
  ipcMain.on('tts:toggle', (_event, enable: boolean) => {
    if (enable) {
      ttsState.enable()
    } else {
      ttsState.disable()
    }
  })

  // 设置音色和风格
  ipcMain.on('tts:set-voice', (_event, params: { voiceId: string; voiceName: string; stylePrompt?: string; modelType?: TTSModelType }) => {
    ttsState.setVoice(params.voiceId, params.voiceName)
    if (params.stylePrompt !== undefined) {
      ttsState.setStylePrompt(params.stylePrompt)
    }
    if (params.modelType !== undefined) {
      ttsState.setModelType(params.modelType)
    }
  })

  // 获取状态
  ipcMain.handle('tts:get-state', () => {
    return ttsState.getState()
  })

  // 获取音色列表
  ipcMain.handle('tts:get-voices', () => {
    return ttsService.getPresetVoices()
  })

  // 获取可用模型列表
  ipcMain.handle('tts:get-models', () => {
    return ttsService.getAvailableModels()
  })

  // 初始化（保存 API Key）
  ipcMain.handle('tts:init', (_event, params: { apiKey: string }) => {
    if (!params.apiKey || !params.apiKey.trim()) {
      return { success: false, error: 'API Key 不能为空' }
    }
    ttsService.init(params.apiKey.trim())
    return { success: true }
  })

  // 获取当前 TTS API Key（脱敏）
  ipcMain.handle('tts:get-api-key', () => {
    return {
      apiKey: ttsService.getMaskedApiKey(),
      hasKey: ttsService.isReady()
    }
  })

  // 合成语音
  ipcMain.handle('tts:synthesize', async (_event, params: { text: string; voiceId: string; stylePrompt?: string; modelType?: TTSModelType }) => {
    try {
      const audioBuffer = await ttsService.synthesize(params.text, params.voiceId, params.stylePrompt, params.modelType)
      if (audioBuffer) {
        return { success: true, audio: audioBuffer.toString('base64') }
      }
      return { success: false, error: '合成失败' }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('[TTS] 合成异常', errMsg)
      return { success: false, error: errMsg }
    }
  })

  // 获取缓存大小
  ipcMain.handle('tts:get-cache-size', () => {
    return ttsService.getCacheSize()
  })

  // 清除缓存
  ipcMain.on('tts:clear-cache', () => {
    ttsService.clearCache()
  })

  // 状态变化通知
  ttsState.onStateChange((state) => {
    mainWindow.webContents.send('tts:state-changed', state)
  })

  logger.info('TTS IPC已注册')
}
