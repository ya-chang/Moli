// src/renderer/components/music/SongBadge.tsx
// 标题栏歌曲徽章 — 显示当前播放歌曲

import { useMusicStore } from '../../stores/musicStore'
import './SongBadge.css'

export function SongBadge(): React.JSX.Element | null {
  const currentSong = useMusicStore((s) => s.currentSong)

  if (!currentSong || !currentSong.name) return null

  return (
    <div className="song-badge" title={`${currentSong.name} - ${currentSong.artist}`}>
      <span className="song-badge__icon">🎵</span>
      <span className="song-badge__name">{currentSong.name}</span>
      <span className="song-badge__sep">-</span>
      <span className="song-badge__artist">{currentSong.artist}</span>
    </div>
  )
}