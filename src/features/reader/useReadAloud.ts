import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { TtsEngineId, TtsVoice } from '@shared/types'
import { clearReadAloud, paintReadAloud } from './highlights'
import type { ChapterPaginator } from './paginator'
import { speechSegments, speechSupported, startIndexForPage, type SpeechSegment } from './speech'
import { createTtsEngine, type SpeechEngine } from './tts'

export type ReadAloudStatus = 'idle' | 'speaking' | 'paused'

export type ReadAloudOptions = {
  /** 章节文档换了以后，旧的 Range 就作废；由调用方在换章时决定停还是续读 */
  docVersion: number
  iframeRef: RefObject<HTMLIFrameElement | null>
  paginatorRef: RefObject<ChapterPaginator | null>
  /** 用系统语音还是自建 HTTP 服务 */
  engine: TtsEngineId
  /** 系统语音是 voiceURI，自建服务是音色 id */
  voice: string
  endpoint: string
  rate: number
  /** 朗读翻到新的一页时回传，让顶栏页码与进度跟上 */
  onPage: (page: number, pages: number) => void
  /**
   * 本章读完时调用。返回 true 表示已经切到下一章，等新文档载入后调用方要再 `start()`；
   * 返回 false 表示没有下一章，朗读到此结束。
   */
  onChapterEnd: () => boolean
}

export type ReadAloud = {
  /** 当前使用的引擎，界面据此切换音色列表与设置项 */
  engine: TtsEngineId
  supported: boolean
  status: ReadAloudStatus
  voices: TtsVoice[]
  error: string | null
  /** 主动探活自建服务；成功返回 null，失败返回可读原因 */
  check: () => Promise<string | null>
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  toggle: () => void
}

type EngineSlot = { id: TtsEngineId; engine: SpeechEngine }

/**
 * 朗读编排：断句、逐句推进、翻页、高亮、跨章续读。
 *
 * 具体怎么出声交给 `TtsEngine`：系统语音直接调 speechSynthesis，
 * 自建服务在后台预合成并用 Web Audio 播放。两边共用同一套会话编号：
 * 每次 start / stop 都让旧回调失效，避免上一句的 onend 把新会话顶掉。
 */
