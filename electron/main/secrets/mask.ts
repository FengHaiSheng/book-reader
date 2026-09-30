/**
 * 把明文密钥变成可安全展示的形式：sk-••••••••3f7a
 * 太短的 key 全部打码，避免末尾几位就泄露大半。
 */
export function maskKey(plain: string): string {
  const trimmed = plain.trim()
  if (trimmed.length <= 12) return '•'.repeat(trimmed.length)
  return `${trimmed.slice(0, 3)}${'•'.repeat(8)}${trimmed.slice(-4)}`
}
