// src/renderer/components/contacts/NotificationSettingsPanel.tsx
// 通知弹窗样式设置面板

import { useState, useEffect } from 'react'
import './ContactList.css'

interface NotificationSettings {
  appWidth: number
  appHeight: number
  appFontSize: number
  appFontColor: string
  appBgColor: string
  appStaySeconds: number
  screenEnabled: boolean
  screenWidth: number
  screenHeight: number
  screenFontSize: number
  screenFontColor: string
  screenBgColor: string
  screenStaySeconds: number
}

const DEFAULT_SETTINGS: NotificationSettings = {
  appWidth: 400, appHeight: 80, appFontSize: 14,
  appFontColor: '#1a1a1a', appBgColor: '#ffffff', appStaySeconds: 5,
  screenEnabled: true, screenWidth: 400, screenHeight: 80,
  screenFontSize: 14, screenFontColor: '#1a1a1a', screenBgColor: '#ffffff', screenStaySeconds: 5,
}

interface Props { onClose: () => void }

export function NotificationSettingsPanel({ onClose }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS)
  const [tab, setTab] = useState<'app' | 'screen'>('app')

  useEffect(() => {
    // 从文件系统加载通知设置
    window.electronAPI?.invoke('settings:load').then((result: any) => {
      if (result?.notificationSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.notificationSettings })
      }
    }).catch(() => {})
  }, [])

  const update = (updates: Partial<NotificationSettings>) => {
    const next = { ...settings, ...updates }
    setSettings(next)
    // 保存到文件系统
    window.electronAPI?.invoke('settings:save', { notificationSettings: next }).catch(() => {})
    window.electronAPI?.send('notification:settings-updated', next)
    window.dispatchEvent(new Event('notification-settings-changed'))
  }

  const ColorInput = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="notification-settings-row">
      <span className="notification-settings-label">{label}</span>
      <input type="color" value={value.startsWith('#') ? value : '#1a1a1a'}
        onChange={(e) => onChange(e.target.value)} className="notification-settings-color" />
    </div>
  )

  const NumberInput = ({ label, value, min, max, onChange, unit = 'px' }: any) => (
    <div className="notification-settings-row">
      <span className="notification-settings-label">{label}</span>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="notification-settings-input-sm" />
      <span className="notification-settings-unit">{unit}</span>
    </div>
  )

  return (
    <div className="notification-settings-overlay" onClick={onClose}>
      <div className="notification-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notification-settings-header">
          <h4>通知设置</h4>
          <button className="notification-settings-close" onClick={onClose}>×</button>
        </div>
        <div className="notification-settings-tabs">
          <button className={`notification-settings-tab ${tab === 'app' ? 'active' : ''}`} onClick={() => setTab('app')}>应用内弹窗</button>
          <button className={`notification-settings-tab ${tab === 'screen' ? 'active' : ''}`} onClick={() => setTab('screen')}>屏幕外弹窗</button>
        </div>
        <div className="notification-settings-content">
          {tab === 'app' && (
            <div className="notification-settings-section">
              <NumberInput label="宽度" value={settings.appWidth} min={200} max={600} onChange={(v: number) => update({ appWidth: v })} />
              <NumberInput label="高度" value={settings.appHeight} min={40} max={200} onChange={(v: number) => update({ appHeight: v })} />
              <NumberInput label="字体大小" value={settings.appFontSize} min={10} max={24} onChange={(v: number) => update({ appFontSize: v })} />
              <ColorInput label="字体颜色" value={settings.appFontColor} onChange={(v) => update({ appFontColor: v })} />
              <ColorInput label="背景颜色" value={settings.appBgColor} onChange={(v) => update({ appBgColor: v })} />
              <NumberInput label="停留时间" value={settings.appStaySeconds} min={2} max={30} onChange={(v: number) => update({ appStaySeconds: v })} unit="秒" />
            </div>
          )}
          {tab === 'screen' && (
            <div className="notification-settings-section">
              <div className="notification-settings-row">
                <span className="notification-settings-label">启用屏幕外弹窗</span>
                <label className="notification-settings-toggle">
                  <input type="checkbox" checked={settings.screenEnabled} onChange={(e) => update({ screenEnabled: e.target.checked })} />
                  <span className="notification-settings-toggle-slider"></span>
                </label>
              </div>
              {settings.screenEnabled && (
                <>
                  <NumberInput label="宽度" value={settings.screenWidth} min={200} max={600} onChange={(v: number) => update({ screenWidth: v })} />
                  <NumberInput label="高度" value={settings.screenHeight} min={40} max={200} onChange={(v: number) => update({ screenHeight: v })} />
                  <NumberInput label="字体大小" value={settings.screenFontSize} min={10} max={24} onChange={(v: number) => update({ screenFontSize: v })} />
                  <ColorInput label="字体颜色" value={settings.screenFontColor} onChange={(v) => update({ screenFontColor: v })} />
                  <ColorInput label="背景颜色" value={settings.screenBgColor} onChange={(v) => update({ screenBgColor: v })} />
                  <NumberInput label="停留时间" value={settings.screenStaySeconds} min={2} max={30} onChange={(v: number) => update({ screenStaySeconds: v })} unit="秒" />
                </>
              )}
            </div>
          )}
        </div>
        <div className="notification-settings-footer">
          <button className="notification-settings-test-btn" onClick={() => {
            window.electronAPI?.invoke('test-notification', { characterId: 'test', characterName: '测试角色', content: '这是一条测试通知消息~' })
          }}>发送测试通知</button>
        </div>
      </div>
    </div>
  )
}
