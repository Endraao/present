/**
 * Everything lives in memory only. Nothing about your messages is written to
 * disk, and it all disappears when the session ends or the server stops.
 */

export type QueueItem = {
  id: string
  chatId: string
  msgId: number
  chatTitle: string
  chatKind: 'dm' | 'group' | 'channel'
  senderName: string
  text: string
  why: string
  replies: string[]
  at: number
}

type Waiting = { chatId: string; chatTitle: string; lines: string[] }

export const store = {
  active: false,
  since: 0,
  queue: [] as QueueItem[],
  waiting: new Map<string, Waiting>(),
  handled: 0,

  start() {
    this.active = true
    this.since = Date.now()
    this.queue = []
    this.waiting.clear()
    this.handled = 0
  },

  stop() {
    this.active = false
  },

  /** Forget everything from the last session. */
  clear() {
    this.queue = []
    this.waiting.clear()
    this.handled = 0
    this.since = 0
  },

  push(item: QueueItem) {
    if (this.queue.some(q => q.id === item.id)) return
    this.queue.push(item)
  },

  take(id: string): QueueItem | undefined {
    const i = this.queue.findIndex(q => q.id === id)
    if (i < 0) return undefined
    this.handled += 1
    return this.queue.splice(i, 1)[0]
  },

  wait(chatId: string, chatTitle: string, line: string) {
    const w = this.waiting.get(chatId) ?? { chatId, chatTitle, lines: [] }
    w.lines.push(line)
    if (w.lines.length > 80) w.lines.shift()
    this.waiting.set(chatId, w)
  },

  waitingCount(): number {
    let n = 0
    for (const w of this.waiting.values()) n += w.lines.length
    return n
  },
}
