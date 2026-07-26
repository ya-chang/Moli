// src/main/utils/logger.ts
// 日志工具 — 纯文件日志，不用 console，彻底避免 broken pipe

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { PATHS } from './dataPath'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const currentLevel: LogLevel = 'debug'

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

const formatTime = (): string => {
  return new Date().toISOString()
}

// 日志目录
const getLogDir = (): string => {
  const logDir = join(PATHS.base, 'logs')
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

const getLogFile = (): string => {
  const date = new Date().toISOString().split('T')[0]
  return join(getLogDir(), `${date}.log`)
}

const writeLog = (level: string, msg: string, args: unknown[]): void => {
  try {
    const extra = args.length > 0 ? ' ' + args.map(String).join(' ') : ''
    const line = `[${formatTime()}] [${level}] ${msg}${extra}\n`
    appendFileSync(getLogFile(), line, 'utf-8')
  } catch { /* 文件写入失败也忽略 */ }
}

// NOTE: 安全红线 — 不输出用户消息内容，只输出 ID 和时间戳
export const logger = {
  debug: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('debug')) {
      writeLog('DEBUG', msg, args)
    }
  },

  info: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('info')) {
      writeLog('INFO', msg, args)
    }
  },

  warn: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('warn')) {
      writeLog('WARN', msg, args)
    }
  },

  error: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('error')) {
      writeLog('ERROR', msg, args)
    }
  }
}
