import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  OsEventTypeList,
  AudioInputSource,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { api, type QueueItem, type State, type Catchup } from './api'
import { clean, cut, minutesSince } from './text'

const bridge = await waitForEvenAppBridge()

// ---------------------------------------------------------------------------
// Screens. Every screen is one page: text on top, optionally a native list
// below that captures input (swipe moves the highlight, tap selects).
// ---------------------------------------------------------------------------

type Screen =
  | { kind: 'home' }
  | { kind: 'card'; item: QueueItem }
  | { kind: 'listening'; item: QueueItem }
  | { kind: 'confirm'; item: QueueItem; text: string }
  | { kind: 'catchup' }
  | { kind: 'notice' }

let screen: Screen = { kind: 'home' }
let state: State | null = null
let offline = ''
let pageCreated = false
let busy = false

const W = 576
const H = 288

function text(id: number, name: string, content: string, y: number, h: number, capture: 0 | 1, color = 4) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: y,
    width: W,
    height: h,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 6,
    containerID: id,
    containerName: name,
    content: clean(content).slice(0, 990) || ' ',
    textColor: color,
    isEventCapture: capture,
  })
}

function list(id: number, name: string, items: string[], y: number, h: number) {
  return new ListContainerProperty({
    xPosition: 0,
    yPosition: y,
    width: W,
    height: h,
    borderWidth: 1,
    borderColor: 5,
    borderRadius: 6,
    paddingLength: 3,
    containerID: id,
    containerName: name,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: W - 16,
      isItemSelectBorderEn: 1,
      itemName: items.map(i => cut(i, 60) || '-'),
    }),
    isEventCapture: 1,
  })
}

async function show(textObject: TextContainerProperty[], listObject: ListContainerProperty[] = []) {
  const page = { containerTotalNum: textObject.length + listObject.length, textObject, listObject }
  if (!pageCreated) {
    const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
    pageCreated = true
    // A page can already exist (e.g. after a reload): then rebuild it instead.
    if (r !== 0) await bridge.rebuildPageContainer(new RebuildPageContainer(page))
  } else {
    await bridge.rebuildPageContainer(new RebuildPageContainer(page))
  }
}

async function renderHome() {
  screen = { kind: 'home' }
  if (offline) {
    return show([text(1, 'home', `PRESENT\n\nCan't reach your Present server.\n${offline}\n\nRetrying...`, 0, H, 1)])
  }
  if (!state?.active) {
    return show([
      text(
        1,
        'home',
        "PRESENT\n\nStay in the room. Telegram handles itself.\n\nOnly messages that need you show up here,\nwith replies ready to send in one tap.\n\nTap  -  start (I'm with people)\nDouble-tap  -  exit",
        0,
        H,
        1,
      ),
    ])
  }
  const mins = minutesSince(state.since)
  return show([
    text(
      1,
      'home',
      `PRESENT  -  ${mins} min\n\nAll clear. Nothing needs you right now.\n\n${state.waiting} message${state.waiting === 1 ? '' : 's'} can wait\n${state.handled} handled\n\nTap  -  end & catch up`,
      0,
      H,
      1,
    ),
  ])
}

const ACTIONS = ['Thumbs up', 'Later (Saved Messages)']

async function renderCard(item: QueueItem) {
  screen = { kind: 'card', item }
  const total = Math.max(1, state?.queueSize ?? 1)
  const where = item.chatKind === 'dm' ? item.senderName : `${item.chatTitle}  -  ${item.senderName}`
  const head = `${total > 1 ? `1/${total}  ` : ''}${cut(where, 44)}\n[${cut(item.why, 30)}]`
  // A leading @mention of you is noise on a 576px display. Two lines max.
  const body = cut(item.text.replace(/^@\w+[,:]?\s+/, ''), 108)
  await show([text(1, 'msg', `${head}\n${body}`, 0, 124, 0)], [list(2, 'acts', [...item.replies, ...ACTIONS], 124, H - 124)])
}

async function renderNotice(line: string) {
  screen = { kind: 'notice' }
  await show([text(1, 'notice', `\n\n\n${line}`, 0, H, 1)])
}

async function renderListening(item: QueueItem) {
  screen = { kind: 'listening', item }
  await show([text(1, 'voice', `Reply to ${cut(item.senderName, 30)}\n\n( listening... )\n\nSpeak, then release.`, 0, H, 1)])
}

async function renderConfirm(item: QueueItem, said: string) {
  screen = { kind: 'confirm', item, text: said }
  await show([text(1, 'confirm', `Send to ${cut(item.senderName, 30)}?\n\n"${cut(said, 220)}"\n\nTap  -  send\nDouble-tap  -  cancel`, 0, H, 1)])
}

