/**
 * 朗读续读位置。
 *
 * 一本书一条，记的是「正在读的那一句句首」和离开时朗读有没有开着。
 * 只存在本机的 localStorage：换电脑不跟着走，也不需要动主进程的库。
 */
export type SpeechResume = {
  chapterId: number
  /** 正在读的那一句句首的 CFI；定不到位置时为空串 */
  cfi: string
  /** 离开时朗读是否还开着；只有 true 才会在下次进入阅读器时自动接着读 */
  active: boolean
}

const STORAGE_KEY = 'book-read:speech-resume'

type Store = Record<string, SpeechResume>

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readStore(): Store {
  const store = storage()
  if (!store) return {}
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    // 坏数据当作没有：续读只是便利，不该拦住阅读
    return {}
  }
}

export function loadSpeechResume(bookId: string): SpeechResume | null {
  const entry = readStore()[bookId]
  if (!entry || typeof entry.chapterId !== 'number' || typeof entry.cfi !== 'string') return null
  return { chapterId: entry.chapterId, cfi: entry.cfi, active: entry.active === true }
}

export function saveSpeechResume(bookId: string, value: SpeechResume): void {
  const store = storage()
  if (!store) return
  try {
    const all = readStore()
    all[bookId] = { chapterId: value.chapterId, cfi: value.cfi, active: value.active }
    store.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 存不进去只是下次不续读，不影响当前这一轮朗读
  }
}
