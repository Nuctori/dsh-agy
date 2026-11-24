import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const root = join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(full)
  }
  return out
}
const files = walk(root)
  .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, 8)

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const found: Array<{ at: number, where: string, failure: unknown }> = []
for (const { file, mtime } of files) {
  const buffer = readFileSync(file)
  const starts: number[] = []
  let cursor = 0
  while ((cursor = buffer.indexOf(magic, cursor)) !== -1) {
    starts.push(cursor)
    cursor += 4
  }
  const lines: string[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : buffer.length
    try {
      lines.push(...zstdDecompressSync(buffer.subarray(starts[i]!, end)).toString('utf8').split('\n'))
    } catch {}
  }
  for (const line of lines) {
    if (!line.includes('agy')) continue
    if (!line.includes('"kind":"error"') && !line.includes('429')) continue
    try {
      const event = JSON.parse(line) as { time?: number, data?: Record<string, unknown> }
      const stream = (event.data as { stream?: Array<{ chunk?: { finish?: { reason?: { failure?: unknown, error?: unknown } } } }> })?.stream
      for (const item of stream ?? []) {
        const failure = item.chunk?.finish?.reason?.failure ?? item.chunk?.finish?.reason?.error
        if (failure !== undefined) found.push({ at: event.time ?? mtime, where: file, failure })
      }
      const reason = (event.data as { reason?: { error?: unknown } })?.reason
      if (reason?.error !== undefined) found.push({ at: event.time ?? mtime, where: file, failure: reason.error })
    } catch {}
  }
}
found.sort((a, b) => b.at - a.at)
console.log('agy failures:', found.length)
for (const entry of found.slice(0, 5)) {
  console.log('---', new Date(entry.at).toISOString(), entry.where.split('sessions\\')[1]?.split('\\')[0]?.slice(0, 40))
  console.log(JSON.stringify(entry.failure).slice(0, 600))
}
