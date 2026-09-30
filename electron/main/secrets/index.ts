import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { appError } from '@shared/errors'
import { maskKey } from './mask'

type SecretsFile = {
  provider: string | null
  /** 值为 safeStorage 加密后的 base64，明文绝不落盘 */
  keys: Record<string, string>
}

function filePath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function readFile(): SecretsFile {
  const path = filePath()
  if (!existsSync(path)) return { provider: null, keys: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SecretsFile
  } catch {
    return { provider: null, keys: {} }
  }
}

function writeFile(data: SecretsFile): void {
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw appError('SECRET_UNAVAILABLE', '当前系统无法提供安全的密钥存储，暂不能保存 API Key')
  }
}

export function setKey(provider: string, plain: string): void {
  assertAvailable()
  const data = readFile()
  data.keys[provider] = safeStorage.encryptString(plain.trim()).toString('base64')
  data.provider = provider
  writeFile(data)
}

export function getKey(provider: string): string | null {
  const encrypted = readFile().keys[provider]
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

export function clearKey(provider: string): void {
  const data = readFile()
  delete data.keys[provider]
  if (data.provider === provider) data.provider = null
  writeFile(data)
}

/** 只回显脱敏结果，明文永远不出主进程 */
export function status(): { available: boolean; providers: Record<string, string> } {
  const available = safeStorage.isEncryptionAvailable()
  const data = readFile()
  const providers: Record<string, string> = {}
  if (available) {
    for (const provider of Object.keys(data.keys)) {
      const plain = getKey(provider)
      if (plain) providers[provider] = maskKey(plain)
    }
  }
  return { available, providers }
}
