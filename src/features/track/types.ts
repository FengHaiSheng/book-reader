import type { TrackGapPayload } from '@shared/track'

export type TrackBookLink = {
  bookId: string
  title: string
  author: string | null
  source: 'ai' | 'user'
}

export type TrackNode = {
  id: string
  parentId: string | null
  title: string
  summary: string
  sortOrder: number
  depth: number
  books: TrackBookLink[]
}

export type TrackRecord = {
  id: string
  title: string
  goalText: string
}

/** 界面只留问缺对照指纹要用的字段，并带上当时的 token，方便 BYOK 展示。 */
export type GapView = {
  payload: TrackGapPayload
  scopeKey: string
  createdAt: number
  usage?: { inputTokens: number; outputTokens: number } | null
}
