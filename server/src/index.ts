import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { store } from './store.js'
import { catchup } from './triage.js'
import { transcribe } from './groq.js'
import * as tg from './telegram.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '64kb' }))

const here = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.resolve(here, '..', 'public')))

// ---------- Login page (local only) ----------

app.get('/api/login', (_req, res) => {
  res.json({ ...tg.loginState(), token: tg.signedIn() ? config.token : '' })
})

app.post('/api/login', (req, res) => {
  tg.answerLogin(String(req.body?.value ?? ''))
  res.json({ ok: true })
})

// ---------- Glasses API (needs the pairing token) ----------

const api = express.Router()
api.use((req, res, next) => {
  const token = req.header('x-present-token') ?? req.query.token
  if (token !== config.token) return res.status(401).json({ error: 'pair the glasses first' })
  if (!tg.signedIn() && process.env.PRESENT_DEV !== '1') return res.status(503).json({ error: 'sign in to Telegram on the server' })
  next()
})

api.get('/state', (_req, res) => {
  res.json({
    me: tg.myName(),
    active: store.active,
    since: store.since,
    handled: store.handled,
    waiting: store.waitingCount(),
    queue: store.queue.slice(0, 5),
    queueSize: store.queue.length,
  })
})

api.post('/session', (req, res) => {
  if (req.body?.active) store.start()
  else store.stop()
  res.json({ active: store.active, since: store.since })
})

api.post('/act', async (req, res) => {
  const { id, kind, index, text } = req.body ?? {}
  const item = store.queue.find(q => q.id === id)
  if (!item) return res.status(404).json({ error: 'message already handled' })
  try {
    if (item.chatId === 'dev') {
      // fake message from /dev/inject: nothing to send
    } else if (kind === 'reply') {
      const body = typeof text === 'string' && text.trim() ? text.trim() : item.replies[Number(index)]
      if (!body) return res.status(400).json({ error: 'no reply text' })
      await tg.sendReply(item, body)
    } else if (kind === 'react') {
      await tg.react(item)
    } else if (kind === 'later') {
      await tg.saveForLater(item)
    } else if (kind !== 'skip') {
      return res.status(400).json({ error: 'unknown action' })
    }
    store.take(item.id)
    if (kind === 'skip') store.wait(item.chatId, item.chatTitle, `${item.senderName}: ${item.text}`)
    res.json({ ok: true })
  } catch (err) {
    console.error('[present] action failed:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

api.get('/catchup', async (_req, res) => {
  const chats = [...store.waiting.values()].sort((a, b) => b.lines.length - a.lines.length).slice(0, 8)
  try {
    const lines = await catchup(chats.map(c => ({ chat: c.chatTitle, lines: c.lines })))
    res.json({
      minutes: store.since ? Math.round((Date.now() - store.since) / 60000) : 0,
      handled: store.handled,
      items: chats.map(c => ({ chat: c.chatTitle, count: c.lines.length, line: lines[c.chatTitle] ?? '' })),
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

api.post('/catchup/done', (_req, res) => {
  store.clear()
  res.json({ ok: true })
})

api.post('/voice', express.raw({ type: 'application/octet-stream', limit: '4mb' }), async (req, res) => {
  try {
    const text = await transcribe(req.body as Buffer)
    res.json({ text })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Development only: inject a fake message to test the glasses UI without Telegram.
if (process.env.PRESENT_DEV === '1') {
  api.post('/dev/inject', (req, res) => {
    const b = req.body ?? {}
    store.active = true
    if (!store.since) store.since = Date.now()
    if (b.wait) {
      store.wait(String(b.chat), String(b.chat), `${b.sender}: ${b.text}`)
    } else {
      store.push({
        id: `dev:${Date.now()}`,
        chatId: 'dev',
        msgId: 0,
        chatTitle: String(b.chat ?? 'Test'),
        chatKind: b.dm ? 'dm' : 'group',
        senderName: String(b.sender ?? 'Tester'),
        text: String(b.text ?? 'Hello?'),
        why: String(b.why ?? 'Asks you directly'),
        replies: b.replies ?? ['Yes, on it', 'In a meeting, back at 4', 'Can it wait?'],
        at: Date.now(),
      })
    }
    res.json({ ok: true })
  })
}

app.use('/api', api)

app.listen(config.port, () => {
  console.log(`[present] server on http://localhost:${config.port}`)
  console.log(`[present] open http://localhost:${config.port}/login.html to sign in to Telegram`)
})

tg.connect().catch(err => console.error('[telegram] connect failed:', err))
