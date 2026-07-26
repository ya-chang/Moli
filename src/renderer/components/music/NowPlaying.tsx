// src/renderer/components/music/NowPlaying.tsx
// 聊天窗口顶部 — 显示当前歌曲


interface NowPlayingProps {
  songName: string
  artist: string
  isPlaying: boolean
}

export function NowPlaying({ songName, artist, isPlaying }: NowPlayingProps): React.JSX.Element | null {
  if (!songName) return null

  return (
    <div className="now-playing-bar">
      <span className="now-playing-icon">
        {isPlaying ? '🎵' : '⏸'}
      </span>
      <span className="now-playing-text">
        {artist} - {songName}
      </span>
    </div>
  )
}