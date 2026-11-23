import { chatJson } from './groq.js'
import { config } from './config.js'

export type Incoming = {
  chatTitle: string
  chatKind: 'dm' | 'group' | 'channel'
  senderName: string
  senderUsername?: string
  text: string
  mentionsMe: boolean
  repliesToMe: boolean
  /** A few earlier lines of the same chat, oldest first, as "Name: text". */
  context: string[]
}

export type Triage = {
  needsYou: boolean
  why: string
  replies: string[]
}

/** Cheap rules first: only these messages are worth an AI call right now. */
export function isCandidate(m: Incoming): boolean {
  if (m.chatKind === 'channel') return false
  if (m.chatKind === 'dm' || m.mentionsMe || m.repliesToMe) return true
  if (m.senderUsername && config.vips.includes(m.senderUsername.toLowerCase())) return true
  const lower = m.text.toLowerCase()
  return config.alertWords.some(w => lower.includes(w))
}

const SYSTEM = `You are Present, a Telegram triage assistant shown on smart glasses while the user ({me}) is with other people (a meeting, a dinner, an event) and cannot look at the phone.
Decide if this message needs the user NOW, and draft replies.

needs_you = true only if ignoring it for an hour would hurt: a direct question or request to the user, a time-sensitive plan, a decision someone is waiting on, an emergency or security problem, or someone the user clearly cares about reaching out personally.
needs_you = false for chit-chat, greetings, memes, FYIs, announcements, things that can wait.

Replies: exactly 3 short replies the user could send with one tap, written in the SAME language as the message, as the user, natural and polite.
- Each reply at most 38 characters, no emoji, no hashtags, no quotes.
- Make them meaningfully different: e.g. a yes, a defer ("in a meeting, back at...") and a no / alternative.
- Never invent facts, numbers, links or promises beyond simple scheduling.

"why" = at most 22 characters, why it needs the user (e.g. "Asks you directly", "Waiting on your OK", "Security alert").

Answer only with JSON: {"needs_you": boolean, "why": string, "replies": [string, string, string]}`

export async function triage(m: Incoming, me: string): Promise<Triage> {
  const where = m.chatKind === 'dm' ? `Private chat with ${m.senderName}` : `Group "${m.chatTitle}"`
  const flags = [m.mentionsMe && 'mentions the user', m.repliesToMe && 'replies to the user'].filter(Boolean).join(', ')
  const user = [
    `${where}.${flags ? ` The message ${flags}.` : ''}`,
    m.context.length ? `Earlier in this chat:\n${m.context.join('\n')}` : '',
    `New message from ${m.senderName}:\n${m.text}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const out = await chatJson<{ needs_you?: boolean; why?: string; replies?: string[] }>([
    { role: 'system', content: SYSTEM.replace('{me}', me) },
    { role: 'user', content: user },
  ])

  const replies = (out.replies ?? []).map(r => String(r).trim()).filter(Boolean).slice(0, 3)
  while (replies.length < 3) replies.push(['Ok!', 'In a meeting, back soon', 'Can we talk later?'][replies.length])
  return { needsYou: Boolean(out.needs_you), why: String(out.why ?? '').slice(0, 24), replies }
}

export type CatchupInput = { chat: string; lines: string[] }

/** One short line per chat summarising what happened while the user was away. */
export async function catchup(chats: CatchupInput[]): Promise<Record<string, string>> {
  if (!chats.length) return {}
  const payload = chats
    .map(c => `### ${c.chat}\n${c.lines.slice(-40).join('\n')}`)
    .join('\n\n')
  const out = await chatJson<{ summaries?: Record<string, string> }>(
    [
      {
        role: 'system',
        content: `Summarise what happened in each Telegram chat while the user was away. For each chat, one line of at most 46 characters with the most useful fact (decisions, dates, asks, links shared). No emoji. Same language as the chat. Answer only with JSON: {"summaries": {"<chat name exactly as given>": "<line>"}}`,
      },
      { role: 'user', content: payload },
    ],
    1200,
  )
  return out.summaries ?? {}
}
