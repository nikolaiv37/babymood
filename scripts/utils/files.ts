import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type CliArgs = Record<string, string | boolean | undefined>

export function parseArgs(argv = process.argv.slice(2)): CliArgs {
  return argv.reduce<CliArgs>((args, arg) => {
    if (arg === '--help' || arg === '-h') {
      args.help = true
      return args
    }

    if (!arg.startsWith('--')) {
      return args
    }

    const [key, ...valueParts] = arg.slice(2).split('=')
    args[toCamelCase(key)] = valueParts.length > 0 ? valueParts.join('=') : true
    return args
  }, {})
}

export function getStringArg(args: CliArgs, key: string): string | undefined {
  const value = args[toCamelCase(key)]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function getNumberArg(args: CliArgs, key: string): number | undefined {
  const value = getStringArg(args, key)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${key} must be a positive number`)
  }
  return Math.floor(parsed)
}

export function getBooleanArg(args: CliArgs, key: string): boolean {
  return args[toCamelCase(key)] === true || args[toCamelCase(key)] === 'true'
}

export function ensureDir(path: string): string {
  const absolutePath = resolve(path)
  mkdirSync(absolutePath, { recursive: true })
  return absolutePath
}

export function writeJsonFile(path: string, data: unknown): string {
  const absolutePath = resolve(path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`)
  return absolutePath
}

export function readJsonFile<T>(path: string): T {
  const absolutePath = resolve(path)
  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`)
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T
}

export function latestJsonFile(dir: string): string {
  const absoluteDir = resolve(dir)
  const files = readdirSync(absoluteDir)
    .filter((file) => file.endsWith('.json'))
    .sort()

  if (files.length === 0) {
    throw new Error(`No JSON files found in ${absoluteDir}`)
  }

  return resolve(absoluteDir, files[files.length - 1])
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
