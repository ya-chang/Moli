// src/renderer/ipc/storage.ts
// 统一存储层 — 通过 IPC 写入文件系统，localStorage 仅作启动缓存

const getApi = (): any => {
  try { return (window as any).electronAPI } catch { return null }
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const api = getApi()
    if (!api?.invoke) return null
    const result = await api.invoke('kv:get', key)
    return (result as T) ?? null
  } catch { return null }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const api = getApi()
    if (!api?.invoke) return
    await api.invoke('kv:set', key, value)
  } catch { /* 静默 */ }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const api = getApi()
    if (!api?.invoke) return
    await api.invoke('kv:delete', key)
  } catch { /* 静默 */ }
}

// 同步版本 — Zustand 初始化时 IPC 还没就绪，用 localStorage 做缓存
export function kvGetSync<T = unknown>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch { /* ignore */ }
  return null
}

export function kvSetSync(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
  kvSet(key, value)
}

export function kvDeleteSync(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
  kvDelete(key)
}
