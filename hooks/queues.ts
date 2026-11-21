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
// A queue that runs after another has a line starting "Waits for
// `queue-<name>.md`" under its title (markup such as `**` or `> ` allowed). It
// isn't active while that queue is open.
const WAITS = /^[>*_\s]*Waits for[*_]*\s+`?queue-([^`\s]+?)\.md\b/im

// A settings line's value: the first word after `**<Name>.**`, lowercased.
export function settingValue(text: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\*\\*${escaped}\\.\\*\\*[ \\t]*([\\w-]+)`, 'mi').exec(text)?.[1]?.toLowerCase()
}

// Whether a Clear line's value turns the clear on: `on`, an older queue's
// `auto`, or no line. Any other word (`off`, a typo) leaves it off, so a hand
// edit never clears a conversation the user meant to keep.
const clearOn = (v: string | undefined) => v === undefined || v === 'on' || v === 'auto'

// Auto-advance's default weekly percentage, when the line says `on` alone.
export const DEFAULT_PERCENT = 80

// The weekly percentage the Auto-advance line gives when it's on (advance.ts):
// the first `<n>%` after `on` on that line, else the default. Undefined when
// it's off or missing.
export function advancePercent(text: string): number | undefined {
  const line = /^\*\*Auto-advance\.\*\*[ \t]*([^\r\n]*)/im.exec(text)?.[1]
  if (!line || !/^on\b/i.test(line)) return undefined
  const n = Number(/\b(\d{1,3})\s*%/.exec(line)?.[1] ?? DEFAULT_PERCENT)
  return Math.min(100, Math.max(1, n))
}

export type Parallels = 'off' | 'ask' | 'auto'
export type Queue = {
  name: string
  // The queue folder and the queue file's own text, for the context attached at
  // next-session (`context.ts`) and the slash commands (`commands.ts`).
  dir: string
  text: string
  parallels: Parallels
  autoGoAhead: boolean
  autoCommit: boolean
  clear: boolean
  notify: boolean
  // Auto-advance's weekly percentage when it's on (advance.ts).
  autoAdvance: number | undefined
  // The queue this one waits for (its name), when it has a Waits line.
  waitsFor: string | undefined
}

const PARALLELS: readonly string[] = ['off', 'ask', 'auto']
// An older queue's Pace line, read as the Parallels setting it became.
const FROM_PACE: Record<string, Parallels> = { economy: 'off', balanced: 'ask', speed: 'auto' }

// The queue folder sits at the main checkout's root. A relative path follows
// the shell's `cd`, so after `cd src` `queues` isn't there (or is some other
// `queues/`, such as job-queue code): look under the project root next, which
// a shell `cd` doesn't move. A session in a git worktree
// (`.claude/worktrees/...`) doesn't have it when git ignores it, so then look
// in the main checkout, found through the engine's working-copy lookup, else
// (an engine before `$.vcs`, 2.1.328 and older) git's common dir, run from the
// project root. A folder counts only when it holds a queue file.
async function listed($: EngineInterface, dir: string) {
  try {
    const entries = await $.fs.list(dir)
    return entries.some(e => e.kind === 'file' && QUEUE.test(e.name)) ? { dir, entries } : undefined
  } catch {
    return undefined
  }
}

async function queueEntries($: EngineInterface) {
  const here = await listed($, 'queues')
  if (here) return here
  const root = await $.session.root().catch(() => undefined)
  if (root) {
    const cwd = await $.session.cwd().catch(() => undefined)
    if (cwd !== root) {
      const atRoot = await listed($, `${root}/queues`)
      if (atRoot) return atRoot
    }
    let copy: Awaited<ReturnType<typeof $.vcs.detect>> | undefined
    try {
      copy = await $.vcs.detect({ path: root })
    } catch {}
    if (copy) {
      const main = copy.mainRoot ?? copy.root
      return main === root || main === cwd ? undefined : listed($, `${main}/queues`)
    }
  }
  try {
    const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], root ? { cwd: root } : undefined)
    const common = r.stdout.trim()
    if (r.exitCode !== 0 || !common.endsWith('/.git')) return undefined
    return listed($, `${common.slice(0, -'/.git'.length)}/queues`)
  } catch {
    return undefined
  }
}

export function parseQueue(name: string, dir: string, text: string): Queue {
  const set = settingValue(text, 'Parallels')
  const pace = settingValue(text, 'Pace')
  const parallels =
    set !== undefined ? (PARALLELS.includes(set) ? (set as Parallels) : undefined) : pace !== undefined && Object.hasOwn(FROM_PACE, pace) ? FROM_PACE[pace] : undefined
  return {
    name,
    dir,
    text,
    parallels: parallels ?? 'ask',
    autoGoAhead: settingValue(text, 'Go-ahead') === 'auto',
    autoCommit: settingValue(text, 'Commits') === 'auto',
    clear: clearOn(settingValue(text, 'Clear')),
    notify: settingValue(text, 'Notify') === 'on',
    autoAdvance: advancePercent(text),
    waitsFor: WAITS.exec(text)?.[1],
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

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// The open queue `q` waits for, if any.
export const waitedFor = (q: Queue, queues: Queue[]) =>
  q.waitsFor === undefined ? undefined : queues.find(o => o !== q && sameName(o.name, q.waitsFor!))

// Whether `q` waits for a queue that's still open. A queue in a loop of Waits
// lines doesn't wait, so the loop isn't hidden.
export function isWaiting(q: Queue, queues: Queue[]) {
  const seen = new Set<Queue>([q])
  for (let o = waitedFor(q, queues); o; o = waitedFor(o, queues)) {
    if (o === q) return false
    if (seen.has(o)) return true // a loop further on, which q waits behind
    seen.add(o)
  }
  return waitedFor(q, queues) !== undefined
}

// The active queues: the open ones not waiting for another open queue.
export const activeQueues = (queues: Queue[]) => queues.filter(q => !isWaiting(q, queues))

// The queues `next-session [named]` or a command's queue argument means: the
// named open one, matched without regard to case, or every active queue.
export const pickQueues = (queues: Queue[], named: string | undefined) =>
  named === undefined ? activeQueues(queues) : queues.filter(q => sameName(q.name, named))

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

// The row ids a `TODO (after X)` status names: every id after "after", up to a
// `;`, the word "before", or the closing parenthesis (also words such as
// "and", which match no row). Empty for any other status.
export function afterIds(status: string) {
  const after = /^TODO\s*\(after\b([^);]*?)(?:\bbefore\b|[;)])/i.exec(status)?.[1]
  return after === undefined ? [] : (after.match(/[\w.-]+/g) ?? [])
}

export const isOpen = (r: Row) => !FINISHED.test(r.status)

// The row `next-session` would most likely run: the first TODO or PAUSED row,
// in table order, that isn't held or folded, isn't `after` a row still open
// (every row id named after "after", up to a `;`, the word "before" or the
// closing parenthesis, counts), and isn't `last` while
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
    if (afterIds(r.status).some(id => id !== r.id && open.has(id))) return false
    if (/^TODO\s*\(last\)/i.test(r.status) && [...open].some(id => id !== r.id)) return false
    return true
  })
}
