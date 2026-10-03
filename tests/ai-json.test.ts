import { describe, expect, it } from 'vitest'
import { parseLooseJson } from '../electron/main/ai/loose-json'

describe('parseLooseJson', () => {
  it('直接是 JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('被 ``` 包裹', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('前后有解释性废话', () => {
    expect(parseLooseJson('好的，这是结果：\n{"a":1}\n希望有帮助！')).toEqual({ a: 1 })
  })

  it('尾部多一个逗号', () => {
    expect(parseLooseJson('{"a":1,}')).toEqual({ a: 1 })
  })

  it('单引号与中文引号', () => {
    expect(parseLooseJson("{'a':'月亮'}")).toEqual({ a: '月亮' })
  })

  it('彻底解析不出来时返回 null，不抛错', () => {
    expect(parseLooseJson('这不是 JSON')).toBeNull()
    expect(parseLooseJson('')).toBeNull()
  })

  it('数组也能解析', () => {
    expect(parseLooseJson('[1,2,3]')).toEqual([1, 2, 3])
  })
})