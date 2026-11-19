import type { EngineInterface } from 'claude-code'

// Reads the open queue files (`queues/queue-<name>.md`), their settings lines,
// and their session tables. Shared by the status line, the clear before
// next-session, the context attached at next-session, the slash commands, and
// the commit guard.

const QUEUE = /^queue-(.+)\.md$/
// A closed queue has a line starting "Closed <date>, a record only." under its
// title. Anchoring to the line start skips a successor's "Successor to ...
// (closed ..., a record only)" and any row or note that mentions both words.
const CLOSED = /^Closed\b[^\n]*\brecord only\b/im

// A settings line's value: the first word after `**<Name>.**`, lowercased.
export function settingValue(text: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\*\\*${escaped}\\.\\*\\*[ \\t]*([\\w-]+)`, 'mi').exec(text)?.[1]?.toLowerCase()
}

export type Pace = 'economy' | 'balanced' | 'speed'
export type Queue = {
  name: string
  // The queue folder and the queue file's own text, for the context attached at
  // next-session (`context.ts`) and the slash commands (`commands.ts`).
  dir: string
  text: string
  pace: Pace
  autoGoAhead: boolean
  autoCommit: boolean
  clear: boolean
  notify: boolean
}

const PACES: readonly string[] = ['economy', 'balanced', 'speed']

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

export function parseQueue(name: string, dir: string, text: string): Queue {
  const pace = settingValue(text, 'Pace')
  return {
    name,
    dir,
    text,
    pace: pace !== undefined && PACES.includes(pace) ? (pace as Pace) : 'balanced',
    autoGoAhead: settingValue(text, 'Go-ahead') === 'auto',
    autoCommit: settingValue(text, 'Commits') === 'auto',
    clear: settingValue(text, 'Clear') !== 'off',
    notify: settingValue(text, 'Notify') === 'on',
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
    queues.push(parseQueue(m[1] ?? '', dir, text))
  }
  return queues
}

// The queues `next-session [named]` or a command's queue argument means: the
// named one, matched without regard to case, or every open queue.
export const pickQueues = (queues: Queue[], named: string | undefined) =>
  named === undefined ? queues : queues.filter(q => q.name.toLowerCase() === named.toLowerCase())

// --- The session table ------------------------------------------------------

// A session-table row: `| # | Session | Topic file | Status | Model |`. `\r`
// for a queue file saved with Windows line endings.
const ROW = /^\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|[ \t\r]*$/gm

export type Row = { id: string; session: string; topic: string | undefined; status: string; model: string }

// Every row of the session table, in table order, without the header, the
// divider, or `**` markup.
export function rows(text: string): Row[] {
  const out: Row[] = []
  for (const m of text.matchAll(ROW)) {
    const cell = (i: number) => (m[i] ?? '').trim().replace(/\*\*/g, '')
    const id = cell(1)
    if (id === '#' || /^:?-+:?$/.test(id)) continue
    out.push({
      id,
      session: cell(2),
      topic: /`([^`]+)`/.exec(m[3] ?? '')?.[1]?.trim(),
      status: cell(4),
      model: cell(5),
    })
  }
  return out
}

const FINISHED = /^(?:DONE|DROPPED)\b/i
// Statuses that never run as they stand: held for placement, or folded into
// another row.
const HELD = /^TODO\s*\((?:placement not decided|folded into)/i
const RUNNABLE = /^(?:TODO|PAUSED)\b/i

export const isOpen = (r: Row) => !FINISHED.test(r.status)

// The row `next-session` would most likely run: the first TODO or PAUSED row,
// in table order, that isn't held or folded, isn't `after` a row still open
// (every row id named in its parentheses counts), and isn't `last` while
// another row is open. Held and folded rows don't count as open here, since
// they don't run as they stand. Picking exactly is the skill's judgment
// (claims, a PAUSED blocker), so this only guesses.
export const nextRow = (text: string) => nextRowOf(rows(text))

// The same, from rows already parsed: the row returned is one of `all`, so a
// caller can tell it by identity even when two rows share an id.
export function nextRowOf(all: Row[]): Row | undefined {
  const open = new Set(all.filter(r => isOpen(r) && !HELD.test(r.status)).map(r => r.id))
  return all.find(r => {
    if (!RUNNABLE.test(r.status) || HELD.test(r.status)) return false
    const after = /^TODO\s*\(after\b([^)]*)\)/i.exec(r.status)?.[1]
    if (after !== undefined && (after.match(/[\w.-]+/g) ?? []).some(id => id !== r.id && open.has(id))) return false
    if (/^TODO\s*\(last\)/i.test(r.status) && [...open].some(id => id !== r.id)) return false
    return true
  })
}
