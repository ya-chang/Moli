// src/renderer/components/settings/SettingsPanel.tsx
// 设置面板 — 主题 + 字体大小 + 聊天背景 + 数据管理

import { useState, useEffect, useRef } from 'react'
import { useChatSessionStore } from '../../stores/chatSessionStore'
import { useChatBgStore } from '../../stores/chatBgStore'
import { useUIStore } from '../../stores/uiStore'
import { BannedWordsInline } from './BannedWordsInline'
import { PluginPage } from '../plugins/PluginPage'
import { APP_VERSION } from '@shared/constants'
import './SettingsPanel.css'

interface SettingsPanelProps {
  onClose: () => void
}

// 聊天背景预设
const BG_PRESETS = [
  { id: 'default', label: '默认', value: '#FFFFFF' },
  { id: 'warm', label: '暖色', value: '#FFF8F0' },
  { id: 'cool', label: '冷色', value: '#F0F8FF' },
  { id: 'green', label: '清新', value: '#F0FFF0' },
  { id: 'pink', label: '粉色', value: '#FFF0F5' },
  { id: 'dark', label: '深色', value: '#1A1A1A' },
]

// 弹窗设置接口
interface NotificationSettings {
  // 主动消息时间
  morningHour: number
  morningMinute: number
  nightHour: number
  nightMinute: number
  // 应用内弹窗
  appWidth: number
  appHeight: number
  appFontSize: number
  appFontColor: string
  appBgColor: string
  appStaySeconds: number
  // 屏幕外弹窗
  screenEnabled: boolean
  screenWidth: number
  screenHeight: number
  screenFontSize: number
  screenFontColor: string
  screenBgColor: string
  screenStaySeconds: number
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  morningHour: 8,
  morningMinute: 0,
  nightHour: 23,
  nightMinute: 0,
  appWidth: 400,
  appHeight: 80,
  appFontSize: 14,
  appFontColor: '#1a1a1a',
  appBgColor: 'rgba(255, 255, 255, 0.95)',
  appStaySeconds: 5,
  screenEnabled: true,
  screenWidth: 400,
  screenHeight: 80,
  screenFontSize: 14,
  screenFontColor: '#1a1a1a',
  screenBgColor: 'rgba(255, 255, 255, 0.95)',
  screenStaySeconds: 5,
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.JSX.Element {
  const [theme, setTheme] = useState('default')
  const [fontSize, setFontSize] = useState(14)
  const [chatBg, setChatBg] = useState('#FFFFFF')
  const [dataDir, setDataDir] = useState('加载中...')
  const [exportStatus, setExportStatus] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)

