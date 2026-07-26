// src/renderer/components/music/LyricsPanel.tsx
// 歌词面板 — 实时滚动高亮

import { useEffect, useRef, useState } from 'react'

interface LyricLine {
  time: number
  text: string
  translation?: string
}

interface LyricsPanelProps {
  lyrics: LyricLine[]
  currentTime: number
}

export function LyricsPanel({ lyrics, currentTime }: LyricsPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(-1)

  // 找到当前高亮行
  useEffect(() => {
    if (lyrics.length === 0) return

    let index = -1
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) {
        index = i
        break
      }
    }
    if (index >= 0 && index !== currentIndex) {
      setCurrentIndex(index)
    }
  }, [currentTime, lyrics, currentIndex])

  // 自动滚动
  useEffect(() => {
    if (currentIndex < 0) return

    const activeLine = containerRef.current?.querySelector('.lyric-active')
    if (activeLine) {
      activeLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [currentIndex])

  if (lyrics.length === 0) {
    return (
      <div className="lyrics-container">
        <div className="lyrics-empty">暂无歌词</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="lyrics-container">
      <div className="lyrics-spacer" />

      {lyrics.map((line, i) => (
        <div
          key={i}
          className={`lyric-line ${i === currentIndex ? 'lyric-active' : ''}`}
        >
          <div className="lyric-text">{line.text}</div>
          {line.translation && (
            <div className="lyric-translation">{line.translation}</div>
          )}
        </div>
      ))}

      <div className="lyrics-spacer" />
    </div>
  )
}