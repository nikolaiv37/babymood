import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'dry-run'

export interface Logger {
  log: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  success: (message: string, meta?: Record<string, unknown>) => void
  dryRun: (message: string, meta?: Record<string, unknown>) => void
  filePath: string
}

export function createLogger(name: string): Logger {
  const filePath = resolve('logs', `${timestampForFile()}-${name}.log`)
  mkdirSync(dirname(filePath), { recursive: true })

  const write = (level: LogLevel, message: string, meta: Record<string, unknown> = {}) => {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...meta
    }
    const line = JSON.stringify(entry)
    appendFileSync(filePath, `${line}\n`)
    console.log(line)
  }

  return {
    filePath,
    log: write,
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    success: (message, meta) => write('success', message, meta),
    dryRun: (message, meta) => write('dry-run', message, meta)
  }
}

export function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}
