/**
 * The G2 firmware font silently drops glyphs it does not have (accented
 * letters included), so we normalise text to printable ASCII: "João" becomes
 * "Joao" instead of "Joo".
 */
export function clean(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -​ ]/g, ' ')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cuts text to a maximum length on a word boundary. */
export function cut(input: string, max: number): string {
  const s = clean(input).replace(/\s*\n\s*/g, ' ')
  if (s.length <= max) return s
  const slice = s.slice(0, max - 3)
  const space = slice.lastIndexOf(' ')
  return `${space > max * 0.6 ? slice.slice(0, space) : slice}...`
}

export function minutesSince(ts: number): number {
  return ts ? Math.max(0, Math.round((Date.now() - ts) / 60000)) : 0
}
