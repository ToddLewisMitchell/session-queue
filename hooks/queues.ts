import type { EngineInterface } from 'claude-code'

// Reads the open queue files (`queues/queue-<name>.md`) and their settings
// lines. Shared by the status line, the clear before next-session, and the
// commit guard.

const QUEUE = /^queue-(.+)\.md$/
const PACE = /^\*\*Pace\.\*\*\s*(economy|balanced|speed)\b/m
const GO_AHEAD = /^\*\*Go-ahead\.\*\*\s*(ask|auto)\b/m
const COMMITS = /^\*\*Commits\.\*\*\s*(approve|auto)\b/m
const CLEAR = /^\*\*Clear\.\*\*\s*(auto|off)\b/m
// A closed queue has a line starting "Closed <date>, a record only." under its
// title. Anchoring to the line start skips a successor's "Successor to ...
// (closed ..., a record only)" and any row or note that mentions both words.
const CLOSED = /^Closed\b[^\n]*\brecord only\b/im

export type Pace = 'economy' | 'balanced' | 'speed'
export type Queue = { name: string; pace: Pace; autoGoAhead: boolean; autoCommit: boolean; clear: boolean }

// The queue folder sits at the main checkout's root. A session in a git
// worktree (`.claude/worktrees/...`) doesn't have it when git ignores it, so
// look in the main checkout, found through git's common dir.
async function queueEntries($: EngineInterface) {
  try {
    return { dir: 'queues', entries: await $.fs.list('queues') }
  } catch {}
  try {
    const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    const common = r.stdout.trim()
    if (r.exitCode !== 0 || !common.endsWith('/.git')) return undefined
    const dir = `${common.slice(0, -'/.git'.length)}/queues`
    return { dir, entries: await $.fs.list(dir) }
  } catch {
    return undefined
  }
}

export async function openQueues($: EngineInterface) {
  const found = await queueEntries($)
  if (!found) return []
  const { dir, entries } = found
  const queues: Queue[] = []
  for (const entry of entries) {
    const m = entry.kind === 'file' ? QUEUE.exec(entry.name) : null
    if (!m) continue
    let text: string
    try {
      text = await $.fs.read(`${dir}/${entry.name}`)
    } catch {
      continue
    }
    if (CLOSED.test(text)) continue
    queues.push({
      name: m[1] ?? '',
      pace: (PACE.exec(text)?.[1] as Pace) ?? 'balanced',
      autoGoAhead: GO_AHEAD.exec(text)?.[1] === 'auto',
      autoCommit: COMMITS.exec(text)?.[1] === 'auto',
      clear: CLEAR.exec(text)?.[1] !== 'off',
    })
  }
  return queues
}
