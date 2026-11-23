export type QueueItem = {
  id: string
  chatTitle: string
  chatKind: 'dm' | 'group' | 'channel'
  senderName: string
  text: string
  why: string
  replies: string[]
}

export type State = {
  me: string
  active: boolean
  since: number
  handled: number
  waiting: number
  queue: QueueItem[]
  queueSize: number
}

export type Catchup = {
  minutes: number
  handled: number
  items: { chat: string; count: number; line: string }[]
}

const BASE = (import.meta.env.VITE_PRESENT_URL as string | undefined) ?? 'http://localhost:8787'
const TOKEN = (import.meta.env.VITE_PRESENT_TOKEN as string | undefined) ?? ''

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'x-present-token': TOKEN, ...(init.body && !(init.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

export const api = {
  state: () => call<State>('/state'),
  session: (active: boolean) => call('/session', { method: 'POST', body: JSON.stringify({ active }) }),
  act: (id: string, kind: 'reply' | 'react' | 'later' | 'skip', extra: { index?: number; text?: string } = {}) =>
    call('/act', { method: 'POST', body: JSON.stringify({ id, kind, ...extra }) }),
  catchup: () => call<Catchup>('/catchup'),
  catchupDone: () => call('/catchup/done', { method: 'POST' }),
  voice: (pcm: Uint8Array) =>
    call<{ text: string }>('/voice', { method: 'POST', body: pcm as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/octet-stream' } }),
}
