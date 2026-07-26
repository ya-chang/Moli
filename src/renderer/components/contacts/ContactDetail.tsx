// src/renderer/components/contacts/ContactDetail.tsx
// 联系人详情 — 显示在中间区域，支持修改头像

import { useState, useEffect, useRef, useCallback } from 'react'
import { useContactStore } from '../../stores/contactStore'
import { useChatListStore } from '../../stores/chatListStore'
import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import './ContactList.css'

type FrequencyMode = 'follow_user' | 'every_message' | 'random'

interface ProactiveSettings {
  enabled: boolean
  morningHour: number
  morningMinute: number
  nightHour: number
  nightMinute: number
  types: {
    morning: boolean
    night: boolean
    missYou: boolean
  }
  missYouDelay: number
  maxMissYouPerDay: number
}

const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  morningHour: 8,
  morningMinute: 0,
  nightHour: 23,
  nightMinute: 0,
  types: {
    morning: true,
    night: true,
    missYou: true
  },
  missYouDelay: 60,
  maxMissYouPerDay: 3
}

export function ContactDetail(): React.JSX.Element | null {
  const selectedContactId = useContactStore((s) => s.selectedContactId)
  const setSelectedContactId = useContactStore((s) => s.setSelectedContactId)
  const sessions = useChatListStore((s) => s.sessions)
  const bumpAvatarVersion = useChatListStore((s) => s.bumpAvatarVersion)
  const [showApiKey, setShowApiKey] = useState(false)
  const [customAvatar, setCustomAvatar] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [emojiFreqMode, setEmojiFreqMode] = useState<FrequencyMode>('follow_user')
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveSettings>(DEFAULT_PROACTIVE_SETTINGS)
  const [showNotificationSettings, setShowNotificationSettings] = useState(false)

  const session = sessions.find((s) => s.id === selectedContactId)

  const [charData, setCharData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  // 从后端加载角色数据（包含视觉配置等所有字段）
  const loadCharData = useCallback(async (): Promise<void> => {
    if (!selectedContactId) { setLoading(false); return }
    setLoading(true)
    try {
      const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
      const char = charList?.find(c => c.id === selectedContactId)
      setCharData(char || null)
    } catch {
      setCharData(null)
    } finally {
      setLoading(false)
    }
  }, [selectedContactId])

  useEffect(() => {
    loadCharData()
  }, [loadCharData])

  useEffect(() => {
    if (!selectedContactId) return
    // 从后端加载自定义头像
    const loadAvatar = async () => {
      try {
        const result = await window.electronAPI?.invoke('avatar:load', { id: selectedContactId }) as any
        if (result?.success && result.dataUrl) {
          setCustomAvatar(result.dataUrl)
        } else {
          setCustomAvatar(null)
        }
      } catch {
        setCustomAvatar(null)
      }
    }
    loadAvatar()
  }, [selectedContactId, session?.avatarVersion])

  useEffect(() => {
    setShowApiKey(false)
  }, [selectedContactId])

  // 加载表情包频率设置 — 从后端读取
  useEffect(() => {
    if (!selectedContactId) return
    const currentId = selectedContactId

    const loadEmojiConfig = async (): Promise<void> => {
      try {
        const config = await window.electronAPI?.invoke('emoji:get-config', currentId) as { frequencyMode?: FrequencyMode } | null
        // 竞态检查：如果加载期间角色已切换，丢弃结果
        if (currentId !== selectedContactId) return
        if (config?.frequencyMode) {
          setEmojiFreqMode(config.frequencyMode)
        } else {
          setEmojiFreqMode('follow_user')
        }
      } catch {
        if (currentId !== selectedContactId) return
        setEmojiFreqMode('follow_user')
      }
    }
    loadEmojiConfig()
  }, [selectedContactId])

  // 加载主动消息设置 — 从后端角色配置读取
  useEffect(() => {
    if (!selectedContactId) return
    const currentId = selectedContactId

    const loadProactiveSettings = async () => {
      try {
        // 从后端读取角色配置
        const result = await window.electronAPI?.invoke('character:list') as any[]
        const char = result?.find((c: any) => c.id === currentId)
        if (char?.proactiveSettings) {
          setProactiveSettings({ ...DEFAULT_PROACTIVE_SETTINGS, ...char.proactiveSettings })
        } else {
          setProactiveSettings(DEFAULT_PROACTIVE_SETTINGS)
        }
      } catch {
        setProactiveSettings(DEFAULT_PROACTIVE_SETTINGS)
      }
    }

    loadProactiveSettings()
  }, [selectedContactId])

  // 保存表情包频率设置 — 写后端
  const handleEmojiFreqChange = useCallback(async (mode: FrequencyMode): Promise<void> => {
    setEmojiFreqMode(mode)
    if (!selectedContactId) return
    try {
      await window.electronAPI?.invoke('emoji:update-config', selectedContactId, { frequencyMode: mode })
    } catch (err) {
      console.error('保存表情包频率设置失败:', err)
    }
  }, [selectedContactId])

  // 保存主动消息设置
  const saveProactiveSettings = useCallback(async (settings: ProactiveSettings): Promise<void> => {
    setProactiveSettings(settings)
    if (!selectedContactId) return
    
    // 保存到后端角色配置
    try {
      await window.electronAPI?.invoke('character:update', {
        id: selectedContactId,
        updates: { proactiveSettings: settings }
      })
    } catch (err) {
      console.error('保存主动消息设置失败:', err)
    }
    
    // 同步到 notification-settings.json（供调度器使用）
    try {
      window.electronAPI?.send('notification:settings-updated', {
        morningHour: settings.morningHour,
        morningMinute: settings.morningMinute,
        nightHour: settings.nightHour,
        nightMinute: settings.nightMinute,
        missYouDelay: settings.missYouDelay
      })
    } catch (err) {
      console.error('保存通知设置失败:', err)
    }
  }, [selectedContactId])

  // 头像上传
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file || !selectedContactId) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      if (dataUrl) {
        // 保存到后端文件系统
        window.electronAPI?.invoke('avatar:save', { id: selectedContactId, dataUrl })
        // 更新角色配置中的 avatar 字段
        window.electronAPI?.invoke('character:update', {
          id: selectedContactId,
          updates: { avatar: dataUrl }
        })
        // 通知刷新
        setCustomAvatar(dataUrl)
        bumpAvatarVersion(selectedContactId)
      }
    }
    reader.readAsDataURL(file)
    // 清空 input 允许重复选择同一文件
    e.target.value = ''
  }

  if (!session || !selectedContactId) return null

  if (loading) {
    return (
      <div className="contact-detail">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
          加载中...
        </div>
      </div>
    )
  }

  const isImage = customAvatar && customAvatar.startsWith('data:image')
  const displayAvatar = isImage ? customAvatar : session.avatar

  const maskApiKey = (key: string): string => {
    if (!key) return '未设置'
    if (key.length <= 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  const providerLabels: Record<string, string> = {
    deepseek: 'DeepSeek',
    siliconflow: '硅基流动',
    mimo: 'MiMo（小米）',
    openai: 'OpenAI',
    ollama: 'Ollama（本地）'
  }

  const provider = (charData?.provider as string) || '未知'
  const model = (charData?.model as string) || '未知'
  const apiKey = (charData?.apiKey as string) || ''
  const persona = (charData?.persona as string) || ''
  const catchphrase = (charData?.catchphrase as string) || ''
  const traitsRaw = charData?.traits
  const traits: string[] = Array.isArray(traitsRaw)
    ? traitsRaw
    : typeof traitsRaw === 'string'
      ? traitsRaw.split(/[,，]/).map((t: string) => t.trim()).filter(Boolean)
      : []

  return (
    <div className="contact-detail">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        style={{ display: 'none' }}
      />

      <div className="contact-detail__titlebar">
        <button className="contact-detail__back" onClick={() => setSelectedContactId(null)}>
          ← 返回通讯录
        </button>
        <span className="contact-detail__title">对象详情</span>
        <div className="contact-detail__window-controls">
          <button className="contact-detail__win-btn" onClick={() => window.electronAPI?.minimize()} title="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="contact-detail__win-btn" onClick={() => window.electronAPI?.maximize()} title="最大化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="contact-detail__win-btn contact-detail__win-btn--close" onClick={() => window.electronAPI?.close()} title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1" />
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      <div className="contact-detail__body">
        <div className="contact-detail__profile">
          <div className="contact-detail__avatar contact-detail__avatar--editable" onClick={() => fileInputRef.current?.click()}>
            {isImage ? (
              <img src={displayAvatar} alt="avatar" />
            ) : (
              <span className="contact-detail__avatar-emoji">{displayAvatar}</span>
            )}
            <div className="contact-detail__avatar-overlay">修改头像</div>
          </div>
          <div className="contact-detail__name">{session.name}</div>
        </div>

        <div className="contact-detail__section">
          <div className="contact-detail__section-title">基本信息</div>

          <div className="contact-detail__row">
            <span className="contact-detail__label">模型服务</span>
            <span className="contact-detail__value">{providerLabels[provider] || provider}</span>
          </div>

          <div className="contact-detail__row">
            <span className="contact-detail__label">模型</span>
            <span className="contact-detail__value">{model}</span>
          </div>

          <div className="contact-detail__row">
            <span className="contact-detail__label">API Key</span>
            <div className="contact-detail__api-key">
              <span className="contact-detail__value">
                {showApiKey ? (apiKey || '未设置') : maskApiKey(apiKey)}
              </span>
              <button
                className="contact-detail__toggle-btn"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
        </div>

        <div className="contact-detail__section">
          <div className="contact-detail__section-title">性格设定</div>

          {traits.length > 0 && (
            <div className="contact-detail__traits">
              {traits.map((trait, i) => (
                <span key={i} className="contact-detail__trait-tag">{trait}</span>
              ))}
            </div>
          )}

          {catchphrase && (
            <div className="contact-detail__row">
              <span className="contact-detail__label">口头禅</span>
              <span className="contact-detail__value contact-detail__value--catchphrase">{catchphrase}</span>
            </div>
          )}
        </div>

        {persona && (
          <div className="contact-detail__section">
            <div className="contact-detail__section-title">人设描述</div>
            <div className="contact-detail__persona">{persona}</div>
          </div>
        )}

        {/* 表情包设置 */}
        <div className="contact-detail__section">
          <div className="contact-detail__section-title">表情包设置</div>
          
          <div className="contact-detail__row">
            <span className="contact-detail__label">AI发表情包频率</span>
            <div className="contact-detail__emoji-freq">
              <label className="contact-detail__radio">
                <input 
                  type="radio" 
                  name="emojiFreq" 
                  value="follow_user" 
                  checked={emojiFreqMode === 'follow_user'}
                  onChange={() => handleEmojiFreqChange('follow_user')}
                />
                <span>跟随用户频率</span>
              </label>
              <label className="contact-detail__radio">
                <input 
                  type="radio" 
                  name="emojiFreq" 
                  value="every_message"
                  checked={emojiFreqMode === 'every_message'}
                  onChange={() => handleEmojiFreqChange('every_message')}
                />
                <span>每句话都发</span>
              </label>
              <label className="contact-detail__radio">
                <input 
                  type="radio" 
                  name="emojiFreq" 
                  value="random"
                  checked={emojiFreqMode === 'random'}
                  onChange={() => handleEmojiFreqChange('random')}
                />
                <span>随机概率发</span>
              </label>
            </div>
          </div>
        </div>

        {/* 主动消息设置 */}
        <div className="contact-detail__section">
          <div className="contact-detail__section-title">主动消息</div>

          <div className="contact-detail__row">
            <span className="contact-detail__label">启用主动消息</span>
            <label className="contact-detail__toggle">
              <input
                type="checkbox"
                checked={proactiveSettings.enabled}
                onChange={(e) => saveProactiveSettings({ ...proactiveSettings, enabled: e.target.checked })}
              />
              <span className="contact-detail__toggle-slider"></span>
            </label>
          </div>

          {proactiveSettings.enabled && (
            <>
              {/* 时间设置 */}
              <div className="contact-detail__row">
                <span className="contact-detail__label">早安时间</span>
                <div className="contact-detail__time-input">
                  <input
                    type="number"
                    min="5"
                    max="12"
                    value={proactiveSettings.morningHour}
                    onChange={(e) => saveProactiveSettings({ ...proactiveSettings, morningHour: parseInt(e.target.value) || 8 })}
                    className="contact-detail__time-input__number"
                  />
                  <span>:</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={proactiveSettings.morningMinute}
                    onChange={(e) => saveProactiveSettings({ ...proactiveSettings, morningMinute: parseInt(e.target.value) || 0 })}
                    className="contact-detail__time-input__number"
                  />
                </div>
              </div>

              <div className="contact-detail__row">
                <span className="contact-detail__label">晚安时间</span>
                <div className="contact-detail__time-input">
                  <input
                    type="number"
                    min="20"
                    max="28"
                    value={proactiveSettings.nightHour > 24 ? proactiveSettings.nightHour - 24 : proactiveSettings.nightHour}
                    onChange={(e) => saveProactiveSettings({ ...proactiveSettings, nightHour: parseInt(e.target.value) || 23 })}
                    className="contact-detail__time-input__number"
                  />
                  <span>:</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={proactiveSettings.nightMinute}
                    onChange={(e) => saveProactiveSettings({ ...proactiveSettings, nightMinute: parseInt(e.target.value) || 0 })}
                    className="contact-detail__time-input__number"
                  />
                </div>
              </div>

              {/* 消息类型开关 */}
              <div className="contact-detail__row">
                <span className="contact-detail__label">消息类型</span>
                <div className="contact-detail__checkbox-group">
                  <label className="contact-detail__checkbox">
                    <input
                      type="checkbox"
                      checked={proactiveSettings.types.morning}
                      onChange={(e) => saveProactiveSettings({
                        ...proactiveSettings,
                        types: { ...proactiveSettings.types, morning: e.target.checked }
                      })}
                    />
                    <span>早安消息</span>
                  </label>
                  <label className="contact-detail__checkbox">
                    <input
                      type="checkbox"
                      checked={proactiveSettings.types.night}
                      onChange={(e) => saveProactiveSettings({
                        ...proactiveSettings,
                        types: { ...proactiveSettings.types, night: e.target.checked }
                      })}
                    />
                    <span>晚安消息</span>
                  </label>
                  <label className="contact-detail__checkbox">
                    <input
                      type="checkbox"
                      checked={proactiveSettings.types.missYou}
                      onChange={(e) => saveProactiveSettings({
                        ...proactiveSettings,
                        types: { ...proactiveSettings.types, missYou: e.target.checked }
                      })}
                    />
                    <span>想你了</span>
                  </label>
                </div>
              </div>

              {/* 想你了 - 离开时间设置 */}
              {proactiveSettings.types.missYou && (
                <div className="contact-detail__row">
                  <span className="contact-detail__label">离开多久后发送</span>
                  <div className="contact-detail__delay-input">
                    <input
                      type="number"
                      min="5"
                      max="480"
                      value={proactiveSettings.missYouDelay}
                      onChange={(e) => saveProactiveSettings({ ...proactiveSettings, missYouDelay: parseInt(e.target.value) || 60 })}
                      className="contact-detail__time-input__number"
                    />
                    <span>分钟后</span>
                  </div>
                  <div className="contact-detail__time-input">
                    <span>每天最多触发</span>
                    <input
                      type="number"
                      value={proactiveSettings.maxMissYouPerDay ?? 3}
                      min={1}
                      max={20}
                      onChange={(e) => saveProactiveSettings({ ...proactiveSettings, maxMissYouPerDay: parseInt(e.target.value) || 3 })}
                      className="contact-detail__time-input__number"
                    />
                    <span>次</span>
                  </div>
                  <span className="contact-detail__hint">内容由角色人设自动生成</span>
                </div>
              )}

              {/* 测试按钮 */}
              <div className="contact-detail__row">
                <span className="contact-detail__label">测试</span>
                <button
                  className="contact-detail__test-btn"
                  onClick={async () => {
                    const testMsg = `测试消息：${session.name}想你了~`
                    
                    // 1. 触发应用内通知
                    window.dispatchEvent(new CustomEvent('proactive:test', {
                      detail: {
                        characterId: selectedContactId,
                        characterName: session.name,
                        content: testMsg
                      }
                    }))
                    
                    // 2. 显示系统级通知窗口
                    await window.electronAPI?.invoke('test-notification', {
                      characterId: selectedContactId,
                      characterName: session.name,
                      content: testMsg
                    })
                    
                    console.log('测试消息已发送:', testMsg)
                  }}
                >
                  发送测试消息
                </button>
              </div>

              {/* 弹窗设置 */}
              <div className="contact-detail__row">
                <span className="contact-detail__label">弹窗通知</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="contact-detail__test-btn"
                    onClick={async () => {
                      const result = await window.electronAPI?.invoke('notification:toggle') as { success: boolean; appEnabled?: boolean }
                      if (result?.success) {
                        alert(result.appEnabled ? '应用内弹窗已开启' : '应用内弹窗已关闭')
                      }
                    }}
                  >
                    开/关弹窗
                  </button>
                  <button
                    className="contact-detail__test-btn"
                    onClick={() => setShowNotificationSettings(true)}
                  >
                    设置样式
                  </button>
                </div>
              </div>

              {/* 消息内容预览 */}
              <div className="contact-detail__row">
                <span className="contact-detail__label">消息风格</span>
                <span className="contact-detail__hint">
                  根据角色人设自动生成，如"{session.name}的说话风格"
                </span>
              </div>
            </>
          )}
        </div>

        {/* 视觉模型设置 */}
        <div className="contact-detail__section">
          <div className="contact-detail__section-title">视觉模型（图片理解）</div>
          <div className="contact-detail__row">
            <span className="contact-detail__label">启用视觉</span>
            <label className="contact-detail__toggle">
              <input
                type="checkbox"
                checked={!!charData?.visionEnabled}
                onChange={async (e) => {
                  if (!selectedContactId) return
                  await window.electronAPI?.invoke('character:update', {
                    id: selectedContactId,
                    updates: { visionEnabled: e.target.checked }
                  })
                  // 刷新数据
                  const charList = await window.electronAPI?.invoke('character:list') as Array<Record<string, unknown>> | null
                  const char = charList?.find(c => c.id === selectedContactId)
                  setCharData(char || null)
                }}
              />
              <span className="contact-detail__toggle-slider"></span>
            </label>
          </div>
          {charData && (charData as any).visionEnabled && (
            <>
              <div className="contact-detail__row">
                <span className="contact-detail__label">视觉模型</span>
                <select
                  className="contact-detail__input"
                  value={(charData.visionModel as string) || ''}
                  onChange={(e) => {
                    const model = e.target.value
                    const modelConfig: Record<string, { baseUrl: string; provider: string }> = {
                      'glm-4.6v-flash': { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', provider: 'zhipu' },
                      'glm-4.7': { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', provider: 'zhipu' },
                      'zai-org/GLM-4.6V': { baseUrl: 'https://api.siliconflow.cn/v1', provider: 'siliconflow' },
                      'zai-org/GLM-4.7': { baseUrl: 'https://api.siliconflow.cn/v1', provider: 'siliconflow' },
                      'gpt-4o': { baseUrl: 'https://api.openai.com/v1', provider: 'openai' },
                      'gpt-4o-mini': { baseUrl: 'https://api.openai.com/v1', provider: 'openai' },
                      'gemini-2.0-flash': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', provider: 'google' },
                    }
                    const config = modelConfig[model] || { baseUrl: '', provider: '' }
                    setCharData(prev => prev ? { ...prev, visionModel: model, visionBaseUrl: config.baseUrl, visionProvider: config.provider } : prev)
                  }}
                >
                  <option value="">请选择视觉模型</option>
                  <optgroup label="硅基流动（新用户送额度）">
                    <option value="zai-org/GLM-4.6V">GLM-4.6V（推荐）</option>
                    <option value="zai-org/GLM-4.7">GLM-4.7（更强）</option>
                  </optgroup>
                  <optgroup label="智谱AI（免费）">
                    <option value="glm-4.6v-flash">GLM-4.6V-Flash（免费）</option>
                    <option value="glm-4.7">GLM-4.7（付费）</option>
                  </optgroup>
                  <optgroup label="OpenAI">
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o-mini</option>
                  </optgroup>
                  <optgroup label="Google">
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash（免费）</option>
                  </optgroup>
                </select>
              </div>
              <div className="contact-detail__row">
                <span className="contact-detail__label">视觉 API Key</span>
                <input
                  type="password"
                  className="contact-detail__input"
                  value={(charData.visionApiKey as string) || ''}
                  placeholder="填入对应模型的 API Key"
                  onChange={(e) => setCharData(prev => prev ? { ...prev, visionApiKey: e.target.value } : prev)}
                />
              </div>
              <div className="contact-detail__row">
                <span className="contact-detail__label">Base URL</span>
                <input
                  type="text"
                  className="contact-detail__input"
                  value={(charData.visionBaseUrl as string) || ''}
                  placeholder="https://open.bigmodel.cn/api/paas/v4"
                  onChange={(e) => setCharData(prev => prev ? { ...prev, visionBaseUrl: e.target.value } : prev)}
                />
              </div>
              <div className="contact-detail__row">
                <button
                  className="contact-detail__save-btn"
                  onClick={async () => {
                    if (!selectedContactId) return
                    await window.electronAPI?.invoke('character:update', {
                      id: selectedContactId,
                      updates: {
                        visionModel: (charData as any).visionModel,
                        visionApiKey: (charData as any).visionApiKey,
                        visionBaseUrl: (charData as any).visionBaseUrl
                      }
                    })
                    alert('保存成功')
                  }}
                >
                  保存视觉配置
                </button>
              </div>
              <div className="contact-detail__hint">
                智谱 Key 在 open.bigmodel.cn 申请（免费额度每天1500次）
              </div>
            </>
          )}
        </div>
      </div>

      {/* 通知弹窗设置面板 */}
      {showNotificationSettings && (
        <NotificationSettingsPanel
          onClose={() => setShowNotificationSettings(false)}
        />
      )}
    </div>
  )
}