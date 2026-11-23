// Quick manual check of the triage prompt: npx tsx scripts/try-triage.ts
import { triage } from '../src/triage.js'

const samples = [
  { chatTitle: 'Alpha DAO', chatKind: 'group', senderName: 'João', text: '@me can you join the call at 3pm? we need your sign-off on the treasury proposal before the vote', mentionsMe: true, repliesToMe: false, context: ['Ana: vote closes at 4pm today', 'João: treasury proposal v2 is up'] },
  { chatTitle: 'Mãe', chatKind: 'dm', senderName: 'Mãe', text: 'filho, você vem jantar hoje? fiz lasanha', mentionsMe: false, repliesToMe: false, context: [] },
  { chatTitle: 'Pedro', chatKind: 'dm', senderName: 'Pedro', text: 'kkkkk olha esse meme', mentionsMe: false, repliesToMe: false, context: [] },
] as const

for (const s of samples) {
  const t0 = Date.now()
  const r = await triage({ ...s, context: [...s.context] }, 'Endrao')
  console.log(`${Date.now() - t0}ms`, s.senderName, JSON.stringify(r))
}
