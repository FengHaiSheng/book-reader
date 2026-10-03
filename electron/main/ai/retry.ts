import { appError, type AppError } from '@shared/errors'

export const RETRY_DELAY_MS = 800

/** detail 会进「查看详情」，所以进这里之前必须先把 key 洗掉 */
const KEY_LIKE = /sk-[A-Za-z0-9_-]{6,}/g

function scrub(text: string): string {
  return text.replace(KEY_LIKE, 'sk-***')
}

/** 取服务商返回体里的 message，取不到就给空串——不要 upsert 整段 HTML 错误页 */
function messageOf(body: string): string {
  if (!body) return ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return scrub(parsed.error?.message ?? parsed.message ?? '')
  } catch {
    return scrub(body.slice(0, 200))
  }
}

/**
 * 把一次失败的 HTTP 响应（或网络层异常）变成四类错误之一。
 *
 * `status` 为 null 表示请求根本没拿到响应（DNS、连接被拒、超时被 abort）。
 */
export function classifyError(status: number | null, body: string): AppError {
  const detail = messageOf(body)

  if (status === null) {
    return appError('OFFLINE', '没能连上模型服务，请检查网络或代理设置', {
      detail,
      action: 'retry'
    })
  }

  if (status === 401 || status === 403) {
    return appError('AI_AUTH', 'API 密钥无效或没有权限，请到设置里重新填写', {
      detail,
      action: 'openSettings'
    })
  }

  if (status === 402 || /insufficient|balance|quota|欠费|余额/i.test(detail)) {
    return appError('AI_QUOTA', '账户余额或用量额度不足，请到服务商后台充值后重试', {
      detail,
      action: 'none'
    })
  }

  if (status === 429) {
    return appError('AI_RATE_LIMIT', '请求太频繁，被服务商限流了，稍后会自动重试一次', {
      detail,
      action: 'retry'
    })
  }

  if (status >= 500) {
    return appError('UNKNOWN', '模型服务暂时不可用，稍后会自动重试一次', {
      detail,
      action: 'retry'
    })
  }

  return appError('AI_UNSUPPORTED', '这次请求模型没能处理，换一个模型或缩短提问试试', {
    detail,
    action: 'none'
  })
}

/**
 * 只重试一次。
 *
 * 401 / 400 这类问题重试一百次也是一样的结果，只会让用户看着转圈——直接抛出去，
 * 让界面给出「去设置」或「换模型」。
 */
export function shouldRetry(error: AppError, attempt: number): boolean {
  return error.action === 'retry' && attempt < 1
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}