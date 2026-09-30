import { describe, expect, it } from 'vitest'
import { toIndexText, toMatchQuery, tokenize } from '../electron/main/epub/bigram'

describe('tokenize', () => {
  it('中文按二字切分', () => {
    expect(tokenize('量子纠缠')).toEqual(['量子', '子纠', '纠缠'])
  })

  it('单字中文保留为一个 token', () => {
    expect(tokenize('风')).toEqual(['风'])
  })

  it('中英混排分别处理，英文小写整词', () => {
    expect(tokenize('量子 Entanglement 现象')).toEqual(['量子', 'entanglement', '现象'])
  })

  it('标点只作分隔符，不进 token', () => {
    expect(tokenize('甲，乙。丙')).toEqual(['甲', '乙', '丙'])
  })

  it('连续 CJK 串之间被非中文隔开时不跨界切分', () => {
    expect(tokenize('甲乙 丙丁')).toEqual(['甲乙', '丙丁'])
  })
})

describe('toIndexText', () => {
  it('用空格连接 token', () => {
    expect(toIndexText('量子纠缠')).toBe('量子 子纠 纠缠')
  })
})

describe('toMatchQuery', () => {
  it('生成短语查询，保证 token 连续', () => {
    expect(toMatchQuery('量子纠缠')).toBe('"量子 子纠 纠缠"')
  })

  it('单字查询也包成短语', () => {
    expect(toMatchQuery('风')).toBe('"风"')
  })

  it('没有可用 token 时返回空串，调用方据此跳过检索', () => {
    expect(toMatchQuery('，。！')).toBe('')
    expect(toMatchQuery('   ')).toBe('')
  })

  it('token 里不会出现双引号，短语查询不会被注入破坏', () => {
    expect(toMatchQuery('"甲"')).toBe('"甲"')
  })
})
