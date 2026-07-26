// src/renderer/components/notification/NotificationCenter.tsx
// 灵动岛通知中心 — 模仿 iPhone 灵动岛风格的消息弹窗
// 内置功能，用于显示AI角色的主动消息

import { useState, useEffect, useCallback, useRef } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { kvGet } from '../../ipc/storage'
import './NotificationCenter.css'

interface ProactiveMessage {
  characterId: string
  characterName: string
  content: string
  avatar?: string
  timestamp: number
}

type NotificationState = 'hidden' | 'capsule' | 'expanded' | 'dismissed'

// 弹窗设置类型
interface NotificationStyleSettings {
  appEnabled: boolean
  appWidth: number
  appHeight: number
  appFontSize: number
  appFontColor: string
  appBgColor: string
  appStaySeconds: number
}

const DEFAULT_STYLE_SETTINGS: NotificationStyleSettings = {
  appEnabled: true,
  appWidth: 400,
  appHeight: 80,
  appFontSize: 14,
  appFontColor: '#1a1a1a',
  appBgColor: 'rgba(255, 255, 255, 0.95)',
  appStaySeconds: 5,
}

export function NotificationCenter(): React.JSX.Element {
  const [state, setState] = useState<NotificationState>('hidden')
  const [messages, setMessages] = useState<ProactiveMessage[]>([])
  const [expandedMsg, setExpandedMsg] = useState<ProactiveMessage | null>(null)
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [styleSettings, setStyleSettings] = useState<NotificationStyleSettings>(DEFAULT_STYLE_SETTINGS)
  
  const characters = useChatStore((s) => s.characters) || []
  const currentCharacterId = useChatStore((s) => s.currentCharacterId)

  // 加载样式设置
  useEffect(() => {
    const loadSettings = async () => {
      const saved = await kvGet<Partial<NotificationStyleSettings>>('notification-settings')
      if (saved) setStyleSettings({ ...DEFAULT_STYLE_SETTINGS, ...saved })
    }
    loadSettings()
    const handleSettingsChange = () => loadSettings()
    window.addEventListener('notification-settings-changed', handleSettingsChange)
    return () => window.removeEventListener('notification-settings-changed', handleSettingsChange)
  }, [])

  // 自动消失计时器（使用设置中的停留时间）
  const startDismissTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const stayMs = (styleSettings.appStaySeconds || 5) * 1000
    timerRef.current = setTimeout(() => {
      setClosing(true)
      setTimeout(() => {
        setState('dismissed')
        setClosing(false)
      }, 300)
    }, stayMs)
  }, [styleSettings.appStaySeconds])

  // 显示通知的通用函数
  const showNotification = useCallback((msg: ProactiveMessage) => {
    if (!styleSettings.appEnabled) return // 应用内弹窗已关闭
    setMessages(prev => [msg, ...prev].slice(0, 10))
    setState('capsule')
    startDismissTimer()
  }, [startDismissTimer, styleSettings.appEnabled])

  // 监听来自主进程的显示通知事件
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const data = args[0] as { characterId: string; characterName: string; content: string }
      if (!data) return

      const newMsg: ProactiveMessage = {
        characterId: data.characterId,
        characterName: data.characterName,
        content: data.content,
        avatar: characters?.find(c => c.id === data.characterId)?.avatar,
        timestamp: Date.now()
      }

      showNotification(newMsg)
    }

    window.electronAPI?.on('show-notification', handler)
    return () => { window.electronAPI?.off('show-notification', handler) }
  }, [characters, showNotification])

  // 监听主动消息（来自后端）
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const data = args[0] as { characterId: string; content: string }
      if (!data?.characterId || !data?.content) return

      const character = characters?.find(c => c.id === data.characterId)
      
      const newMsg: ProactiveMessage = {
        characterId: data.characterId,
        characterName: character?.name || '未知',
        content: data.content,
        avatar: character?.avatar,
        timestamp: Date.now()
      }

      showNotification(newMsg)
    }

    window.electronAPI?.on('proactive:message', handler)
    return () => { window.electronAPI?.off('proactive:message', handler) }
  }, [characters, showNotification])

  // 监听测试消息（来自前端）
  useEffect(() => {
    const testHandler = (e: Event) => {
      const data = (e as CustomEvent).detail as { characterId: string; characterName: string; content: string }
      if (!data) return

      const newMsg: ProactiveMessage = {
        characterId: data.characterId,
        characterName: data.characterName,
        content: data.content,
        avatar: undefined,
        timestamp: Date.now()
      }

      showNotification(newMsg)
    }

    window.addEventListener('proactive:test', testHandler)
    return () => window.removeEventListener('proactive:test', testHandler)
  }, [showNotification])

  // 点击展开
  const handleExpand = useCallback((msg: ProactiveMessage) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExpandedMsg(msg)
    setState('expanded')
  }, [])

  // 点击跳转到对话
  const handleJumpToChat = useCallback((characterId: string) => {
    const event = new CustomEvent('character:select', { detail: { characterId } })
    window.dispatchEvent(event)
    
    setClosing(true)
    setTimeout(() => {
      setState('hidden')
      setClosing(false)
      setExpandedMsg(null)
    }, 300)
  }, [])

  // 关闭通知
  const handleClose = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setClosing(true)
    setTimeout(() => {
      setState('hidden')
      setClosing(false)
      setExpandedMsg(null)
    }, 300)
  }, [])

  // 最新消息
  const latestMsg = messages[0] || null

  if (state === 'hidden' || state === 'dismissed') return <></>

  // 应用样式设置到内联样式
  const capsuleStyle = {
    width: `${styleSettings.appWidth}px`,
    minHeight: `${styleSettings.appHeight}px`,
    fontSize: `${styleSettings.appFontSize}px`,
    color: styleSettings.appFontColor,
    background: styleSettings.appBgColor,
  }

  const messageStyle = {
    fontSize: `${styleSettings.appFontSize - 2}px`,
    color: styleSettings.appFontColor,
  }

  const nameStyle = {
    fontSize: `${styleSettings.appFontSize - 1}px`,
    color: styleSettings.appFontColor,
  }

  return (
    <div className={`notification-center ${closing ? 'closing' : ''}`}>
      {/* 胶囊状态 */}
      {state === 'capsule' && latestMsg && (
        <div 
          className="notification-capsule"
          style={capsuleStyle}
          onClick={() => handleExpand(latestMsg)}
        >
          <div className="capsule-avatar">
            {latestMsg.avatar ? (
              <img src={latestMsg.avatar} alt={latestMsg.characterName} />
            ) : (
              <span>{latestMsg.characterName.charAt(0)}</span>
            )}
          </div>
          <div className="capsule-content">
            <div className="capsule-name" style={nameStyle}>{latestMsg.characterName}</div>
            <div className="capsule-message" style={messageStyle}>{latestMsg.content}</div>
          </div>
          <div className="capsule-badge">{messages.length}</div>
        </div>
      )}

      {/* 展开状态 */}
      {state === 'expanded' && expandedMsg && (
        <div className="notification-expanded">
          <div className="expanded-header">
            <div className="expanded-avatar">
              {expandedMsg.avatar ? (
                <img src={expandedMsg.avatar} alt={expandedMsg.characterName} />
              ) : (
                <span>{expandedMsg.characterName.charAt(0)}</span>
              )}
            </div>
            <div className="expanded-info">
              <div className="expanded-name">{expandedMsg.characterName}</div>
              <div className="expanded-time">{formatTime(expandedMsg.timestamp)}</div>
            </div>
            <button className="expanded-close" onClick={handleClose}>×</button>
          </div>
          <div className="expanded-body">{expandedMsg.content}</div>
          <div className="expanded-footer">
            <button 
              className="expanded-action"
              onClick={() => handleJumpToChat(expandedMsg.characterId)}
            >
              查看对话
            </button>
          </div>
          
          {/* 历史消息列表 */}
          {messages.length > 1 && (
            <div className="expanded-history">
              {messages.slice(1, 4).map((msg, i) => (
                <div 
                  key={`${msg.characterId}-${msg.timestamp}-${i}`}
                  className="history-item"
                  onClick={() => handleExpand(msg)}
                >
                  <span className="history-name">{msg.characterName}</span>
                  <span className="history-content">{msg.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(timestamp: number): string {
  const now = Date.now()
  const diff = Math.floor((now - timestamp) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