  // 不再隐藏WebView，设置面板本身有高z-index覆盖
  const [sourceStatus, setSourceStatus] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [showPlugins, setShowPlugins] = useState(false)
  const currentSession = useChatSessionStore((s) => s.currentSession)
  const chatBgStore = useChatBgStore()
  const bgInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 从文件系统加载设置
    window.electronAPI?.invoke('settings:load').then((result: any) => {
      if (result) {
        const t = result.theme || 'default'
        setTheme(t)
        document.documentElement.setAttribute('data-theme', t)
        setFontSize(result.fontSize || 14)
        if (result.sourceUrl) setSourceUrl(result.sourceUrl)
        if (result.notificationSettings) {
          setNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, ...result.notificationSettings })
        }
      }
    }).catch(() => {})

    // 加载实际数据目录路径
    window.electronAPI?.invoke('data:getPath').then((result: any) => {
      if (result && typeof result === 'string') {
        setDataDir(result)
      }
    }).catch(() => {})

    if (currentSession?.id) {
      const bg = chatBgStore.getBg(currentSession.id)
      setChatBg(bg)
    }
    // 检查音源状态
    window.electronAPI?.invoke('music:sourceStatus').then((result) => {
      const r = result as { loaded: boolean; info?: { name?: string } }
      if (r.loaded) {
        setSourceStatus(`已加载: ${r.info?.name || '未知音源'}`)
      }
    }).catch(() => {})
  }, [currentSession?.id])

  const saveSettings = (updates: Record<string, unknown>): void => {
    window.electronAPI?.invoke('settings:save', updates).catch(() => {})
  }

  const handleThemeChange = (newTheme: string): void => {
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    saveSettings({ theme: newTheme })
  }

  const handleFontSizeChange = (size: number): void => {
    setFontSize(size)
    document.documentElement.style.setProperty('--font-size-base', `${size}px`)
    saveSettings({ fontSize: size })
  }

  const handleNotificationSettingsChange = (updates: Partial<NotificationSettings>): void => {
    const newSettings = { ...notificationSettings, ...updates }
    setNotificationSettings(newSettings)
    saveSettings({ notificationSettings: newSettings })
    // 通知主进程更新设置
    window.electronAPI?.send('notification:settings-updated', newSettings)
    // 如果更新了早安/晚安时间，通知调度器
    if (updates.morningHour !== undefined || updates.morningMinute !== undefined) {
      window.electronAPI?.send('scheduler:update-time', {
        triggerId: 'morning',
        hour: newSettings.morningHour,
        minute: newSettings.morningMinute
      })
    }
    if (updates.nightHour !== undefined || updates.nightMinute !== undefined) {
      window.electronAPI?.send('scheduler:update-time', {
        triggerId: 'night',
        hour: newSettings.nightHour,
        minute: newSettings.nightMinute
      })
    }
  }

  const handleChatBgChange = (bg: string): void => {
    setChatBg(bg)
    if (currentSession?.id) {
      chatBgStore.setBg(currentSession.id, bg)
    }
  }

  const handleCustomBgUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        setChatBg(result)
        if (currentSession?.id) {
          chatBgStore.setBg(currentSession.id, result)
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleExport = async (): Promise<void> => {
    setExportStatus('导出中...')
    try {
      const result = await window.electronAPI?.invoke('data:export')
      if (result && typeof result === 'object' && 'success' in result) {
        setExportStatus(result.success ? '导出成功' : '导出失败')
      }
    } catch {
      setExportStatus('导出失败')
    }
    setTimeout(() => setExportStatus(''), 3000)
  }

  const handleChooseDataDir = async (): Promise<void> => {
    const result = await window.electronAPI?.invoke('data:chooseDir')
    const r = result as Record<string, unknown>
    if (r?.success && r.path) {
      setDataDir(r.path as string)
    }
  }

  const handleImport = async (): Promise<void> => {
    setImportStatus('导入中...')
    try {
      const result = await window.electronAPI?.invoke('data:import')
      if (result && typeof result === 'object' && 'success' in result) {
        setImportStatus(result.success ? '导入成功' : '导入失败')
      }
    } catch {
      setImportStatus('导入失败')
    }
    setTimeout(() => setImportStatus(''), 3000)
  }

  const handleLoadSource = async (): Promise<void> => {
    if (!sourceUrl.trim()) return
    setSourceLoading(true)
    setSourceStatus('加载中（可能需要10-30秒）...')
    try {
      const result = await window.electronAPI?.invoke('music:loadSource', sourceUrl.trim()) as {
        success: boolean
        data?: { name?: string }
        sources?: Record<string, unknown>
        error?: string
      }
      if (result.success) {
        const sourceNames = result.sources ? Object.keys(result.sources).join(', ') : ''
        setSourceStatus(`已加载: ${result.data?.name || '未知音源'}${sourceNames ? ` (${sourceNames})` : ''}`)
        saveSettings({ sourceUrl: sourceUrl.trim() })
      } else {
        setSourceStatus(`失败: ${result.error || '未知错误'}`)
      }
    } catch (err) {
      setSourceStatus(`失败: ${err instanceof Error ? err.message : '通信错误'}`)
    }
    setSourceLoading(false)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>设置</h3>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          {/* 主题 */}
          <div className="settings-section">
            <h4>主题</h4>
            <div className="settings-theme-list">
              {[
                { id: 'default', label: '默认绿', color: '#07C160' },
                { id: 'dark', label: '暗色', color: '#1A1A1A' },
                { id: 'pink', label: '粉色', color: '#FF6B9D' },
              ].map((t) => (
                <div key={t.id} className={`settings-theme-item ${theme === t.id ? 'settings-theme-item--active' : ''}`} onClick={() => handleThemeChange(t.id)}>
                  <div className="settings-theme-color" style={{ background: t.color }} />
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 字体大小 */}
          <div className="settings-section">
            <h4>字体大小</h4>
            <div className="settings-font-preview" style={{ fontSize: `${fontSize}px` }}>
              预览文字 Aa 字体大小
            </div>
            <div className="settings-slider-row">
              <span className="settings-slider-label">小</span>
              <input
                type="range"
                min="12"
                max="20"
                value={fontSize}
                onChange={(e) => handleFontSizeChange(Number(e.target.value))}
                className="settings-slider"
              />
              <span className="settings-slider-label">大</span>
              <span className="settings-slider-value">{fontSize}px</span>
            </div>
          </div>

          {/* 聊天背景 */}
          <div className="settings-section">
            <h4>聊天背景</h4>
            {currentSession && (
              <p className="settings-hint">当前角色：{currentSession.name}（背景独立设置）</p>
            )}
            <div className="settings-bg-list">
              {BG_PRESETS.map((bg) => (
                <div
                  key={bg.id}
                  className={`settings-bg-item ${chatBg === bg.value ? 'settings-bg-item--active' : ''}`}
                  onClick={() => handleChatBgChange(bg.value)}
                >
                  <div className="settings-bg-preview" style={{ background: bg.value }} />
                  <span>{bg.label}</span>
                </div>
              ))}
              <div className="settings-bg-item" onClick={() => bgInputRef.current?.click()}>
                <div className="settings-bg-preview settings-bg-preview--custom">+</div>
                <span>自定义</span>
              </div>
            </div>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              onChange={handleCustomBgUpload}
              style={{ display: 'none' }}
            />
          </div>

          {/* 通知设置已移到通讯录对象详情页面 */}

          {/* 数据管理 */}
          <div className="settings-section">
            <h4>数据管理</h4>
            <p className="settings-hint">所有用户数据统一存放在一个目录下，按类型分文件夹</p>
            <div className="settings-data-actions">
              <div className="settings-data-item" onClick={handleChooseDataDir} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="settings-data-title">数据存放目录</div>
                  <div className="settings-data-desc">{dataDir}</div>
                </div>
                <button className="settings-btn">选择目录</button>
              </div>
              <div className="settings-data-item">
                <div>
                  <div className="settings-data-title">导出数据</div>
                  <div className="settings-data-desc">导出所有角色、记忆、朋友圈数据</div>
                </div>
                <button className="settings-btn" onClick={handleExport} disabled={!!exportStatus}>
                  {exportStatus || '导出'}
                </button>
              </div>
              <div className="settings-data-item">
                <div>
                  <div className="settings-data-title">导入数据</div>
                  <div className="settings-data-desc">从备份文件恢复数据</div>
                </div>
                <button className="settings-btn" onClick={handleImport} disabled={!!importStatus}>
                  {importStatus || '导入'}
                </button>
              </div>
            </div>
          </div>

          {/* 禁词箱子 */}
          <div className="settings-section">
            <h4>禁词箱子</h4>
            <p className="settings-hint">AI不会在回复中使用以下词语</p>
            <BannedWordsInline />
          </div>

          {/* 数据备份 */}
          <BackupSettings />

          {/* 插件管理 */}
          <div className="settings-section">
            <h4>插件管理</h4>
            <p className="settings-hint">安装和管理扩展插件</p>
            <div className="settings-data-actions">
              <div className="settings-data-item" onClick={() => setShowPlugins(true)} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="settings-data-title">插件管理</div>
                  <div className="settings-data-desc">查看、安装、卸载插件</div>
                </div>
                <button className="settings-btn">打开</button>
              </div>
            </div>
          </div>

          {/* 关于 / 反馈 */}
          <div className="settings-section settings-about">
            <h4>关于 Moli</h4>
            <div className="settings-about__info">
              <div className="settings-about__item">
                <span className="settings-about__label">版本</span>
                <span className="settings-about__value">{APP_VERSION}</span>
              </div>
              <div className="settings-about__item">
                <span className="settings-about__label">制作人</span>
                <span className="settings-about__value">鸭肠yac</span>
              </div>
              <div className="settings-about__item">
                <span className="settings-about__label">联系邮箱</span>
                <span className="settings-about__value">3117797385@qq.com</span>
              </div>
              <div className="settings-about__item">
                <span className="settings-about__label">下载地址</span>
                <span className="settings-about__value" style={{ color: 'var(--primary-color)', cursor: 'pointer' }}
                  onClick={() => window.electronAPI?.send('shell:open', 'https://github.com/ya-chang/nilian/releases')}>
                  GitHub Releases
                </span>
              </div>
              <div className="settings-about__item">
                <span className="settings-about__label">检查更新</span>
                <span className="settings-about__value" style={{ color: 'var(--primary-color)', cursor: 'pointer' }}
                  onClick={() => window.electronAPI?.send('shell:open', 'https://github.com/ya-chang/nilian/releases/latest')}>
                  检查最新版本
                </span>
              </div>
            </div>
            <p className="settings-about__desc">
              感谢使用 Moli！如果你有任何建议或问题，欢迎通过邮箱联系我们。
            </p>
          </div>
        </div>
      </div>
      {showPlugins && <PluginPage onClose={() => setShowPlugins(false)} />}
    </div>
  )
}

// ─── 数据备份设置 ───

function BackupSettings(): React.JSX.Element {
  const [config, setConfig] = useState({ maxBackups: 7, backupHour: 3, backupMinute: 0 })
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [backups, setBackups] = useState<Array<{ date: string; size: number }>>([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    loadConfig()
    loadBackups()
  }, [])

  const loadConfig = async (): Promise<void> => {
    try {
      const result = await window.electronAPI?.invoke('backup:get-config')
      if (result && typeof result === 'object') {
        setConfig(result as { maxBackups: number; backupHour: number; backupMinute: number })
      }
    } catch { /* ignore */ }
  }

  const loadBackups = async (): Promise<void> => {
    try {
      const list = await window.electronAPI?.invoke('backup:list')
      if (Array.isArray(list)) setBackups(list)
      const statusResult = await window.electronAPI?.invoke('backup:get-status')
      if (statusResult && typeof statusResult === 'object' && 'lastBackup' in statusResult) {
        setLastBackup((statusResult as { lastBackup: string | null }).lastBackup)
      }
    } catch { /* ignore */ }
  }

  const handleBackupNow = async (): Promise<void> => {
    setStatus('备份中...')
    try {
      const result = await window.electronAPI?.invoke('backup:now') as { success: boolean; date: string }
      if (result?.success) {
        setStatus('备份完成')
        loadBackups()
      } else {
        setStatus('备份失败')
      }
    } catch {
      setStatus('备份失败')
    }
    setTimeout(() => setStatus(''), 3000)
  }

  const handleRestore = async (date: string): Promise<void> => {
    if (!confirm(`确定恢复 ${date} 的备份？当前数据将被覆盖。`)) return
    try {
      const result = await window.electronAPI?.invoke('backup:restore', { date }) as { success: boolean }
      if (result?.success) {
        setStatus('恢复完成，请重启应用')
      } else {
        setStatus('恢复失败')
      }
    } catch {
      setStatus('恢复失败')
    }
  }

  const handleConfigChange = async (updates: Partial<typeof config>): Promise<void> => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    await window.electronAPI?.invoke('backup:set-config', newConfig)
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="settings-section">
      <h4>数据备份</h4>
      <p className="settings-hint">自动备份数据，崩溃后可恢复</p>

      <div className="settings-data-actions">
        {/* 备份状态 */}
        <div className="settings-data-item">
          <div>
            <div className="settings-data-title">自动备份</div>
            <div className="settings-data-desc">
              每天 {String(config.backupHour).padStart(2, '0')}:{String(config.backupMinute).padStart(2, '0')} 自动备份，保留 {config.maxBackups} 份
              {lastBackup && ` · 上次备份：${lastBackup}`}
            </div>
          </div>
          <button className="settings-btn" onClick={handleBackupNow} disabled={status === '备份中...'}>
            {status || '立即备份'}
          </button>
        </div>

        {/* 备份配置 */}
        <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', minWidth: 60 }}>备份时间</label>
            <input
              type="number"
              min={0}
              max={23}
              value={config.backupHour}
              onChange={(e) => handleConfigChange({ backupHour: Number(e.target.value) })}
              style={{ width: 50, padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 'var(--font-size-sm)' }}
            />
            <span>:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={config.backupMinute}
              onChange={(e) => handleConfigChange({ backupMinute: Number(e.target.value) })}
              style={{ width: 50, padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 'var(--font-size-sm)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', minWidth: 60 }}>保留份数</label>
            <input
              type="number"
              min={1}
              max={30}
              value={config.maxBackups}
              onChange={(e) => handleConfigChange({ maxBackups: Number(e.target.value) })}
              style={{ width: 50, padding: '4px 8px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 'var(--font-size-sm)' }}
            />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>份（超出自动清理）</span>
          </div>
        </div>

        {/* 备份历史 */}
        {backups.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 8 }}>备份历史</div>
            {backups.slice(0, 10).map((b) => (
              <div key={b.date} className="settings-data-item" style={{ marginBottom: 4 }}>
                <div>
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>{b.date}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginLeft: 8 }}>{formatSize(b.size)}</span>
                </div>
                <button className="settings-btn" onClick={() => handleRestore(b.date)}>恢复</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}