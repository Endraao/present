import fs from 'node:fs'
import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js'
import { config } from './config.js'
import { store, type QueueItem } from './store.js'
import { isCandidate, triage, type Incoming } from './triage.js'

const savedSession = fs.existsSync(config.sessionFile) ? fs.readFileSync(config.sessionFile, 'utf8').trim() : ''
export const client = new TelegramClient(new StringSession(savedSession), config.telegramApiId, config.telegramApiHash, {
  connectionRetries: 5,
})
client.setLogLevel('error' as any)

let meName = 'the user'
let meId = ''
/** Peers seen in updates, so we can answer without another lookup. */
const peers = new Map<string, Api.TypePeer>()

// ---------- Login (driven by the local /login page) ----------

type Step = 'phone' | 'code' | 'password' | 'done' | 'error'
let waiter: { step: Step; resolve?: (v: string) => void } = { step: 'phone' }
let loginError = ''

function ask(step: Step): Promise<string> {
  return new Promise(resolve => {
    waiter = { step, resolve }
  })
}

export function loginState() {
  return { step: waiter.step, error: loginError, me: waiter.step === 'done' ? meName : '' }
}

export function answerLogin(value: string) {
  loginError = ''
  waiter.resolve?.(value.trim())
}

export async function connect() {
  await client.connect()
  if (await client.checkAuthorization()) {
    await afterLogin()
    return
  }
  client
    .start({
      phoneNumber: () => ask('phone'),
      phoneCode: () => ask('code'),
      password: () => ask('password'),
      onError: async err => {
        loginError = err.message
        return false // keep trying with the next answer
      },
    })
    .then(afterLogin)
    .catch(err => {
      loginError = String(err?.message ?? err)
      waiter = { step: 'error' }
    })
}

async function afterLogin() {
  fs.writeFileSync(config.sessionFile, String(client.session.save()))
  const me = (await client.getMe()) as Api.User
  meId = me.id.toString()
  meName = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || 'the user'
  waiter = { step: 'done' }
  client.addEventHandler(onMessage, new NewMessage({ incoming: true }))
  console.log(`[telegram] signed in as ${meName}`)
}

export function signedIn() {
  return waiter.step === 'done'
}

// ---------- Incoming messages ----------

function nameOf(entity: any): string {
  if (!entity) return 'Someone'
  if (entity.title) return entity.title
  return [entity.firstName, entity.lastName].filter(Boolean).join(' ') || entity.username || 'Someone'
}

async function contextFor(peer: Api.TypePeer, beforeId: number): Promise<string[]> {
  try {
    const msgs = await client.getMessages(peer, { limit: 6, offsetId: beforeId })
    return msgs
      .filter(m => m.message)
      .reverse()
      .map(m => `${m.out ? 'Me' : nameOf((m as any)._sender) ?? 'Them'}: ${m.message.slice(0, 200)}`)
  } catch {
    return []
  }
}

async function onMessage(event: NewMessageEvent) {
  if (!store.active) return
  const msg = event.message
  const text = msg.message?.trim()
  if (!text) return

  const chatId = msg.chatId?.toString() ?? ''
  if (!chatId) return
  peers.set(chatId, msg.peerId)

  const [sender, chat] = await Promise.all([
    msg.getSender().catch(() => undefined),
    // After a restart the entity cache is cold, so fall back to a direct lookup.
    msg
      .getChat()
      .then(c => c ?? client.getEntity(msg.peerId))
      .catch(() => client.getEntity(msg.peerId).catch(() => undefined)),
  ])
  const chatKind: Incoming['chatKind'] = msg.isPrivate ? 'dm' : msg.isChannel && !(chat as any)?.megagroup ? 'channel' : 'group'
  const senderName = nameOf(sender)
  const chatTitle = chatKind === 'dm' ? senderName : nameOf(chat)

  let repliesToMe = false
  if (msg.replyTo && !msg.isPrivate) {
    const replied = await msg.getReplyMessage().catch(() => undefined)
    repliesToMe = Boolean(replied?.out)
  }

  const incoming: Incoming = {
    chatTitle,
    chatKind,
    senderName,
    senderUsername: (sender as any)?.username,
    text,
    mentionsMe: Boolean(msg.mentioned),
    repliesToMe,
    context: [],
  }

  const line = `${senderName}: ${text.slice(0, 300)}`
  if (!isCandidate(incoming)) {
    store.wait(chatId, chatTitle, line)
    return
  }

  incoming.context = await contextFor(msg.peerId, msg.id)
  try {
    const t = await triage(incoming, meName)
    if (!t.needsYou) {
      store.wait(chatId, chatTitle, line)
      return
    }
    const item: QueueItem = {
      id: `${chatId}:${msg.id}`,
      chatId,
      msgId: msg.id,
      chatTitle,
      chatKind,
      senderName,
      text,
      why: t.why,
      replies: t.replies,
      at: Date.now(),
    }
    store.push(item)
    console.log(`[present] needs you: ${chatTitle} / ${senderName} (${t.why})`)
  } catch (err) {
    // If the AI is unavailable, err on the side of showing the message.
    console.error('[present] triage failed, showing message anyway:', (err as Error).message)
    store.push({
      id: `${chatId}:${msg.id}`,
      chatId,
      msgId: msg.id,
      chatTitle,
      chatKind,
      senderName,
      text,
      why: 'Direct message',
      replies: ['Ok!', 'In a meeting, back soon', 'Can we talk later?'],
      at: Date.now(),
    })
  }
}

// ---------- Actions from the glasses ----------

function peerOf(item: QueueItem): Api.TypePeer | string {
  return peers.get(item.chatId) ?? item.chatId
}

export async function sendReply(item: QueueItem, text: string) {
  const peer = peerOf(item)
  await client.sendMessage(peer, { message: text, replyTo: item.msgId })
  await client.markAsRead(peer, item.msgId).catch(() => undefined)
}

export async function react(item: QueueItem, emoji = '👍') {
  const peer = peerOf(item)
  await client.invoke(
    new Api.messages.SendReaction({
      peer,
      msgId: item.msgId,
      reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
    }),
  )
  await client.markAsRead(peer, item.msgId).catch(() => undefined)
}

/** Parks the message in Saved Messages so it is waiting for you later. */
export async function saveForLater(item: QueueItem) {
  const peer = peerOf(item)
  await client.forwardMessages('me', { messages: [item.msgId], fromPeer: peer })
}

export function myName() {
  return meName
}

export function myId() {
  return meId
}
