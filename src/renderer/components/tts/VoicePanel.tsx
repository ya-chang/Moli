// src/renderer/components/tts/VoicePanel.tsx
// 语音合成弹出面板 — 按角色保存音色设置

import { useState, useEffect } from 'react'
import './voice.css'

interface VoicePanelProps {
  onClose: () => void
  characterId?: string
}

interface VoiceInfo {
  id: string
  name: string
  lang: string
  gender: string
}

interface ModelInfo {
  id: 'preset' | 'voicedesign' | 'voiceclone'
  name: string
  description: string
}

export function VoicePanel({ onClose, characterId: propCharId }: VoicePanelProps) {
  const [voices, setVoices] = useState<VoiceInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedVoice, setSelectedVoice] = useState('茉莉')
  const [selectedModel, setSelectedModel] = useState<'preset' | 'voicedesign' | 'voiceclone'>('preset')
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [currentCharId, setCurrentCharId] = useState<string | null>(propCharId || null)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiKeySaved, setApiKeySaved] = useState(false)
  // 音色设计：用户输入的音色描述
  const [voiceDesignPrompt, setVoiceDesignPrompt] = useState('')
  // 音色克隆：参考音频文件和文件名
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null)
  const [cloneAudioName, setCloneAudioName] = useState('')

  const handleClose = (): void => {
    window.dispatchEvent(new Event('tts:refresh'))
    onClose()
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async (): Promise<void> => {
    try {
      let charId = propCharId || ''
      if (!charId) {
        const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
        if (charList && charList.length > 0) {
          charId = charList[0].id as string
          await window.electronAPI?.invoke('character:switch', { characterId: charId })
        }
      }

      if (charId) {
        setCurrentCharId(charId)
        const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
        const charData = charList?.find(c => c.id === charId)
        if (charData) {
          setTtsEnabled(!!charData.ttsEnabled)
          if (charData.ttsVoice) setSelectedVoice(charData.ttsVoice as string)
          if (charData.ttsModel) setSelectedModel(charData.ttsModel as 'preset' | 'voicedesign' | 'voiceclone')
          if (charData.ttsVoiceDesignPrompt) setVoiceDesignPrompt(charData.ttsVoiceDesignPrompt as string)
          if (charData.ttsCloneAudioName) setCloneAudioName(charData.ttsCloneAudioName as string)
        }
      }

      // 从后端加载独立的 TTS API Key（不是角色的聊天 Key）
      try {
        const ttsKeyResult = await window.electronAPI?.invoke('tts:get-api-key') as { apiKey: string; hasKey: boolean } | null
        if (ttsKeyResult?.hasKey) {
          setApiKey(ttsKeyResult.apiKey)
          setApiKeySaved(true)
        }
      } catch { /* ignore */ }

      const voicesResult = await window.electronAPI?.invoke('tts:get-voices')
      if (Array.isArray(voicesResult)) setVoices(voicesResult as VoiceInfo[])

      const modelsResult = await window.electronAPI?.invoke('tts:get-models')
      if (Array.isArray(modelsResult)) setModels(modelsResult as ModelInfo[])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleSaveApiKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    const result = await window.electronAPI?.invoke('tts:init', { apiKey: apiKey.trim() }) as { success: boolean }
    if (result?.success) setApiKeySaved(true)
  }

  const handleToggle = async (): Promise<void> => {
    if (!currentCharId) return
    const newEnabled = !ttsEnabled

    // 启用时检查 TTS Key 是否已配置
    if (newEnabled && !apiKeySaved) {
      alert('请先配置 TTS API Key（MiMo）')
      return
    }

    setTtsEnabled(newEnabled)
    const voiceName = voices.find(v => v.id === selectedVoice)?.name || selectedVoice
    await window.electronAPI?.invoke('character:update', {
      id: currentCharId,
      updates: { ttsEnabled: newEnabled, ttsVoice: selectedVoice, ttsVoiceName: voiceName }
    })
  }

  const handleVoiceChange = async (voiceId: string): Promise<void> => {
    setSelectedVoice(voiceId)
    if (currentCharId) {
      const voiceName = voices.find(v => v.id === voiceId)?.name || voiceId
      await window.electronAPI?.invoke('character:update', {
        id: currentCharId,
        updates: { ttsVoice: voiceId, ttsVoiceName: voiceName, ttsModel: selectedModel }
      })
    }
  }

  const handleModelChange = async (modelId: 'preset' | 'voicedesign' | 'voiceclone'): Promise<void> => {
    setSelectedModel(modelId)
    if (currentCharId) {
      const voiceName = voices.find(v => v.id === selectedVoice)?.name || selectedVoice
      await window.electronAPI?.invoke('character:update', {
        id: currentCharId,
        updates: { ttsModel: modelId, ttsVoice: selectedVoice, ttsVoiceName: voiceName }
      })
    }
  }

  const handleVoiceDesignSave = async (): Promise<void> => {
    if (!currentCharId || !voiceDesignPrompt.trim()) return
    await window.electronAPI?.invoke('character:update', {
      id: currentCharId,
      updates: { ttsVoiceDesignPrompt: voiceDesignPrompt.trim() }
    })
  }

  const handleCloneFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) {
      setCloneAudioFile(file)
      setCloneAudioName(file.name)
    }
  }

  const handleCloneSave = async (): Promise<void> => {
    if (!currentCharId) return
    // 保存克隆音频文件名到角色配置
    // 实际音频文件会在合成时通过 IPC 传递
    await window.electronAPI?.invoke('character:update', {
      id: currentCharId,
      updates: { ttsCloneAudioName: cloneAudioName }
    })
  }

  const handlePreviewClone = async (): Promise<void> => {
    if (previewing || !cloneAudioFile) return

    // 确保 API Key 已初始化
    if (!apiKeySaved) {
      if (!apiKey.trim()) {
        alert('请先输入并保存 API Key')
        return
      }
      const initResult = await window.electronAPI?.invoke('tts:init', { apiKey: apiKey.trim() }) as { success: boolean }
      if (!initResult?.success) {
        alert('API Key 初始化失败')
        return
      }
      setApiKeySaved(true)
    }

    setPreviewing('voiceclone')
    try {
      // 读取音频文件为 base64
      const reader = new FileReader()
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          // 去掉 data:audio/xxx;base64, 前缀
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(cloneAudioFile)
      })

      const result = await window.electronAPI?.invoke('tts:synthesize', {
        text: '你好呀，我是你的AI伴侣~',
        voiceId: audioBase64,
        stylePrompt: '用这个音色说话',
        modelType: 'voiceclone'
      }) as { success: boolean; audio?: string; error?: string }

      if (result?.success && result.audio) {
        const binaryStr = atob(result.audio)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer)
        const source = audioCtx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioCtx.destination)
        source.onended = () => { setPreviewing(null); audioCtx.close() }
        source.start(0)
      } else {
        setPreviewing(null)
        if (result?.error) alert('合成失败: ' + result.error)
      }
    } catch (err) {
      setPreviewing(null)
      alert('试听失败: ' + String(err))
    }
  }

  const handlePreviewDesign = async (): Promise<void> => {
    if (previewing || !voiceDesignPrompt.trim()) return

    // 确保 API Key 已初始化
    if (!apiKeySaved) {
      if (!apiKey.trim()) {
        alert('请先输入并保存 API Key')
        return
      }
      const initResult = await window.electronAPI?.invoke('tts:init', { apiKey: apiKey.trim() }) as { success: boolean }
      if (!initResult?.success) {
        alert('API Key 初始化失败')
        return
      }
      setApiKeySaved(true)
    }

    setPreviewing('voicedesign')
    try {
      const result = await window.electronAPI?.invoke('tts:synthesize', {
        text: '你好呀，我是你的AI伴侣~',
        voiceId: selectedVoice || '茉莉',
        stylePrompt: voiceDesignPrompt.trim(),
        modelType: 'voicedesign'
      }) as { success: boolean; audio?: string; error?: string }

      if (result?.success && result.audio) {
        const binaryStr = atob(result.audio)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer)
        const source = audioCtx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioCtx.destination)
        source.onended = () => { setPreviewing(null); audioCtx.close() }
        source.start(0)
      } else {
        setPreviewing(null)
        if (result?.error) alert('合成失败: ' + result.error)
      }
    } catch (err) {
      setPreviewing(null)
      alert('试听失败: ' + String(err))
    }
  }

  const handlePreview = async (voiceId: string): Promise<void> => {
    if (previewing) return
    if (!apiKeySaved) {
      alert('请先配置 TTS API Key（MiMo）')
      return
    }
    setPreviewing(voiceId)
    try {
      const result = await window.electronAPI?.invoke('tts:synthesize', {
        text: '你好呀，我是你的AI伴侣~',
        voiceId,
        stylePrompt: '用温柔的语气说话'
      }) as { success: boolean; audio?: string }
      if (result?.success && result.audio) {
        const binaryStr = atob(result.audio)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer)
        const source = audioCtx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioCtx.destination)
        source.onended = () => { setPreviewing(null); audioCtx.close() }
        source.start(0)
      } else {
        setPreviewing(null)
      }
    } catch {
      setPreviewing(null)
    }
  }

  if (loading) {
    return (
      <div className="voice-panel-overlay" onClick={handleClose}>
        <div className="voice-panel" onClick={e => e.stopPropagation()}>
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="voice-panel-overlay" onClick={handleClose}>
      <div className="voice-panel" onClick={e => e.stopPropagation()}>
        <div className="voice-panel__header">
          <h3>语音合成{ttsEnabled ? ' · 已启用' : ''}</h3>
          <button className="voice-panel__close" onClick={handleClose}>×</button>
        </div>

        <div className="voice-panel__body">
          {/* API Key */}
          <div className="voice-panel__apikey-row">
            <input
              type="password"
              className="voice-panel__input"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="MiMo API Key"
            />
            <button className="voice-panel__btn-sm" onClick={handleSaveApiKey} disabled={!apiKey.trim()}>
              {apiKeySaved ? '✓' : '保存'}
            </button>
          </div>

          {/* 模型选择 - 横排 */}
          <div className="voice-panel__model-tabs">
            {models.map(m => (
              <button
                key={m.id}
                className={`voice-panel__model-tab ${selectedModel === m.id ? 'voice-panel__model-tab--active' : ''}`}
                onClick={() => handleModelChange(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>

          {/* 预设音色列表 */}
          {selectedModel === 'preset' && (
            <div className="voice-panel__voices">
              {voices.filter(v => v.lang === '中文').map(v => (
                <div key={v.id} className={`voice-panel__voice ${selectedVoice === v.id ? 'voice-panel__voice--active' : ''}`}>
                  <label className="voice-panel__voice-label">
                    <input type="radio" name="voice" value={v.id} checked={selectedVoice === v.id} onChange={() => handleVoiceChange(v.id)} />
                    <span>{v.name}</span>
                  </label>
                  <button className="voice-panel__preview-btn" onClick={() => handlePreview(v.id)} disabled={previewing !== null || !apiKeySaved}>
                    {previewing === v.id ? '...' : '试听'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 音色设计 */}
          {selectedModel === 'voicedesign' && (
            <div className="voice-panel__design">
              <textarea
                className="voice-panel__textarea"
                value={voiceDesignPrompt}
                onChange={e => setVoiceDesignPrompt(e.target.value)}
                placeholder="描述音色，如：温柔甜美的年轻女性"
                rows={2}
              />
              <div className="voice-panel__btn-row">
                <button
                  className="voice-panel__btn-sm"
                  onClick={handlePreviewDesign}
                  disabled={previewing !== null || !apiKeySaved || !voiceDesignPrompt.trim()}
                >
                  {previewing === 'voicedesign' ? '...' : '试听'}
                </button>
                <button
                  className="voice-panel__btn-sm"
                  onClick={handleVoiceDesignSave}
                  disabled={!voiceDesignPrompt.trim()}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {/* 音色克隆 */}
          {selectedModel === 'voiceclone' && (
            <div className="voice-panel__clone-disabled">
              <div className="voice-panel__clone-disabled-text">
                音色克隆功能暂未开放，敬请期待
              </div>
            </div>
          )}
        </div>

        <div className="voice-panel__footer">
          {ttsEnabled ? (
            <button className="voice-panel__btn voice-panel__btn--stop" onClick={handleToggle}>停用</button>
          ) : (
            <button className="voice-panel__btn voice-panel__btn--start" onClick={handleToggle}>启用语音合成</button>
          )}
        </div>
      </div>
    </div>
  )
}
