// src/main/ipc/chat.ts
// 聊天 IPC 处理器 — 流式输出 + 消息持久化到文件

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { ChatEngine } from '../engine/ChatEngine'
import { ResponseSplitter } from '../engine/ResponseSplitter'
import { IntentClassifier } from '../engine/IntentClassifier'
import { Humanizer } from '../engine/Humanizer'
import { PatHandler } from '../engine/PatHandler'
import { logger } from '../utils/logger'
import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { getAutoMessageHandlerInstance } from '../auto-message-handler'
import { PATHS } from '../utils/dataPath'

interface IpcMessage {
  content: string
  characterId: string
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  persona?: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  quoteContent?: string
  userName?: string
  images?: string[]  // base64 data URLs
  currentSong?: {
    name: string
    artist: string
    album: string
    lyricsSnippet: string
    description: string
  }
}

// 消息存储目录
const getMessagesDir = (): string => {
  const dir = join(PATHS.base, 'messages')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// 保存消息到文件（异步）
const saveMessagesToFile = async (characterId: string, messages: unknown[]): Promise<void> => {
  const dir = getMessagesDir()
  const filePath = join(dir, `${characterId}.json`)
  await writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8')
}

// 从文件加载消息
const loadMessagesFromFile = (characterId: string): unknown[] => {
  const dir = getMessagesDir()
  const filePath = join(dir, `${characterId}.json`)
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

const engine = new ChatEngine()

// 导出引擎实例供其他模块使用
export function getChatEngine(): ChatEngine {
  return engine
}
const splitter = new ResponseSplitter()
const intentClassifier = new IntentClassifier()
const humanizer = new Humanizer()
const patHandler = new PatHandler()

export const registerChatIPC = (): void => {
  // 加载消息
  ipcMain.handle('chat:loadMessages', (_event, params: { characterId: string }) => {
    try {
      const messages = loadMessagesFromFile(params.characterId)
      return { success: true, data: messages }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 保存消息
  ipcMain.handle('chat:saveMessages', async (_event, params: { characterId: string; messages: unknown[] }) => {
    try {
      await saveMessagesToFile(params.characterId, params.messages)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 删除角色的所有消息
  ipcMain.handle('chat:deleteMessages', (_event, params: { characterId: string }) => {
    try {
      const dir = getMessagesDir()
      const filePath = join(dir, `${params.characterId}.json`)
      if (existsSync(filePath)) unlinkSync(filePath)
      return { success: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: errMsg }
    }
  })

  // 导出聊天记录
  ipcMain.handle('chat:export', async (_event, params: { characterId: string; format: 'txt' | 'json' }) => {
    try {
      const messages = loadMessagesFromFile(params.characterId) as Array<{
        role: string; content: string; timestamp: number; type?: string
      }>
      const { dialog } = await import('electron')
      const ext = params.format === 'json' ? 'json' : 'txt'
      const result = await dialog.showSaveDialog({
        title: '导出聊天记录',
        defaultPath: `聊天记录_${params.characterId}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (result.canceled || !result.filePath) return { success: false }

      let content: string
      if (params.format === 'json') {
        content = JSON.stringify(messages, null, 2)
      } else {
        content = messages
          .filter(m => m.type !== 'pat')
          .map(m => {
            const time = new Date(m.timestamp).toLocaleString('zh-CN')
            const role = m.role === 'user' ? '我' : 'AI'
            return `[${time}] ${role}: ${m.content}`
          })
          .join('\n\n')
      }

      const { writeFile } = await import('fs/promises')
      await writeFile(result.filePath, content, 'utf-8')
      return { success: true, path: result.filePath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.CHAT_SEND,
    async (event, params: IpcMessage) => {
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const senderWindow = BrowserWindow.fromWebContents(event.sender)

      logger.info(`收到消息: id=${msgId}`)

      // 记录最后消息时间，供"想你了"功能使用
      const amh = getAutoMessageHandlerInstance()
      if (amh) {
        amh.setLastMessageTime(params.characterId, Date.now())
      }

      try {
        // 拍一拍 → 根据人设生成回应
        const patMatch = params.content.match(/^拍了拍.*?(?:的(.+))?$/)
        if (patMatch) {
          const suffix = patMatch[1] || ''
          // 从角色配置读取人设类型
          let personality = 'gentle'
          try {
            const characterManager = new (await import('../character/CharacterManager')).CharacterManager()
            const character = characterManager.get(params.characterId)
            if (character) {
              // 根据 persona 关键词判断人设
              const p = character.persona || ''
              if (p.includes('高冷') || p.includes('傲娇')) personality = 'tsundere'
              else if (p.includes('搞笑') || p.includes('活泼') || p.includes('段子')) personality = 'funny'
              else if (p.includes('冷') || p.includes('酷')) personality = 'cold'
            }
          } catch (err) { logger.debug('角色人设读取失败，使用默认', err) }

          const response = patHandler.getResponse(personality, suffix)
          await deliverChunks(senderWindow, msgId, params.characterId, splitter.split(response))
          return {
            success: true,
            data: { id: msgId, content: response, chunks: [response] }
          }
        }

        // 意图预判
        const intent = intentClassifier.classify(params.content)

        if (intent.action === 'skip') {
          return { success: true, data: { id: msgId, content: '', chunks: [] } }
        }

        if (intent.action === 'template_reply' && intent.template) {
          await deliverChunks(senderWindow, msgId, params.characterId, splitter.split(intent.template))
          return {
            success: true,
            data: { id: msgId, content: intent.template, chunks: [intent.template] }
          }
        }

        // 流式调用模型 — 逐字推送到前端
        const fullContent = await streamToChunks(
          senderWindow, msgId, params.characterId, params, engine
        )

        // 人味儿处理
        const humanized = humanizer.process(fullContent)

        // 人味儿处理完成后，发送最终状态标记
        // 如果 humanizer 没有修改内容（或替换了为 emoji），才发 replace
        const finalContent = humanized.content
        const contentChanged = finalContent !== fullContent
        senderWindow?.webContents.send(IPC_CHANNELS.CHAT_CHUNK, {
          chunkId: msgId,
          content: contentChanged ? finalContent : '',
          index: 0,
          total: 1,
          isLast: true,
          replace: contentChanged
        })

        // AI 表情包发送（异步，不阻塞文字回复）
        try {
          const shouldSend = engine.shouldSendEmoji(params.characterId)
          logger.info(`[表情包] 检查: characterId=${params.characterId}, shouldSend=${shouldSend}`)
          if (shouldSend) {
            const emotion = engine.getEmotionState(params.characterId)
            const emojiResult = engine.selectEmoji(
              params.characterId,
              emotion.currentMood,
              params.content
            )
            logger.info(`[表情包] 选择结果: ${JSON.stringify(emojiResult)}`)
            if (emojiResult) {
              const emojiMsgId = `emoji_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              setTimeout(() => {
                if (senderWindow && !senderWindow.isDestroyed()) {
                  senderWindow.webContents.send(IPC_CHANNELS.CHAT_CHUNK, {
                    chunkId: emojiMsgId,
                    content: `[emoji:${emojiResult.id}]`,
                    index: 0,
                    total: 1,
                    isLast: true,
                    emoji: true,
                    emojiId: emojiResult.id,
                    emojiFilePath: emojiResult.filePath,
                    characterId: params.characterId
                  })
                }
              }, 500)
            }
          }
        } catch (emojiErr) {
          logger.error('[表情包] 发送失败', emojiErr)
        }

        // TTS 语音合成（异步，不阻塞回复）— 按角色设置
        try {
          const ttsService = engine.getTTSService()
          if (ttsService?.isReady() && humanized.content.trim()) {
            // 从角色配置读取 TTS 设置
            const { CharacterManager } = await import('../character/CharacterManager')
            const cm = new CharacterManager()
            const charConfig = cm.get(params.characterId)
            logger.info(`[TTS] 角色配置: id=${params.characterId}, ttsEnabled=${charConfig?.ttsEnabled}, ttsVoice=${charConfig?.ttsVoice}, ttsModel=${charConfig?.ttsModel}`)

            if (charConfig?.ttsEnabled) {
              const voiceId = charConfig.ttsVoice || '茉莉'
              const ttsModel = charConfig.ttsModel || 'preset'
              const { filterForTTS } = await import('../tts/TextFilter')
              const filteredText = filterForTTS(humanized.content)

              // 根据模型类型选择 stylePrompt
              let stylePrompt: string
              if (ttsModel === 'voicedesign' && charConfig.ttsVoiceDesignPrompt) {
                // 音色设计模式：使用用户输入的音色描述
                stylePrompt = charConfig.ttsVoiceDesignPrompt
              } else {
                // 预设模式：使用默认风格
                stylePrompt = engine.getDefaultStylePrompt(params.characterId)
              }

              logger.info(`[TTS] 开始合成: voice=${voiceId}, model=${ttsModel}, style=${stylePrompt.slice(0, 30)}..., text=${filteredText.slice(0, 30)}...`)

              ttsService.synthesize(filteredText, voiceId, stylePrompt, ttsModel)
                .then(audioBuffer => {
                  if (audioBuffer) {
                    logger.info(`[TTS] 语音合成完成: ${audioBuffer.length} bytes`)
                    try {
                      const audioBase64 = audioBuffer.toString('base64')
                      logger.info(`[TTS] 准备发送, msgId=${msgId}, audioLen=${audioBase64.length}`)
                      const windows = BrowserWindow.getAllWindows()
                      logger.info(`[TTS] 窗口数: ${windows.length}`)
                      for (const win of windows) {
                        if (!win.isDestroyed()) {
                          win.webContents.send('tts:audio-ready', {
                            characterId: params.characterId,
                            msgId: msgId,
                            audio: audioBase64
                          })
                          logger.info(`[TTS] 已发送到窗口`)
                        }
                      }
                    } catch (err) {
                      logger.error(`[TTS] 发送失败`, err)
                    }
                  }
                })
                .catch(err => logger.error('[TTS] 合成失败', err))
            }
          }
        } catch (ttsErr) {
          logger.error('[TTS] 处理异常', ttsErr)
        }

        logger.info(`流式输出完成`)
        return {
          success: true,
          data: { id: msgId, content: humanized.content, chunks: [humanized.content] }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误'
        logger.error(`消息处理失败: id=${msgId}`, errMsg)
        return { success: false, error: errMsg }
      }
    }
  )
}

// 流式输出 — 逐字/逐句推送到前端
const streamToChunks = async (
  senderWindow: BrowserWindow | null,
  msgId: string,
  characterId: string,
  params: IpcMessage,
  chatEngine: ChatEngine
): Promise<string> => {
  let fullContent = ''
  let sentenceBuffer = ''

  senderWindow?.webContents.send(IPC_CHANNELS.CHAT_TYPING, {
    characterId,
    typing: true
  })

  try {
    // 有图片时读取角色的视觉模型配置
    let visionParams: Record<string, string> = {}
    if (params.images && params.images.length > 0) {
      logger.info(`[视觉] 收到 ${params.images.length} 张图片，角色ID: ${params.characterId}`)
      try {
        const { CharacterManager } = await import('../character/CharacterManager')
        const cm = new CharacterManager()
        const charConfig = cm.get(params.characterId)
        logger.info(`[视觉] 角色配置: visionEnabled=${charConfig?.visionEnabled}, visionModel=${charConfig?.visionModel}, visionApiKey=${charConfig?.visionApiKey ? '已设置' : '未设置'}`)
        if (charConfig?.visionEnabled && charConfig.visionModel) {
          // 只添加有值的字段，避免 undefined 覆盖
          if (charConfig.visionProvider || charConfig.provider) {
            visionParams.visionProvider = charConfig.visionProvider || charConfig.provider
          }
          visionParams.visionModel = charConfig.visionModel
          if (charConfig.visionApiKey || charConfig.apiKey) {
            visionParams.visionApiKey = charConfig.visionApiKey || charConfig.apiKey || ''
          }
          if (charConfig.visionBaseUrl || charConfig.baseUrl) {
            visionParams.visionBaseUrl = charConfig.visionBaseUrl || charConfig.baseUrl || ''
          }
          logger.info(`[视觉] 使用视觉模型: ${visionParams.visionProvider}/${visionParams.visionModel}`)
        } else {
          logger.warn(`[视觉] 角色未配置视觉模型 (visionEnabled=${charConfig?.visionEnabled}, visionModel=${charConfig?.visionModel})`)
        }
      } catch (err) {
        logger.error('[视觉] 读取角色配置失败', err)
      }
    }

    for await (const chunk of chatEngine.sendMessageStream({
      content: params.content,
      characterId: params.characterId,
      history: params.history,
      persona: params.persona,
      provider: params.provider,
      model: params.model,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      quoteContent: params.quoteContent,
      userName: params.userName,
      images: params.images,
      ...visionParams,
      currentSong: params.currentSong
    })) {
      fullContent += chunk
      sentenceBuffer += chunk

      // 按标点自然断句推送
      const splitPoint = findSplitPoint(sentenceBuffer)
      if (splitPoint > 0) {
        const toSend = sentenceBuffer.slice(0, splitPoint)
        sentenceBuffer = sentenceBuffer.slice(splitPoint)

        senderWindow?.webContents.send(IPC_CHANNELS.CHAT_CHUNK, {
          chunkId: msgId,
          content: toSend,
          index: 0,
          total: 1,
          isLast: false
        })

        // 句子间延迟 100-300ms
        await sleep(100 + Math.random() * 200)
      }
    }

    // 推送剩余内容（不标记 isLast，由 humanizer 统一发最终标记）
    if (sentenceBuffer) {
      senderWindow?.webContents.send(IPC_CHANNELS.CHAT_CHUNK, {
        chunkId: msgId,
        content: sentenceBuffer,
        index: 0,
        total: 1,
        isLast: false
      })
    }
  } finally {
    senderWindow?.webContents.send(IPC_CHANNELS.CHAT_TYPING, {
      characterId,
      typing: false
    })
  }

  return fullContent
}

const findSplitPoint = (text: string): number => {
  const splitChars = ['。', '！', '？', '!', '?', '，', ',', '、', '\n', '～', '…']
  for (const char of splitChars) {
    const idx = text.lastIndexOf(char)
    if (idx > 0 && idx < text.length - 1) {
      return idx + 1
    }
  }
  // 超过30字也拆
  if (text.length > 30) return 30
  return 0
}

const deliverChunks = async (
  senderWindow: BrowserWindow | null,
  msgId: string,
  characterId: string,
  chunks: string[]
): Promise<void> => {
  for (let i = 0; i < chunks.length; i++) {
    senderWindow?.webContents.send(IPC_CHANNELS.CHAT_TYPING, {
      characterId,
      typing: true
    })

    await sleep(100 + Math.random() * 200)

    senderWindow?.webContents.send(IPC_CHANNELS.CHAT_CHUNK, {
      chunkId: `${msgId}_${i}`,
      content: chunks[i],
      index: i,
      total: chunks.length,
      isLast: i === chunks.length - 1
    })
  }

  senderWindow?.webContents.send(IPC_CHANNELS.CHAT_TYPING, {
    characterId,
    typing: false
  })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
