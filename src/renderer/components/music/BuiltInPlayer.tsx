// src/renderer/components/music/BuiltInPlayer.tsx
// 内置音乐播放器 — 搜索 + 播放 + 歌词 + 封面

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useMusicStore } from '../../stores/musicStore'
import './BuiltInPlayer.css'

interface SearchResult {
  id: number
  name: string
  artists: Array<{ name: string }>
  album: { name: string; picUrl: string }
  duration: number
}

export function BuiltInPlayer(): React.JSX.Element {
  const {
    currentSong,
    setCurrentSong,
    clearSong,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    lyrics,
    setLyrics,
    albumCoverUrl,
    setAlbumCoverUrl,
    getAudio
  } = useMusicStore()

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [sourceLoaded, setSourceLoaded] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)

  // 获取音频元素
  const audio = getAudio()

  // 检查音源状态
  useEffect(() => {
    const checkSource = async (): Promise<void> => {
      if (!window.electronAPI) return
      try {
        const result = await window.electronAPI.invoke('music:sourceStatus') as {
          loaded: boolean
          info?: { name?: string }
        }
        setSourceLoaded(result.loaded)
      } catch { /* ignore */ }
    }
    checkSource()
  }, [])

  // 监听音频事件
  useEffect(() => {
    const onTimeUpdate = (): void => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = (): void => setDuration(audio.duration)
    const onEnded = (): void => setIsPlaying(false)
    const onPlay = (): void => setIsPlaying(true)
    const onPause = (): void => setIsPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [audio, setCurrentTime, setDuration, setIsPlaying])

  // 获取歌词和封面
  useEffect(() => {
    if (!currentSong?.songId || !window.electronAPI) return

    // 获取歌词
    window.electronAPI.invoke('music:getLyric', { songId: currentSong.songId }).then((result) => {
      const r = result as { success: boolean; lyric?: string }
      if (r.success && r.lyric) {
        setLyrics(r.lyric)
      }
    }).catch(() => {})

    // 获取封面
    if (!currentSong.albumCover) {
      window.electronAPI.invoke('music:getSongDetail', { songId: currentSong.songId }).then((result) => {
        const r = result as { success: boolean; picUrl?: string }
        if (r.success && r.picUrl) {
          setAlbumCoverUrl(r.picUrl)
        }
      }).catch(() => {})
    }
  }, [currentSong?.songId])

  // 搜索歌曲
  const handleSearch = useCallback(async (): Promise<void> => {
    if (!query.trim() || searching) return
    setSearching(true)
    setError('')

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.invoke('music:search', {
          keyword: query,
          limit: 10
        }) as { success: boolean; songs?: SearchResult[]; error?: string }

        if (result.success && result.songs) {
          if (result.songs.length === 0) {
            setError('未找到歌曲')
          } else {
            setSearchResults(result.songs)
          }
        } else {
          setError(result.error || '搜索失败')
        }
      }
    } catch {
      setError('搜索失败，请检查网络')
    } finally {
      setSearching(false)
    }
  }, [query, searching])

  // 获取播放URL并播放
  const getAndPlayUrl = useCallback(async (song: SearchResult): Promise<void> => {
    if (!window.electronAPI) return

    setLoadingUrl(true)
    setError('')

    try {
      // 方法1: 通过音源获取
      const result = await window.electronAPI.invoke('music:getMusicUrl', {
        songmid: String(song.id),
        name: song.name
      }) as { success: boolean; url?: string }

      let playUrl = ''
      if (result.success && result.url) {
        playUrl = result.url
      } else {
        // 方法2: 直接通过网易云API获取
        const directResult = await window.electronAPI.invoke('music:getSongUrlDirect', {
          songId: String(song.id),
          quality: 'exhigh'
        }) as { success: boolean; url?: string }

        if (directResult.success && directResult.url) {
          playUrl = directResult.url
        }
      }

      if (!playUrl) {
        setError('获取播放链接失败')
        setLoadingUrl(false)
        return
      }

      // 尝试播放
      const audioEl = getAudio()

      try {
        // 先尝试直接播放
        audioEl.src = playUrl
        await audioEl.play()
      } catch {
        try {
          // 通过主进程代理获取音频
          const response = await window.electronAPI.invoke('music:fetchAudio', playUrl) as {
            success: boolean
            base64?: string
            contentType?: string
            error?: string
          }

          if (response?.success && response.base64) {
            const binaryStr = atob(response.base64)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            const blob = new Blob([bytes], { type: response.contentType || 'audio/mpeg' })
            const blobUrl = URL.createObjectURL(blob)
            audioEl.src = blobUrl
            await audioEl.play()
          } else {
            setError(`播放失败: ${response?.error || '无法获取音频'}`)
            setLoadingUrl(false)
            return
          }
        } catch (proxyErr) {
          console.error('代理播放也失败:', proxyErr)
          setError('播放失败')
          setLoadingUrl(false)
          return
        }
      }

      setLoadingUrl(false)

      // 设置歌曲信息
      const cover = song.album.picUrl || ''
      setCurrentSong({
        name: song.name,
        artist: song.artists.map((a) => a.name).join('/'),
        album: song.album.name,
        albumCover: cover,
        releaseDate: '',
        duration: `${Math.floor(song.duration / 60000)}:${Math.floor((song.duration % 60000) / 1000).toString().padStart(2, '0')}`,
        lyricsSnippet: '',
        genre: '',
        year: '',
        description: '',
        songId: String(song.id)
      })
      setAlbumCoverUrl(cover)
    } catch (err) {
      console.error('播放失败:', err)
      setError('播放失败')
      setLoadingUrl(false)
    }
  }, [getAudio, setCurrentSong, setAlbumCoverUrl])

  // 选择歌曲
  const handleSelectSong = useCallback(async (song: SearchResult): Promise<void> => {
    setSearchResults([])
    setQuery('')
    await getAndPlayUrl(song)
  }, [getAndPlayUrl])

  // 播放/暂停
  const togglePlay = useCallback((): void => {
    if (isPlaying) {
      audio.pause()
    } else {
      audio.play().catch(() => {
        setError('播放失败')
      })
    }
  }, [isPlaying, audio])

  // 进度拖动
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const time = parseFloat(e.target.value)
    audio.currentTime = time
  }, [audio])

  // 音量调节
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    audio.volume = parseFloat(e.target.value)
  }, [audio])

  // 格式化时间
  const formatTime = (sec: number): string => {
    if (!sec || isNaN(sec)) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // 解析歌词
  const parsedLyrics = useMemo(() => {
    if (!lyrics) return []
    return lyrics.split('\n')
      .map(line => {
        const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/)
        if (match) {
          const min = parseInt(match[1])
          const sec = parseInt(match[2])
          const ms = parseInt(match[3])
          const time = min * 60 + sec + ms / (match[3].length === 3 ? 1000 : 100)
          return { time, text: match[4].trim() }
        }
        return null
      })
      .filter(item => item && item.text)
  }, [lyrics])

  // 当前歌词行
  const currentLyricIndex = useMemo(() => {
    if (!parsedLyrics.length) return -1
    for (let i = parsedLyrics.length - 1; i >= 0; i--) {
      const line = parsedLyrics[i]
      if (line && currentTime >= line.time) return i
    }
    return -1
  }, [currentTime, parsedLyrics])

  // 结束播放
  const handleEndSong = useCallback((): void => {
    audio.pause()
    audio.src = ''
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setLyrics('')
    setAlbumCoverUrl('')
    setLoadingUrl(false)
    clearSong()
  }, [audio, setIsPlaying, setCurrentTime, setDuration, setLyrics, setAlbumCoverUrl, clearSong])

  const coverUrl = albumCoverUrl || currentSong?.albumCover || ''

  return (
    <div className="built-in-player">
      {/* 音源状态 */}
      <div className={`built-in-player__source-status ${sourceLoaded ? 'loaded' : 'not-loaded'}`}>
        {sourceLoaded ? '音源已就绪' : '音源未配置'}
      </div>

      {/* 搜索框 */}
      <div className="built-in-player__search">
        <input
          className="built-in-player__input"
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索歌曲名或歌手..."
          disabled={searching}
        />
        <button
          className="built-in-player__search-btn"
          onClick={handleSearch}
          disabled={searching || !query.trim()}
        >
          {searching ? '搜索中...' : '搜索'}
        </button>
      </div>

      {error && <div className="built-in-player__error">{error}</div>}

      {/* 搜索结果 */}
      {searchResults.length > 0 && (
        <div className="built-in-player__results">
          <div className="built-in-player__results-header">
            搜索结果（点击播放）
          </div>
          {searchResults.map((song) => (
            <div
              key={song.id}
              className="built-in-player__result-item"
              onClick={() => handleSelectSong(song)}
            >
              <img
                src={song.album.picUrl}
                alt={song.name}
                className="built-in-player__result-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              <div className="built-in-player__result-info">
                <div className="built-in-player__result-name">{song.name}</div>
                <div className="built-in-player__result-artist">
                  {song.artists.map((a) => a.name).join('/')} · {song.album.name}
                </div>
              </div>
              <div className="built-in-player__result-duration">
                {formatTime(song.duration / 1000)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 播放器控制栏 */}
      {currentSong && (
        <div className="built-in-player__player">
          {/* 封面 + 歌曲信息 */}
          <div className="built-in-player__player-info">
            <div className={`built-in-player__player-cover-wrap ${isPlaying ? 'playing' : ''}`}>
              <img
                src={coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">♪</text></svg>'}
                alt={currentSong.name}
                className="built-in-player__player-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23f0f0f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">♪</text></svg>' }}
              />
            </div>
            <div className="built-in-player__player-text">
              <div className="built-in-player__player-name">{currentSong.name}</div>
              <div className="built-in-player__player-artist">{currentSong.artist}</div>
            </div>
          </div>

          {/* 播放控制 */}
          <div className="built-in-player__controls">
            <button className="built-in-player__ctrl-btn" onClick={togglePlay}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              className="built-in-player__ctrl-btn built-in-player__ctrl-btn--stop"
              onClick={handleEndSong}
            >
              ⏹
            </button>
            <button
              className={`built-in-player__ctrl-btn built-in-player__ctrl-btn--lyrics ${showLyrics ? 'active' : ''}`}
              onClick={() => setShowLyrics(!showLyrics)}
            >
              词
            </button>
          </div>

          {/* 进度条 */}
          <div className="built-in-player__progress">
            <span className="built-in-player__time">{formatTime(currentTime)}</span>
            <input
              type="range"
              className="built-in-player__slider"
              min={0}
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              disabled={!duration}
            />
            <span className="built-in-player__time">{formatTime(duration)}</span>
          </div>

          {/* 音量 */}
          <div className="built-in-player__volume">
            <span>🔊</span>
            <input
              type="range"
              className="built-in-player__volume-slider"
              min={0}
              max={1}
              step={0.1}
              defaultValue={0.8}
              onChange={handleVolumeChange}
            />
          </div>

          {/* 歌词区域 */}
          {showLyrics && parsedLyrics.length > 0 && (
            <div className="built-in-player__lyrics">
              {parsedLyrics.map((line, index) => line && (
                <div
                  key={index}
                  className={`built-in-player__lyric-line ${index === currentLyricIndex ? 'active' : ''}`}
                >
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}