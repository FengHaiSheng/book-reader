import type { TtsApi, TtsEngineId } from '@shared/types'
import { HttpSpeechEngine } from './http'
import { SystemSpeechEngine } from './system'
import type { SpeechEngine, TtsTransport } from './types'

export type { SpeechEngine, TtsTransport } from './types'

export type TtsEngineDeps = {
  endpoint: () => string
  api: () => TtsApi
  sampleRate: () => number
  transport: TtsTransport | null
}

export function createTtsEngine(id: TtsEngineId, deps: TtsEngineDeps): SpeechEngine {
  return id === 'http'
    ? new HttpSpeechEngine({
        endpoint: deps.endpoint,
        api: deps.api,
        sampleRate: deps.sampleRate,
        transport: deps.transport
      })
    : new SystemSpeechEngine()
}
