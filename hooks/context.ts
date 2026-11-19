import type { EngineInterface } from 'claude-code'
import { openQueues, type Queue } from './queues'

// The context attached to a `next-session` prompt, so the session starts with
// the queue file and the likely next row's topic file already in hand instead
// of spending tool calls reading them (SKILL.md, workflow 3, step 1).
//
// Picking the row exactly is the skill's judgment (claims, `after X`, folded
// and unplaced rows, a PAUSED blocker), so this only guesses: the first row,
// in table order, whose Status is a TODO or PAUSED the skill could run. The
// note tells the model to read any other row's topic file itself.

// A session-table row: `| # | Session | Topic file | Status | Model |`. `\r`
// for a queue file saved with Windows line endings.
const ROW = /^\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|[ \t\r]*$/gm
// Statuses that never run as they stand: held for placement, or folded into
// another row.
const HELD = /^TODO\s*\((?:placement not decided|folded into)/i
const RUNNABLE = /^(?:TODO|PAUSED)\b/
// The model gets only a head and a path above 100,000 characters, so keep the
// whole attachment under that.
const LIMIT = 90_000

// The topic file (relative to the queue folder) of the first runnable row.
export function nextTopic(text: string): string | undefined {
  for (const m of text.matchAll(ROW)) {
    const status = (m[4] ?? '').trim().replace(/\*\*/g, '')
    if (!RUNNABLE.test(status) || HELD.test(status)) continue
    const file = /`([^`]+)`/.exec(m[3] ?? '')?.[1]?.trim()
    // A relative path inside the queue folder, nothing else (no `/x`, `\\x`,
    // `C:x`, or `..`).
    if (!file || /^(?:[\\/]|[A-Za-z]:)/.test(file) || file.split(/[\\/]/).includes('..')) return undefined
    return file
  }
  return undefined
}

const block = (path: string, body: string) => `<file path="${path}">\n${body.trimEnd()}\n</file>`

async function topicBlock($: EngineInterface, q: Queue) {
  const topic = nextTopic(q.text)
  if (!topic) return undefined
  try {
    return block(`${q.dir}/${topic}`, await $.fs.read(`${q.dir}/${topic}`))
  } catch {
    return undefined // a missing topic file is the skill's to raise
  }
}

const NOTE =
  "Don't read them again to start; re-read one only to check it for changes (as when claiming the row) or " +
  'before editing it. If the row to run is another one, read its topic file yourself.'

// The text to attach for `next-session [named]`, or undefined when there's no
// open queue to attach (none, or the named one isn't open).
export async function queueContext($: EngineInterface, named: string | undefined) {
  const queues = await openQueues($)
  const picked = named === undefined ? queues : queues.filter(q => q.name === named)
  if (picked.length === 0) return undefined
  const queueFiles = picked.map(q => block(`${q.dir}/queue-${q.name}.md`, q.text))
  const plural = picked.length > 1 ? 'files' : 'file'
  const text = (what: string, files: string[]) =>
    `session-queue attached ${what}, read as this prompt was sent. ${NOTE}\n\n${files.join('\n\n')}`
  // With several queues and none named, the skill asks which to run, so attach
  // only the queue files. With one, its next topic file too, while it fits.
  const topic = picked.length === 1 ? await topicBlock($, picked[0]!) : undefined
  if (topic) {
    const both = text('the open queue file and the topic file of its first TODO or PAUSED row', [...queueFiles, topic])
    if (both.length <= LIMIT) return both
  }
  const alone = text(`the open queue ${plural} only`, queueFiles)
  return alone.length <= LIMIT ? alone : `session-queue left out the open queue ${plural}: too long to attach. Read them yourself.`
}
