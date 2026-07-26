// src/renderer/components/layout/ChatList.tsx
// 中间聊天列表 — 搜索 + 对话列表 + 新建对象对话框

import { useState, useCallback, useEffect, useRef } from 'react'
import { ChatItem } from '../chat/ChatItem'
import { useChatSessionStore } from '../../stores/chatSessionStore'
import { useChatStore } from '../../stores/chatStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { useChatListStore } from '../../stores/chatListStore'
import './ChatList.css'

interface MessageSearchResult {
  id: string
  content: string
  role: string
  timestamp: number
}

export function ChatList(): React.JSX.Element {
  const [searchText, setSearchText] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const { currentSession, setCurrentSession } = useChatSessionStore()
  const setCurrentCharacter = useChatStore((s) => s.setCurrentCharacter)
  const setTotalUnread = useUnreadStore((s) => s.setTotalUnread)
  const { sessions, markRead, getTotalUnread } = useChatListStore()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTotalUnread(getTotalUnread())
  }, [sessions, setTotalUnread, getTotalUnread])

  const handleSelect = useCallback((session: typeof sessions[0]): void => {
    setCurrentSession({
      id: session.id,
      name: session.name,
      avatar: session.avatar,
      online: session.online
    })
    setCurrentCharacter(session.id)
    markRead(session.id)

    // 同步最新消息到聊天列表
    const chatData = useChatStore.getState().messagesByCharacter[session.id]
    if (chatData && chatData.length > 0) {
      const lastMsg = chatData[chatData.length - 1]
      const content = lastMsg.content.length > 20
        ? lastMsg.content.slice(0, 20) + '...'
        : lastMsg.content
      useChatListStore.getState().updateLastMessage(session.id, content)
    }
  }, [setCurrentSession, setCurrentCharacter, markRead])

  const handleCharacterCreated = useCallback((char: { id: string; name: string; avatar: string }): void => {
    useChatListStore.getState().addSession({
      id: char.id,
      name: char.name,
      avatar: char.avatar,
      lastMessage: '开始聊天吧~',
      time: '刚刚',
      unread: 0,
      online: true,
      pinned: false,
      avatarVersion: 0
    })
    setCurrentCharacter(char.id)
    setCurrentSession({
      id: char.id,
      name: char.name,
      avatar: char.avatar,
      online: true
    })
    setShowCreate(false)
  }, [setCurrentCharacter, setCurrentSession])

  const filteredSessions = sessions.filter((s) =>
    s.name.toLowerCase().includes(searchText.toLowerCase())
  )

  // 搜索聊天消息
  const handleMessageSearch = useCallback(async (query: string): Promise<void> => {
    if (!query.trim()) {
      setShowMessageSearch(false)
      setSearchResults([])
      return
    }

    // 如果有当前会话，搜索该会话的消息
    if (currentSession?.id) {
      // 确保消息已加载
      const store = useChatStore.getState()
      let messages = store.messagesByCharacter[currentSession.id]

      if (!messages || messages.length === 0) {
        await store.loadCharacterMessages(currentSession.id)
        messages = useChatStore.getState().messagesByCharacter[currentSession.id] || []
      }

      const kw = query.toLowerCase()
      const matched = messages.filter((m) =>
        m.content.toLowerCase().includes(kw)
      ).map((m) => ({
        id: m.id,
        content: m.content,
        role: m.role,
        timestamp: m.timestamp
      }))
      setSearchResults(matched)
      setShowMessageSearch(true)
    }
  }, [currentSession?.id])

  // 清除搜索结果
  const clearMessageSearch = useCallback((): void => {
    setSearchResults([])
    setShowMessageSearch(false)
    setSearchText('')
  }, [])

  // 跳转到消息（通过自定义事件通知 ChatWindow）
  const handleJumpToMessage = useCallback((messageId: string): void => {
    window.dispatchEvent(new CustomEvent('search:jumpTo', { detail: { messageId } }))
  }, [])

  return (
    <div className="chat-list">
      <div className="chat-list__header">
        <div className="chat-list__search-wrapper">
          <span className="chat-list__search-icon">🔍</span>
          <input
            ref={searchInputRef}
            type="text"
            className="chat-list__search-input"
            placeholder={currentSession ? `搜索「${currentSession.name}」的消息...` : '搜索联系人'}
            value={searchText}
            onChange={(e) => {
              const val = e.target.value
              setSearchText(val)
              if (val && currentSession) {
                handleMessageSearch(val)
              } else {
                setShowMessageSearch(false)
                setSearchResults([])
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                clearMessageSearch()
              }
            }}
          />
          {showMessageSearch && (
            <button className="chat-list__search-clear" onClick={clearMessageSearch}>×</button>
          )}
        </div>
        <button className="chat-list__add-btn" onClick={() => setShowCreate(true)} title="新建对象">+</button>
      </div>

      {/* 搜索结果 */}
      {showMessageSearch && (
        <div className="chat-list__search-results">
          {searchResults.length > 0 ? (
            <>
              <div className="chat-list__search-count">找到 {searchResults.length} 条结果</div>
              {searchResults.slice(0, 20).map((r) => (
                <div
                  key={r.id}
                  className="chat-list__search-item"
                  onClick={() => { handleJumpToMessage(r.id); clearMessageSearch() }}
                >
                  <div className="chat-list__search-item-content">
                    {r.content.length > 30 ? r.content.slice(0, 30) + '...' : r.content}
                  </div>
                  <div className="chat-list__search-item-time">
                    {new Date(r.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="chat-list__search-empty">没有找到相关消息</div>
          )}
        </div>
      )}

      <div className="chat-list__items">
        {filteredSessions.map((session) => (
          <ChatItem
            key={session.id}
            id={session.id}
            name={session.name}
            avatar={session.avatar}
            lastMessage={session.lastMessage}
            time={session.time}
            unread={session.unread}
            online={session.online}
            pinned={session.pinned}
            selected={session.id === currentSession?.id}
            onClick={() => handleSelect(session)}
            avatarVersion={session.avatarVersion}
          />
        ))}
      </div>

      {showCreate && (
        <CreateCharacterOverlay onClose={() => setShowCreate(false)} onCreated={handleCharacterCreated} />
      )}
    </div>
  )
}

// ============================================================
// 创建角色对话框
// ============================================================

// DeepSeek 官方: https://api-docs.deepseek.com
// MiMo 官方: https://mimo.mi.com/docs/zh-CN/quick-start/summary/model
import { PROVIDERS } from '@shared/constants'

const MODEL_OPTIONS: Record<string, string[]> = {}
const BASE_URL_MAP: Record<string, string> = {}

for (const [key, config] of Object.entries(PROVIDERS)) {
  MODEL_OPTIONS[key] = config.models
  BASE_URL_MAP[key] = config.baseUrl
}

const TEMPLATE_LABELS: Record<string, string> = {
  gentle: '温柔体贴',
  funny: '活泼搞笑',
  tsundere: '高冷傲娇'
}

// 性格模板 — 点击追加到性格特点（不覆盖）
const PERSONALITY_TEMPLATES = [
  { id: 'gentle', label: '温柔体贴', traits: '温柔,体贴,善解人意' },
  { id: 'cute', label: '活泼可爱', traits: '活泼,可爱,元气满满' },
  { id: 'tsundere', label: '高冷傲娇', traits: '高冷,傲娇,毒舌' },
  { id: 'yandere', label: '病娇', traits: '病娇,占有欲强,极端执着' },
  { id: 'intellectual', label: '知性文艺', traits: '知性,文艺,有深度' },
] as const

function CreateCharacterOverlay({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (char: { id: string; name: string; avatar: string }) => void
}) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('🌸')
  const [selectedTemplate, setSelectedTemplate] = useState('gentle')
  const [traits, setTraits] = useState('')
  const [activeTraits, setActiveTraits] = useState<Set<string>>(new Set())
  const [catchphrase, setCatchphrase] = useState('')
  const [speechStyle, setSpeechStyle] = useState('')
  const [background, setBackground] = useState('')
  const [customPersona, setCustomPersona] = useState('')
  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('deepseek-v4-flash')
  const [apiKey, setApiKey] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const traitsInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      if (url) setAvatar(url)
    }
    reader.readAsDataURL(file)
  }

  const handleProviderChange = (newProvider: string): void => {
    setProvider(newProvider)
    const models = MODEL_OPTIONS[newProvider]
    if (models && models.length > 0) setModel(models[0])
    setApiKey('')
  }

  // 性格模板点击 — 追加不覆盖
  const handlePersonalityToggle = (tpl: typeof PERSONALITY_TEMPLATES[number]): void => {
    const newActive = new Set(activeTraits)
    if (newActive.has(tpl.id)) {
      // 取消选中 — 移除该模板的标签
      newActive.delete(tpl.id)
      const currentTraits = traits.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      const tplTraits = tpl.traits.split(',')
      const updated = currentTraits.filter((t) => !tplTraits.includes(t))
      setTraits(updated.join(','))
    } else {
      // 选中 — 追加标签
      newActive.add(tpl.id)
      const currentTraits = traits.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      const tplTraits = tpl.traits.split(',').filter((t) => !currentTraits.includes(t))
      const updated = [...currentTraits, ...tplTraits]
      setTraits(updated.join(','))
    }
    setActiveTraits(newActive)
  }

  // 构建完整人设文本
  const buildPersona = (): string => {
    const parts: string[] = []

    // 基本人设
    parts.push(`你是${name}，一个${traits || '温柔体贴'}的恋人。`)

    // 口头禅
    if (catchphrase) {
      parts.push(`你的口头禅是"${catchphrase}"。`)
    }

    // 说话风格
    if (speechStyle) {
      parts.push(`\n## 说话风格\n${speechStyle}`)
    }

    // 背景故事
    if (background) {
      parts.push(`\n## 背景故事\n${background}`)
    }

    // 自定义规则
    if (customPersona) {
      parts.push(`\n## 行为规则\n${customPersona}`)
    }

    // 基础规则
    parts.push(`\n## 基础规则
1. 保持角色一致性，不要出戏
2. 回复自然，像真人微信聊天
3. 可以用表情、语气词、叠字
4. 不要暴露自己是AI
5. 回复简短，不超过100字`)

    return parts.join('\n')
  }

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || isCreating) return
    setIsCreating(true)
    try {
      // 如果是自定义头像（base64），先用占位符创建角色，再保存图片
      const avatarValue = avatar.startsWith('data:') ? '🌸' : avatar
      const persona = buildPersona()

      const result = await window.electronAPI?.invoke('character:create', {
        templateId: selectedTemplate,
        name: name.trim(),
        avatar: avatarValue,
        persona,
        traits: traits ? traits.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : undefined,
        catchphrase: catchphrase || undefined,
        provider,
        model,
        apiKey: apiKey || undefined,
        baseUrl: BASE_URL_MAP[provider],
      })

      if (result && typeof result === 'object' && 'id' in result) {
        const charResult = result as { id: string; name: string; avatar: string }

        // 如果是自定义头像，保存到后端文件系统
        if (avatar.startsWith('data:')) {
          window.electronAPI?.invoke('avatar:save', { id: charResult.id, dataUrl: avatar })
          // 更新角色配置中的 avatar 字段为 data URL
          window.electronAPI?.invoke('character:update', {
            id: charResult.id,
            updates: { avatar }
          })
        }

        // 所有数据已保存到后端

        onCreated({ ...charResult, avatar: avatar.startsWith('data:') ? avatar : avatarValue })
      }
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="create-overlay" onClick={onClose}>
      <div className="create-card create-card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="create-card__header">
          <h3 className="create-card__title">创建新对象</h3>
          <button className="create-card__close" onClick={onClose}>×</button>
        </div>

        <div className="create-card__scroll">
          <div className="create-field">
            <label className="create-label">名称 *</label>
            <input className="create-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="给对象起个名字" autoFocus />
          </div>

          <div className="create-field">
            <label className="create-label">头像</label>
            <div className="create-avatar-row">
              <div className="create-avatar-box" onClick={() => fileInputRef.current?.click()}>
                {avatar.startsWith('data:') ? (
                  <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                ) : (
                  <span>{avatar}</span>
                )}
              </div>
              <span className="create-avatar-hint">点击上传图片或输入emoji</span>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            </div>
          </div>

          <div className="create-field">
            <label className="create-label">性格模板（点击追加，可多选）</label>
            <div className="create-personality-templates">
              {PERSONALITY_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  className={`create-personality-btn ${activeTraits.has(tpl.id) ? 'create-personality-btn--active' : ''}`}
                  onClick={() => handlePersonalityToggle(tpl)}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <div className="create-field">
            <label className="create-label">性格特点</label>
            <input
              ref={traitsInputRef}
              className="create-input"
              type="text"
              value={traits}
              onChange={(e) => setTraits(e.target.value)}
              placeholder="如：温柔,体贴,爱撒娇,有点小傲娇"
            />
            <span className="create-hint">逗号分隔，可手动编辑或从上方模板追加</span>
          </div>

          <div className="create-field">
            <label className="create-label">口头禅</label>
            <input className="create-input" type="text" value={catchphrase} onChange={(e) => setCatchphrase(e.target.value)} placeholder="如：嗯嗯~ / 哼，才不是呢" />
          </div>

          {/* 高级设置 */}
          <div className="create-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? '收起高级设置' : '展开高级设置（说话风格/背景/自定义规则）'}
          </div>

          {showAdvanced && (
            <>
              <div className="create-field">
                <label className="create-label">说话风格</label>
                <textarea
                  className="create-textarea"
                  value={speechStyle}
                  onChange={(e) => setSpeechStyle(e.target.value)}
                  placeholder={"如：\n- 每句话结尾喜欢加'呢'、'哦'、'嘛'\n- 开心时用颜文字 (◕‿◕)\n- 被夸的时候会害羞，回复变短\n- 喜欢用叠字：吃饭饭、睡觉觉"}
                  rows={4}
                />
              </div>

              <div className="create-field">
                <label className="create-label">背景故事</label>
                <textarea
                  className="create-textarea"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  placeholder={"如：\n- 大学生，学设计的\n- 喜欢猫、逛街、看综艺\n- 和你是异地恋"}
                  rows={3}
                />
              </div>

              <div className="create-field">
                <label className="create-label">自定义规则</label>
                <textarea
                  className="create-textarea"
                  value={customPersona}
                  onChange={(e) => setCustomPersona(e.target.value)}
                  placeholder={"如：\n- 提到工作时语气变认真\n- 深夜聊天更温柔\n- 吃醋时阴阳怪气\n- 生气不超过三句话就要和好"}
                  rows={4}
                />
              </div>
            </>
          )}

          <div className="create-field">
            <label className="create-label">模型服务</label>
            <select className="create-select" value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
              <option value="deepseek">DeepSeek（推荐）</option>
              <option value="siliconflow">硅基流动 SiliconFlow</option>
              <option value="mimo">MiMo（小米）</option>
              <option value="zhipu">智谱AI（GLM）</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama（本地部署）</option>
            </select>
          </div>

          <div className="create-field">
            <label className="create-label">模型名称</label>
            <select className="create-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {(MODEL_OPTIONS[provider] || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="create-field">
            <label className="create-label">API Key</label>
            <input className="create-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </div>
        </div>

        <div className="create-actions">
          <button className="create-btn create-btn--cancel" onClick={onClose}>取消</button>
          <button className="create-btn create-btn--ok" onClick={handleCreate} disabled={!name.trim() || isCreating}>
            {isCreating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}