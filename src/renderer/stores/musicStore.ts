// src/renderer/stores/musicStore.ts
// 音乐状态 — 存储当前正在听的歌曲信息 + 全局音频控制

import { create } from 'zustand'
import { kvGetSync, kvSetSync, kvDeleteSync } from '../ipc/storage'

export interface SongInfo {
  name: string
  artist: string
  album: string
  albumCover: string
  releaseDate: string
  duration: string
  lyricsSnippet: string
  genre: string
  year: string
  description: string
  songId?: string
}

let globalAudio: HTMLAudioElement | null = null

const getGlobalAudio = (): HTMLAudioElement => {
  if (!globalAudio) {
    globalAudio = new Audio()
    globalAudio.volume = 0.8
  }
  return globalAudio
}

interface MusicState {
  currentSong: SongInfo | null
  isPlaying: boolean
  isListening: boolean
  currentTime: number
  duration: number
  lyrics: string
  albumCoverUrl: string
  setCurrentSong: (song: SongInfo | null) => void
  setIsPlaying: (playing: boolean) => void
  clearSong: () => void
  getAudio: () => HTMLAudioElement
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setLyrics: (lyrics: string) => void
  setAlbumCoverUrl: (url: string) => void
}

const loadSong = (): SongInfo | null => {
  return kvGetSync<SongInfo>('current-song')
}

export const useMusicStore = create<MusicState>((set, get) => ({
  currentSong: loadSong(),
  isPlaying: false,
  isListening: !!loadSong(),
  currentTime: 0,
  duration: 0,
  lyrics: '',
  albumCoverUrl: '',

  setCurrentSong: (song) => {
    set({ currentSong: song, isListening: !!song })
    if (song) kvSetSync('current-song', song)
    else kvDeleteSync('current-song')
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  clearSong: () => {
    const audio = get().getAudio()
    audio.pause()
    audio.src = ''
    set({ currentSong: null, isPlaying: false, isListening: false, currentTime: 0, duration: 0, lyrics: '', albumCoverUrl: '' })
    kvDeleteSync('current-song')
  },

  getAudio: () => getGlobalAudio(),

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setLyrics: (lyrics) => set({ lyrics }),
  setAlbumCoverUrl: (url) => set({ albumCoverUrl: url })
}))
