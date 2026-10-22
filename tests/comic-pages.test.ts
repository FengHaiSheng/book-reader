import { describe, expect, it } from 'vitest'
import {
  isComicPage,
  pageEntry,
  pageFileExt,
  pageFileName,
  sortPageNames
} from '../electron/main/comic/pages'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAIAAADQ/GvKAAAAEklEQVR4nGPItjLCihhGJdARAFcNUKHg/FojAAAAAElFTkSuQmCC',
  'base64'
)

describe('isComicPage', () => {
  it('只收图片', () => {
    expect(isComicPage('001.jpg')).toBe(true)
    expect(isComicPage('chapter/002.JPEG')).toBe(true)
    expect(isComicPage('003.png')).toBe(true)
    expect(isComicPage('ComicInfo.xml')).toBe(false)
    expect(isComicPage('001.cbz')).toBe(false)
  })

  it('跳过隐藏文件与 macOS 资源叉', () => {
    expect(isComicPage('.DS_Store')).toBe(false)
    expect(isComicPage('__MACOSX/001.jpg')).toBe(false)
    expect(isComicPage('.hidden/001.jpg')).toBe(false)
    // 只有文件自己的名字是隐藏的才跳过，中间目录叫 .cache 也一样
    expect(isComicPage('pages/.thumb.png')).toBe(false)
    expect(isComicPage('pages/001.png')).toBe(true)
  })
})

describe('sortPageNames', () => {
  it('按数字自然排序，不是字典序', () => {
    const names = ['page10.jpg', 'page2.jpg', 'page1.jpg']
    expect(sortPageNames(names)).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg'])
  })

  it('不改动传入数组', () => {
    const names = ['b.png', 'a.png']
    sortPageNames(names)
    expect(names).toEqual(['b.png', 'a.png'])
  })
})

describe('pageFileExt', () => {
  it('JPEG 的别名统一成 jpg', () => {
    expect(pageFileExt('a.jpeg', PNG)).toBe('jpg')
    expect(pageFileExt('a.jfif', PNG)).toBe('jpg')
  })

  it('文件名没有扩展名时按文件头认', () => {
    expect(pageFileExt('page001', PNG)).toBe('png')
    expect(pageFileExt('page001', Buffer.from('not an image'))).toBeNull()
  })
})

describe('落盘命名', () => {
  it('页码补到五位，字典序就是阅读顺序', () => {
    expect(pageFileName(1, 'jpg')).toBe('00001.jpg')
    expect(pageFileName(12, 'png')).toBe('00012.png')
  })

  it('entry 落在 protocol 的 media/ 白名单形状里', () => {
    expect(pageEntry('00001.jpg')).toBe('media/00001.jpg')
  })
})
