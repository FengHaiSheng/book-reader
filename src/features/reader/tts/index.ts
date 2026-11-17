import type { TtsEngineId } from '@shared/types'
import { HttpSpeechEngine } from './http'
import { SystemSpeechEngine } from './system'
import type { SpeechEngine, TtsTransport } from './types'

export type { SpeechEngine, TtsTransport } from './types'

export function createTtsEngine(
  id: TtsEngineId,
  deps: { endpoint: () => string; transport: TtsTransport | null }
): SpeechEngine {
  return id === 'http'
    ? new HttpSpeechEngine({ endpoint: deps.endpoint, transport: deps.transport })
    : new SystemSpeechEngine()
}
