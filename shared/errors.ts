export const APP_ERROR_CODES = [
  'EPUB_PARSE_FAILED',
  'FILE_MISSING',
  'DB_ERROR',
  'AI_AUTH',
  'AI_QUOTA',
  'AI_RATE_LIMIT',
  'AI_TIMEOUT',
  'AI_UNSUPPORTED',
  'SECRET_UNAVAILABLE',
  'OFFLINE',
  'UNKNOWN'
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export type AppErrorAction = 'retry' | 'openSettings' | 'pickAnotherFile' | 'none'

export type AppError = {
  code: AppErrorCode
  /** 已本地化的中文，可直接展示 */
  message: string
  /** 原始错误，只进「查看详情」和日志 */
  detail?: string
  action?: AppErrorAction
}

export function appError(
  code: AppErrorCode,
  message: string,
  init?: { detail?: string; action?: AppErrorAction }
): AppError {
  return { code, message, detail: init?.detail, action: init?.action ?? 'none' }
}

/**
 * 把任意抛出物归一化成 AppError。
 * 注意：detail 里绝不能带 API key 与书籍正文。
 */
export function toAppError(e: unknown, fallbackMessage = '发生了未知错误'): AppError {
  if (isAppError(e)) return e
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return { code: 'UNKNOWN', message: fallbackMessage, detail, action: 'none' }
}

const CODE_SET: ReadonlySet<string> = new Set(APP_ERROR_CODES)

function isAppError(e: unknown): e is AppError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    CODE_SET.has((e as { code: string }).code) &&
    typeof (e as { message?: unknown }).message === 'string'
  )
}
