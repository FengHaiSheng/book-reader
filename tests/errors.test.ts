import { describe, expect, it } from 'vitest'
import { appError, readableError, toAppError } from '../shared/errors'

describe('toAppError', () => {
  it('已经是 AppError 时原样返回', () => {
    const original = appError('AI_AUTH', '密钥无效', { action: 'openSettings' })
    expect(toAppError(original)).toBe(original)
  })

  it('把原生 Error 转成带 detail 的 UNKNOWN', () => {
    const result = toAppError(new TypeError('boom'), '读取失败')
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toBe('读取失败')
    expect(result.detail).toBe('TypeError: boom')
    expect(result.action).toBe('none')
  })

  it('把非 Error 抛出物也转成字符串 detail', () => {
    expect(toAppError('oops').detail).toBe('oops')
  })
})

describe('readableError', () => {
  it('剥掉 Electron 给 IPC 错误加的前缀', () => {
    const error = new Error(
      "Error invoking remote method 'library:tagCreate': Error: 已经有叫「待读」的标签了"
    )
    expect(readableError(error)).toBe('已经有叫「待读」的标签了')
  })

  it('更深的一层嵌套也只剥第一层，内容原样保留', () => {
    const error = new Error(
      "Error invoking remote method 'data:export': Error: 磁盘已满：/Users/me/Desktop/out.zip"
    )
    expect(readableError(error)).toBe('磁盘已满：/Users/me/Desktop/out.zip')
  })

  it('本来就没有前缀的错误原样返回', () => {
    expect(readableError(new Error('网络不可用'))).toBe('网络不可用')
  })

  it('空消息回落到兜底文案', () => {
    expect(readableError(new Error(''), '导入没有成功')).toBe('导入没有成功')
    expect(readableError(null, '导入没有成功')).toBe('导入没有成功')
  })
})
