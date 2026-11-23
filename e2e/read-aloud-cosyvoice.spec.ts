import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { novelFiles, writeEpub } from '../fixtures/make-epub'
import { launchAppWithUserData } from './helpers'

/**
 * 0.25 秒 24 kHz 静音 PCM（16 bit 单声道、小端），刻意不带 WAV 头：
 * 官方 /inference_sft 回的就是这个形态，客户端必须自己补头。
 */
function silencePcm16(seconds = 0.25, sampleRate = 24000): Buffer {
  return Buffer.alloc(Math.floor(sampleRate * seconds) * 2)
}

test('官方 CosyVoice FastAPI：OpenAPI 探活、表单合成、裸 PCM 补 WAV 头与缓存', async () => {
  const calls: { text: string; spk: string }[] = []
  const pcm = silencePcm16()

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/openapi.json') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          openapi: '3.0.2',
          paths: {
            '/inference_sft': { post: {} },
            '/inference_zero_shot': { post: {} }
          }
        })
      )
      return
    }
    if (request.method === 'POST' && request.url === '/inference_sft') {
      let raw = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        const form = new URLSearchParams(raw)
        calls.push({ text: form.get('tts_text') ?? '', spk: form.get('spk_id') ?? '' })
        // 官方 StreamingResponse 不加 WAV 头，也不告诉采样率
        response.setHeader('content-type', 'application/octet-stream')
        response.end(pcm)
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

  const userDataDir = mkdtempSync(join(tmpdir(), 'book-read-cosyvoice-'))
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
          ttsServerVoice: '中文女',
          ttsApi: 'cosyvoice',
          ttsSampleRate: 24000
        }),
      endpoint
    )
    await win.reload()

    // 探活看 /openapi.json，而不是官方服务根本没有的 /health
    const health = await win.evaluate(
      (address) => (window as any).api.tts.health(address, 'cosyvoice'),
      endpoint
    )
    expect(health.ok).toBe(true)
    expect(health.voices).toEqual([])

    const synthesized = await win.evaluate(
      (address) =>
        (window as any).api.tts.synthesize({
          endpoint: address,
          api: 'cosyvoice',
          sampleRate: 24000,
          text: '缓存测试。',
          voice: '中文女',
          rate: 1
        }),
      endpoint
    )
    expect(synthesized.ok).toBe(true)
    expect(synthesized.cached).toBe(false)

    // 回传给渲染进程的必须是带 RIFF/WAVE 头的 WAV，采样率取用户设置的那个
    const shape = await win.evaluate(
      async (address) => {
        const result = await (window as any).api.tts.synthesize({
          endpoint: address,
          api: 'cosyvoice',
          sampleRate: 24000,
          text: '缓存测试。',
          voice: '中文女',
          rate: 1
        })
        if (!result.ok) {
          return {
            ok: false as const,
            error: String(result.error),
            cached: false,
            riff: '',
            wave: '',
            sampleRate: 0,
            bits: 0,
            dataLength: 0,
            byteLength: 0
          }
        }
        const bytes = result.audio as Uint8Array
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const ascii = (start: number, end: number): string =>
          String.fromCharCode(...Array.from(bytes.slice(start, end)))
        return {
          ok: true as const,
          error: '',
          cached: result.cached,
          riff: ascii(0, 4),
          wave: ascii(8, 12),
          sampleRate: view.getUint32(24, true),
          bits: view.getUint16(34, true),
          dataLength: view.getUint32(40, true),
          byteLength: bytes.byteLength
        }
      },
      endpoint
    )
    expect(shape).toMatchObject({
      ok: true,
      cached: true,
      riff: 'RIFF',
      wave: 'WAVE',
      sampleRate: 24000,
      bits: 16
    })
    expect(shape.byteLength).toBe(44 + pcm.byteLength)
    expect(shape.dataLength).toBe(pcm.byteLength)

    // 表单字段名必须是官方的 tts_text / spk_id；缓存命中后不再打服务
    expect(calls).toEqual([{ text: '缓存测试。', spk: '中文女' }])

    await win.getByRole('button', { name: '列表' }).click()
    await win.getByRole('button', { name: '打开' }).click()
    await win.waitForFunction(() => {
      const frame = document.querySelector('iframe.reader__view') as HTMLIFrameElement | null
      return frame?.contentDocument?.getElementById('reader-theme') != null
    })

    await win.getByRole('button', { name: '声音' }).click()
    await expect(win.locator('#tts-engine')).toHaveValue('http')
    await expect(win.locator('#tts-api')).toHaveValue('cosyvoice')
    await expect(win.locator('#tts-sample-rate')).toHaveValue('24000')
    await expect(win.locator('#tts-server-voice')).toHaveValue('中文女')
    await win.getByRole('button', { name: '收起', exact: true }).click()

    await win.getByRole('button', { name: '朗读' }).click()
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.map((call) => call.text).join('|')).toContain('月色沉入河底')
    expect(calls.every((call) => call.spk === '中文女')).toBe(true)
    await expect(win.locator('.reader__degrade--error')).toHaveCount(0)

    await win.getByRole('button', { name: '停止' }).click()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