export function useReadAloud(options: ReadAloudOptions): ReadAloud {
  const optsRef = useRef(options)
  const sessionRef = useRef(0)
  const statusRef = useRef<ReadAloudStatus>('idle')
  const engineRef = useRef<EngineSlot | null>(null)

  const [status, setStatusState] = useState<ReadAloudStatus>('idle')
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [error, setError] = useState<string | null>(null)

  const setStatus = useCallback((next: ReadAloudStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  useEffect(() => {
    optsRef.current = options
  })

  const getEngine = useCallback((): SpeechEngine => {
    const id = optsRef.current.engine
    if (engineRef.current?.id === id) return engineRef.current.engine
    engineRef.current?.engine.destroy()
    const transport = typeof window === 'undefined' ? null : (window.api?.tts ?? null)
    const engine = createTtsEngine(id, {
      endpoint: () => optsRef.current.endpoint,
      transport: id === 'http' ? transport : null
    })
    engineRef.current = { id, engine }
    return engine
  }, [])

  // 离开阅读器：停语音并释放 AudioContext
  useEffect(() => {
    return () => {
      sessionRef.current += 1
      engineRef.current?.engine.cancel()
      engineRef.current?.engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    let alive = true
    setVoices([])
    getEngine()
      .listVoices()
      .then((list) => {
        if (alive) setVoices(list)
      })
      .catch(() => {
        // 服务没起时不必在朗读开始前就报警；面板的「测试连接」会给出原因
        if (alive) setVoices([])
      })
    return () => {
      alive = false
    }
  }, [options.engine, getEngine])

  const clearCurrentHighlight = useCallback(() => {
    const win = optsRef.current.iframeRef.current?.contentWindow
    if (win) clearReadAloud(win)
  }, [])

  // 换引擎或换服务地址：先把旧的停下来，状态回到 idle，避免按钮停在「暂停」
  useEffect(() => {
    sessionRef.current += 1
    engineRef.current?.engine.cancel()
    clearCurrentHighlight()
    setStatus('idle')
    setError(null)
  }, [options.engine, options.endpoint, clearCurrentHighlight, setStatus])

  /**
   * 读第 index 句。index 越界即本章结束。
   *
   * 翻页与高亮放到 onstart 里：自建服务要先合成，提前翻页会出现「页面跳了、声音没来」。
   * 每句发出后顺手预合成后面两句；读到下一句时缓存通常已经就绪。
   */
  const speakAt = useCallback(
    (session: number, segments: readonly SpeechSegment[], index: number): void => {
      if (session !== sessionRef.current) return

      if (index >= segments.length) {
        clearCurrentHighlight()
        getEngine().cancel()
        sessionRef.current += 1
        setStatus('idle')
        // 切了章时调用方会在新文档载入后再 start；没切章就是最后一章，到此为止
        optsRef.current.onChapterEnd()
        return
      }

      const segment = segments[index]
      if (!segment) return

      const engine = getEngine()
      const { voice, rate } = optsRef.current

      const fail = (message: string): void => {
        if (session !== sessionRef.current) return
        sessionRef.current += 1
        engine.cancel()
        clearCurrentHighlight()
        setStatus('idle')
        setError(message)
      }

      try {
        engine.speak(
          segment.text,
          { voice, rate },
          {
            onstart: () => {
              if (session !== sessionRef.current) return
              const paginator = optsRef.current.paginatorRef.current
              if (paginator) {
                paginator.revealRange(segment.range)
                optsRef.current.onPage(paginator.page + 1, paginator.pages)
              }
              const win = optsRef.current.iframeRef.current?.contentWindow
              if (win) paintReadAloud(win, segment.range)
            },
            onend: () => {
              if (session !== sessionRef.current) return
              speakAt(session, segments, index + 1)
            },
            onerror: fail
          }
        )
      } catch (error) {
        fail(error instanceof Error ? error.message : '朗读失败。')
        return
      }

      engine.prefetch(
        segments.slice(index + 1, index + 3).map((item) => item.text),
        { voice, rate }
      )
    },
    [clearCurrentHighlight, getEngine, setStatus]
  )

  const stop = useCallback(() => {
    sessionRef.current += 1
    getEngine().cancel()
    clearCurrentHighlight()
    setStatus('idle')
    setError(null)
  }, [clearCurrentHighlight, getEngine, setStatus])

  const start = useCallback(() => {
    const engine = getEngine()
    if (!engine.available) {
      setError(
        optsRef.current.engine === 'http'
          ? '自建朗读服务通道不可用。'
          : '当前环境没有系统朗读能力。'
      )
      return
    }

    const iframe = optsRef.current.iframeRef.current
    const doc = iframe?.contentDocument
    const paginator = optsRef.current.paginatorRef.current
    if (!iframe || !doc || !paginator) {
      setError('正文还没准备好，稍后再试。')
      return
    }

    // 先收掉上一轮：旧会话的回调会因为 session 变了而自行退出
    engine.cancel()
    sessionRef.current += 1
    const session = sessionRef.current
    setError(null)

    const segments = speechSegments(doc)
    if (segments.length === 0) {
      setStatus('idle')
      setError('这一章没有可朗读的正文。')
      return
    }

    const from = startIndexForPage(segments, paginator.pageStartRange())
    if (from >= segments.length) {
      setStatus('idle')
      setError('这一页之后没有可朗读的正文。')
      return
    }

    setStatus('speaking')
    speakAt(session, segments, from)
  }, [getEngine, setStatus, speakAt])

  const pause = useCallback(() => {
    if (statusRef.current !== 'speaking') return
    getEngine().pause()
    setStatus('paused')
  }, [getEngine, setStatus])

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return
    getEngine().resume()
    setStatus('speaking')
  }, [getEngine, setStatus])

  const toggle = useCallback(() => {
    if (statusRef.current === 'speaking') pause()
    else if (statusRef.current === 'paused') resume()
    else start()
  }, [pause, resume, start])

  const check = useCallback(async (): Promise<string | null> => {
    const engine = getEngine()
    if (!engine.available) {
      return optsRef.current.engine === 'http'
        ? '没有连上主进程的朗读通道。'
        : '当前环境没有系统朗读能力。'
    }
    try {
      const list = await engine.listVoices()
      setVoices(list)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : '连接失败。'
    }
  }, [getEngine])

  const supported =
    options.engine === 'http'
      ? typeof window !== 'undefined' && Boolean(window.api?.tts)
      : speechSupported()

  return {
    engine: options.engine,
    supported,
    status,
    voices,
    error,
    check,
    start,
    pause,
    resume,
    stop,
    toggle
  }
}
