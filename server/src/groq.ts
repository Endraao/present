import { config } from './config.js'

const BASE = 'https://api.groq.com/openai/v1'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** Calls the Groq chat API and parses a JSON object from the answer. */
export async function chatJson<T>(messages: ChatMessage[], maxTokens = 600): Promise<T> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.textModel,
      messages,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    }),
  })
  const body = (await res.json()) as any
  if (!res.ok) throw new Error(`Groq ${res.status}: ${body?.error?.message ?? 'unknown error'}`)
  const text: string = body.choices?.[0]?.message?.content ?? ''
  return JSON.parse(text) as T
}

/** Wraps raw 16 kHz mono s16le PCM in a WAV header. */
function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Loudness of s16le PCM. Whisper invents text ("Thank you.") on silence, so we gate on it. */
function rms(pcm: Buffer): number {
  let sum = 0
  const n = Math.floor(pcm.length / 2)
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2)
    sum += s * s
  }
  return n ? Math.sqrt(sum / n) : 0
}

/** Speech to text with Whisper on Groq. Returns '' when nothing was said. */
export async function transcribe(pcm: Buffer): Promise<string> {
  if (pcm.length < 16000 || rms(pcm) < 150) return ''
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(pcmToWav(pcm))], { type: 'audio/wav' }), 'voice.wav')
  form.append('model', config.sttModel)
  form.append('response_format', 'json')
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqKey}` },
    body: form,
  })
  const body = (await res.json()) as any
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${body?.error?.message ?? 'unknown error'}`)
  return String(body.text ?? '').trim()
}
