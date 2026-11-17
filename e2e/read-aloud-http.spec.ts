import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/** 0.25 秒静音 WAV：decodeAudioData 能吃，也不需要真的出声 */
function silenceWav(seconds = 0.25): Buffer {
  const sampleRate = 8000
  const samples = Math.floor(sampleRate * seconds)
  const data = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

test('自建朗读服务：探活、预合成与磁盘缓存都走通', async () => {
  const spoken: string[] = []
  const wav = silenceWav()

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          ok: true,
          voices: [{ id: 'cosy', name: 'Cosy 女声', lang: 'zh-CN' }]
        })
      )
      return
    }
    if (request.method === 'POST' && request.url === '/tts') {
      let raw = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        try {
          spoken.push(String(JSON.parse(raw).text ?? ''))
        } catch {
          spoken.push('')
        }
        response.setHeader('content-type', 'audio/wav')
        response.end(wav)
      })
      return
    }
    response.statusCode = 404
    response.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const endpoint = `http://127.0.0.1:${port}`

  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-http-tts-'))
  const epubPath = join(userDataDir, 'novel.epub')
  await writeEpub(epubPath, novelFiles())
  const app = await launchAppWithUserData(userDataDir)

  try {
    const win = await app.firstWindow()
    await win.evaluate((file) => (window as any).api.library.importPath(file), epubPath)
    await win.evaluate(
      (address) =>
        (window as any).api.settings.setPrefs({
          ttsEngine: 'http',
          ttsEndpoint: address,
          ttsServerVoice: 'cosy'
        }),
      endpoint
    )
    await win.reload()

    // 同一句第二次请求必须命中磁盘缓存，不再打服务
    const first = await win.evaluate(
      (address) =>
        (window as any).api.tts.synthesize({
          endpoint: address,
          text: '缓存测试。',
          voice: 'cosy',
          rate: 1
        }),
      endpoint
    )
    const second = await win.evaluate(
      (address) =>
        (window as any).api.tts.synthesize({
          endpoint: address,
          text: '缓存测试。',
          voice: 'cosy',
          rate: 1
        }),
      endpoint
    )
    expect(first.ok).toBe(true)
    expect(first.cached).toBe(false)
    expect(second.ok).toBe(true)
    expect(second.cached).toBe(true)
    expect(spoken.filter((text) => text === '缓存测试。')).toHaveLength(1)

    const health = await win.evaluate(
      (address) => (window as any).api.tts.health(address),
      endpoint
    )
    expect(health.ok).toBe(true)
    expect(health.voices[0]).toMatchObject({ id: 'cosy', name: 'Cosy 女声', lang: 'zh-CN' })

    await win.getByRole('button', { name: '列表' }).click()
    await win.getByRole('button', { name: '打开' }).click()
    await win.waitForFunction(() => {
      const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
      return frame?.contentDocument?.getElementById('reader-theme') != null
    })

    await win.getByRole('button', { name: '声音' }).click()
    await expect(win.locator('#tts-engine')).toHaveValue('http')
    await expect(win.locator('#tts-server-voice option[value="cosy"]')).toHaveCount(1)
    await win.getByRole('button', { name: '收起' }).click()

    await win.getByRole('button', { name: '朗读' }).click()
    // 当前句之外还要预合成后面两句；0.25 秒的静音会很快推进，因此只验证「发过请求」
    await expect
      .poll(() => spoken.filter((text) => text !== '缓存测试。').length)
      .toBeGreaterThanOrEqual(2)
    expect(spoken.join('|')).toContain('月色沉入河底')
    await expect(win.locator('.reader__degrade--error')).toHaveCount(0)

    await win.getByRole('button', { name: '停止' }).click()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
