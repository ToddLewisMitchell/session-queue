import type { EngineInterface } from 'claude-code'
import { nextRow, openQueues, pickQueues, type Queue } from './queues'

// The context attached to a `next-session` prompt, so the session starts with
// the queue file and the likely next row's topic file already in hand instead
// of spending tool calls reading them (SKILL.md, workflow 3, step 1).
//
// Picking the row exactly is the skill's judgment (claims, folded and unplaced
// rows, a PAUSED blocker), so this only guesses (`nextRow` in `queues.ts`).
// The note tells the model to read any other row's topic file itself.

// The model gets only a head and a path above 100,000 characters, so keep the
// whole attachment under that.
const LIMIT = 90_000

// The topic file (relative to the queue folder) of the likely next row.
export function nextTopic(text: string): string | undefined {
  const file = nextRow(text)?.topic
  // A relative path inside the queue folder, nothing else (no `/x`, `\\x`,
  // `C:x`, or `..`).
  if (!file || /^(?:[\\/]|[A-Za-z]:)/.test(file) || file.split(/[\\/]/).includes('..')) return undefined
  return file
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

// `next-session` is a keyword of the session-queue skill, not a skill of its
// own: without this, the model's first try is Skill("next-session"), which
// fails with "Unknown skill".
const SKILL =
  'This `next-session` is the session-queue skill\'s: load it with the Skill tool as ' +
  '`session-queue:session-queue` (there is no `next-session` skill).'

const NOTE =
  "Don't read them again to start; re-read one only to check it for changes (as when claiming the row) or " +
  'before editing it. If the row to run is another one, read its topic file yourself.'

// The text to attach for `next-session [named]`: which skill runs it, then
// the open queue files (none when no queue is open, or the named one isn't).
export async function queueContext($: EngineInterface, named: string | undefined) {
  const files = await attachedFiles($, named).catch(() => undefined)
  return files === undefined ? SKILL : `${SKILL}\n\n${files}`
}

async function attachedFiles($: EngineInterface, named: string | undefined) {
  const picked = pickQueues(await openQueues($), named)
  if (picked.length === 0) return undefined
  const queueFiles = picked.map(q => block(`${q.dir}/queue-${q.name}.md`, q.text))
  const plural = picked.length > 1 ? 'files' : 'file'
  const text = (what: string, files: string[]) =>
    `session-queue attached ${what}, read as this prompt was sent. ${NOTE}\n\n${files.join('\n\n')}`
  // With several active queues and none named, the skill asks which to run, so
  // attach only the queue files. With one, its next topic file too, while it fits.
  const topic = picked.length === 1 ? await topicBlock($, picked[0]!) : undefined
  if (topic) {
    const both = text('the open queue file and the topic file of its first TODO or PAUSED row', [...queueFiles, topic])
    if (both.length <= LIMIT) return both
  }
  const alone = text(`the open queue ${plural} only`, queueFiles)
  return alone.length <= LIMIT ? alone : `session-queue left out the open queue ${plural}: too long to attach. Read them yourself.`
}
