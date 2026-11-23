import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..', '..')
export const DATA_DIR = path.resolve(here, '..', 'data')

loadEnv({ path: path.join(ROOT, '.env') })
fs.mkdirSync(DATA_DIR, { recursive: true })

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

/** Token the glasses app must send. Generated once and kept locally. */
function pairToken(): string {
  const file = path.join(DATA_DIR, 'pair-token.txt')
  if (process.env.PRESENT_TOKEN?.trim()) return process.env.PRESENT_TOKEN.trim()
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  const token = crypto.randomBytes(16).toString('hex')
  fs.writeFileSync(file, token)
  return token
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  groqKey: required('GROQ_API_KEY'),
  telegramApiId: Number(required('TELEGRAM_API_ID')),
  telegramApiHash: required('TELEGRAM_API_HASH'),
  /** Text model on Groq used for triage, drafts and catch-up. */
  textModel: process.env.PRESENT_TEXT_MODEL ?? 'openai/gpt-oss-20b',
  sttModel: process.env.PRESENT_STT_MODEL ?? 'whisper-large-v3-turbo',
  /** Usernames (without @) whose messages always reach you. */
  vips: (process.env.PRESENT_VIPS ?? '')
    .split(',')
    .map(s => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean),
  /** Words that make a group message worth a look even without a mention. */
  alertWords: (process.env.PRESENT_ALERT_WORDS ??
    'urgent,asap,emergency,down,outage,hacked,exploit,drained,deploy failed,incident,help')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  sessionFile: path.join(DATA_DIR, 'telegram.session'),
  token: pairToken(),
}