async function renderCatchup(data: Catchup) {
  screen = { kind: 'catchup' }
  const head = `CATCH-UP  -  ${data.minutes} min away  -  ${data.handled} handled`
  if (!data.items.length) {
    return show([text(1, 'catch', `${head}\n\nNothing else happened.\n\nTap  -  done`, 0, H, 1)])
  }
  const rows = data.items.map(i => `${cut(i.chat, 16)} (${i.count}): ${i.line}`)
  await show([text(1, 'catchhead', `${head}\nTap to finish`, 0, 56, 0, 3)], [list(2, 'catch', rows, 56, H - 56)])
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function refresh() {
  try {
    state = await api.state()
    offline = ''
  } catch (err) {
    offline = (err as Error).message
  }
}

/** Decide what to show when nothing is in progress. */
async function next() {
  busy = false
  await refresh()
  const first = state?.active ? state.queue[0] : undefined
  if (first) return renderCard(first)
  return renderHome()
}

async function act(kind: 'reply' | 'react' | 'later' | 'skip', extra: { index?: number; text?: string } = {}) {
  if (screen.kind !== 'card' && screen.kind !== 'confirm') return
  const item = screen.item
  const done: Record<string, string> = {
    reply: `Sent to ${item.senderName}`,
    react: `Thumbs up sent to ${item.senderName}`,
    later: 'Saved for later',
    skip: 'Left unread for later',
  }
  busy = true
  try {
    await api.act(item.id, kind, extra)
    await renderNotice(`   ${done[kind]}`)
  } catch (err) {
    await renderNotice(`   Could not do that: ${(err as Error).message}`)
  }
  setTimeout(next, 900)
}

// ---------------------------------------------------------------------------
// Voice reply: long press on a card, speak, release.
// ---------------------------------------------------------------------------

let chunks: Uint8Array[] = []
let recording = false

async function startVoice() {
  if (screen.kind !== 'card' || recording) return
  const item = screen.item
  chunks = []
  recording = true
  busy = true
  await renderListening(item)
  await bridge.audioControl(true, AudioInputSource.Glasses)
}

async function stopVoice() {
  if (!recording || screen.kind !== 'listening') return
  recording = false
  const item = screen.item
  await bridge.audioControl(false)
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    pcm.set(c, at)
    at += c.length
  }
  if (total < 16000) {
    // Less than half a second of audio: treat it as an accidental press.
    busy = false
    return renderCard(item)
  }
  await renderNotice('   Transcribing...')
  try {
    const { text } = await api.voice(pcm)
    if (!text) throw new Error('heard nothing')
    await renderConfirm(item, text)
  } catch (err) {
    await renderNotice(`   ${(err as Error).message}`)
    setTimeout(() => {
      busy = false
      renderCard(item)
    }, 1200)
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Tap is event type 0, which protobuf omits, so an envelope with no type is a tap. */
function typeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
  if (event.audioEvent) {
    if (recording) chunks.push(event.audioEvent.audioPcm)
    return
  }

  const sys = typeOf(event.sysEvent)
  const txt = typeOf(event.textEvent)
  const lst = typeOf(event.listEvent)

  if (sys === OsEventTypeList.LONG_PRESS_EVENT) return startVoice()
  if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return stopVoice()

  const is = (t: OsEventTypeList) => sys === t || txt === t || lst === t
  const double = is(OsEventTypeList.DOUBLE_CLICK_EVENT)
  const click = is(OsEventTypeList.CLICK_EVENT)

  if (double) {
    switch (screen.kind) {
      case 'home':
        return bridge.shutDownPageContainer(1)
      case 'card':
        return act('skip')
      case 'confirm':
        busy = false
        return renderCard(screen.item)
      case 'catchup':
        await api.catchupDone().catch(() => undefined)
        return next()
    }
    return
  }

  if (!click) return

  switch (screen.kind) {
    case 'home': {
      if (offline) return next()
      if (!state?.active) {
        await api.session(true)
        return next()
      }
      await api.session(false)
      busy = true
      await renderNotice('   Catching up...')
      try {
        return renderCatchup(await api.catchup())
      } catch (err) {
        await renderNotice(`   ${(err as Error).message}`)
        setTimeout(next, 1500)
        return
      }
    }
    case 'card': {
      const index = event.listEvent?.currentSelectItemIndex ?? 0
      const replies = screen.item.replies.length
      if (index < replies) return act('reply', { index })
      if (index === replies) return act('react')
      return act('later')
    }
    case 'confirm':
      return act('reply', { text: screen.text })
    case 'catchup':
      await api.catchupDone().catch(() => undefined)
      return next()
  }
})

// Poll while idle. A card stays on screen until you act on it.
setInterval(async () => {
  if (busy || screen.kind !== 'home') return
  const key = () => JSON.stringify([state?.active, state?.waiting, state?.handled, offline, minutesSince(state?.since ?? 0)])
  const before = key()
  await refresh()
  if (busy || screen.kind !== 'home') return
  const first = state?.active ? state.queue[0] : undefined
  if (first) return renderCard(first)
  if (before !== key()) renderHome()
}, 2000)

await next()
