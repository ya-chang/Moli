// src/renderer/components/music/SongInfoPanel.tsx
// 歌曲信息面板


interface SongInfoPanelProps {
  name: string
  artist: string
  album: string
  albumCover: string
  releaseDate: string
}

export function SongInfoPanel({ name, artist, album, albumCover, releaseDate }: SongInfoPanelProps): React.JSX.Element {
  return (
    <div className="song-info-panel">
      <img
        src={albumCover || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">♪</text></svg>'}
        alt={album}
        className="song-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">♪</text></svg>'
        }}
      />
      <div className="song-meta">
        <div className="song-name">{name || '未知歌曲'}</div>
        <div className="song-artist">{artist || '未知艺术家'}</div>
        {album && (
          <div className="song-album">
            《{album}》{releaseDate ? ` · ${releaseDate}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}