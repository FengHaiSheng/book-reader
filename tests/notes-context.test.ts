import { describe, expect, it } from 'vitest'
import { CONTEXT_RADIUS, locate, sliceContext } from '../electron/main/notes/context'

const CHAPTER = [
  '那种安静，他后来很少遇到了。现在他读电子书，手机就搁在右手边，屏幕朝下，但他知道它在。',
  '不是有什么必须处理的事情，只是那个动作本身已经长进了肌肉里。',
  '要把它拔出来，得费些力气。'
].join('\n')

describe('locate', () => {
  it('直接命中，返回原文坐标', () => {
    const span = locate(CHAPTER, '那个动作本身')
    expect(span).not.toBeNull()
    expect(CHAPTER.slice(span!.start, span!.end)).toBe('那个动作本身')
  })

  it('选中的文本带了换行与缩进，也能在正文里找到', () => {
    const span = locate(CHAPTER, '长进了肌肉里。\n  要把它拔出来')
    expect(span).not.toBeNull()
    expect(CHAPTER.slice(span!.start, span!.end)).toContain('要把它拔出来')
  })

  it('找不到与空串都返回 null', () => {
    expect(locate(CHAPTER, '这句话不在这一章里')).toBeNull()
    expect(locate(CHAPTER, '   ')).toBeNull()
    expect(locate(CHAPTER, '')).toBeNull()
  })
})

describe('sliceContext', () => {
  it('命中处给前后各一段，matched 是原文而不是查询串', () => {
    const slice = sliceContext(CHAPTER, '不是有什么必须处理的事情')
    expect(slice).not.toBeNull()
    expect(slice!.matched).toBe('不是有什么必须处理的事情')
    expect(slice!.before).toContain('那种安静')
    expect(slice!.after).toContain('要把它拔出来')
  })

  it('命中在文首时 before 是空串，不返回 undefined', () => {
    const slice = sliceContext(CHAPTER, '那种安静')
    expect(slice!.before).toBe('')
  })

  it('半径可调，取小值就只留一小截', () => {
    const slice = sliceContext(CHAPTER, '那个动作本身', 4)
    expect(slice!.before).toBe('情，只是')
    expect(slice!.after).toBe('已经长进')
  })

  it('找不到返回 null', () => {
    expect(sliceContext(CHAPTER, '不存在的句子')).toBeNull()
  })

  it('默认半径是一个正数常量', () => {
    expect(CONTEXT_RADIUS).toBeGreaterThan(0)
  })
})
