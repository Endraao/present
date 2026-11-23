/**
 * Demo driver: a Telegram bot plays "the outside world" and sends real
 * messages to your account, so Present can be tested and filmed end to end.
 *
 *   TELEGRAM_BOT_TOKEN=...  (bot created with @BotFather, added to a group)
 *   DEMO_GROUP_ID=...       (group chat id, negative number)
 *   DEMO_DM_ID=...          (your private chat id with the bot, after /start)
 *   DEMO_ME=@yourusername   (the account signed in to Present)
 *
 *   npx tsx scripts/demo.ts [step]
 */
import '../src/config.js'

const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
const group = process.env.DEMO_GROUP_ID?.trim()
const dm = process.env.DEMO_DM_ID?.trim()
const me = process.env.DEMO_ME?.trim() ?? ''
if (!token || !group || !dm) throw new Error('Set TELEGRAM_BOT_TOKEN, DEMO_GROUP_ID and DEMO_DM_ID in .env')

async function bot(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as any
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  return json.result
}

const say = (chat: string, text: string) => bot('sendMessage', { chat_id: chat, text })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const steps: Record<string, () => Promise<void>> = {
  // Group chatter that can wait: Present should keep it off the glasses.
  async chatter() {
    await say(group, 'gm everyone')
    await sleep(1200)
    await say(group, 'Treasury report for October is up in the drive')
    await sleep(1200)
    await say(group, 'lol did you all see the new meme coin with the frog')
  },
  // A mention that needs a decision now.
  async ask() {
    await say(group, `${me} can you join the call at 3pm? We need your sign-off on the treasury proposal before the vote closes at 4.`)
  },
  // A personal DM with a real question.
  async dm() {
    await say(dm, 'Hey! Are we still on for dinner tonight? I can book the table for 8.')
  },
  // A DM that can wait.
  async meme() {
    await say(dm, 'haha check this out later')
  },
}

const which = process.argv[2]
const order = which ? [which] : ['chatter', 'ask', 'dm', 'meme']
for (const name of order) {
  if (!steps[name]) throw new Error(`unknown step ${name}`)
  await steps[name]()
  console.log(`sent: ${name}`)
  if (!which) await sleep(2500)
}
