// src/renderer/types/electron.d.ts
// Electron API 类型声明

interface ElectronAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

interface Window {
  electronAPI?: ElectronAPI
}
