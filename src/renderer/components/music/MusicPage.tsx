// src/renderer/components/music/MusicPage.tsx
// 一起听歌 — 网易云嵌入

import { useEffect, useState } from 'react'
import './MusicPage.css'

export function MusicPage(): React.JSX.Element {
  const [loading, setLoading] = useState(true)

  // 通知主进程创建WebView
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const initWebView = async (): Promise<void> => {
      if (!window.electronAPI) return

      try {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const result = await window.electronAPI.invoke('music:create-webview') as { success: boolean }
        if (result.success) {
          timer = setTimeout(() => setLoading(false), 3000)
        }
      } catch {
        setLoading(false)
      }
    }

    initWebView()
    return () => { if (timer) clearTimeout(timer) }
  }, [])

  return (
    <div className="music-page">
      {/* 顶部标题栏 */}
      <div className="music-page__header">
        <span className="music-page__icon">🎵</span>
        <span className="music-page__title">一起听歌</span>
        <div className="music-page__window-controls">
          <button className="music-page__win-btn" onClick={() => window.electronAPI?.minimize()} title="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="music-page__win-btn" onClick={() => window.electronAPI?.maximize()} title="最大化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </button>
          <button className="music-page__win-btn music-page__win-btn--close" onClick={() => window.electronAPI?.close()} title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1" />
              <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* 加载提示 */}
      {loading && (
        <div className="music-page__loading">
          <div className="music-page__loading-spinner" />
          <span>正在加载网易云音乐...</span>
        </div>
      )}
    </div>
  )
}