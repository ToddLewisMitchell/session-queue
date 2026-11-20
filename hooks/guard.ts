import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { activeQueues, openQueues } from './queues'
import { noteAutoCommit } from './settings-state'

// The commit guard: SKILL.md Principle 2 and the Commits setting, enforced
// on the model's Bash calls while a queue is open.
// - Anything that makes a commit or a merge (`commit`, `merge`, `pull`,
//   `cherry-pick`, `revert`, `am`, `rebase`) brings up the permission dialog
//   unless every open queue's Commits is `auto`.
// - `git push` always does: pushing always needs approval.
// - A subagent's commit, merge, or push is refused: it can't be asked, and
//   the conversation that launched it commits for it (parallel-sessions.md).
// - Force-staging the queue folder while git ignores it is refused, since
//   many users keep `queues/` private.
// - A command it can't read (an unclosed quote or heredoc) that mentions git
//   asks too: the guard fails closed.
// - The commit-or-merge dialog is skipped when the user's latest message was
//   a short approval ("commit", or "yes" to a reply about the commit;
//   `approvalOf`): they have just answered the question the dialog would ask.
//   A push still asks.
// - A commit or merge let through because Commits is `auto` is recorded, so
//   its row in the transcript says so (display.tsx).

export type GitAction = 'commit' | 'merge' | 'push' | 'force-add' | 'unreadable'

type Parsed = { commands: string[][]; subs: string[]; ok: boolean }

// Heredoc bodies are data, never commands: drop them before splitting, also
// inside `$(...)` (where a commit message usually is). `<<<` is a here-string,
// not a heredoc. `ok` is false when a body never ends.
export function stripHeredocs(src: string): { text: string; ok: boolean } {
  const OPEN = /(?<!<)<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/g
  let out = ''
  let pos = 0
  for (;;) {
    OPEN.lastIndex = pos
    const first = OPEN.exec(src)
    if (!first) return { text: out + src.slice(pos), ok: true }
    // Every heredoc opened on this line; their bodies follow it in order.
    const nl = src.indexOf('\n', first.index)
    if (nl < 0) return { text: out + src.slice(pos), ok: false }
    const tags: { tag: string; tabs: boolean }[] = []
    OPEN.lastIndex = first.index
    for (let m = OPEN.exec(src); m && m.index < nl; m = OPEN.exec(src))
      tags.push({ tag: m[3]!, tabs: m[1] === '-' })
    out += src.slice(pos, nl + 1)
    pos = nl + 1
    for (const { tag, tabs } of tags) {
      for (;;) {
        if (pos >= src.length) return { text: out, ok: false }
        const end = src.indexOf('\n', pos)
        const row = src.slice(pos, end < 0 ? src.length : end)
        pos = end < 0 ? src.length : end + 1
        if ((tabs ? row.replace(/^\t+/, '') : row) === tag) break
      }
    }
  }
}

// Splits a shell command line (heredocs already stripped) into simple
// commands' words. Quotes, `${...}`, `$(...)`, and backticks stay inside their
// word; the source of each substitution is kept in `subs`, since it runs too.
// A sketch of the shell, not a parser: it only has to find git at the head of
// a command, and it says when it lost its place (`ok: false`).
export function simpleCommands(line: string): Parsed {
  const commands: string[][] = []
  const subs: string[] = []
  let ok = true
  let words: string[] = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  let i = 0
  while (i < line.length) {
    const c = line[i]!
    if (c === '\\') {
      if (line[i + 1] !== '\n') {
        word += line[i + 1] ?? ''
        inWord = true
      }
      i += 2
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) ok = false
      const stop = end < 0 ? line.length : end
      word += line.slice(i + 1, stop)
      inWord = true
      i = stop + 1
    } else if (c === '"' || c === '`' || (c === '$' && (line[i + 1] === '(' || line[i + 1] === '{'))) {
      const stop = skipNested(line, i, subs)
      if (stop < 0) {
        ok = false
        word += line.slice(i)
        i = line.length
      } else {
        // A double-quoted word keeps its text without the quotes.
        word += c === '"' ? line.slice(i + 1, stop - 1) : line.slice(i, stop)
        i = stop
      }
      inWord = true
    } else if (c === '<' && line.startsWith('<<<', i)) {
      endWord()
      i += 3
    } else if ('\n;&|(){}'.includes(c)) {
      endCommand()
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else if (c === '#' && !inWord) {
      const nl = line.indexOf('\n', i)
      i = nl < 0 ? line.length : nl
    } else {
      word += c
      inWord = true
      i++
    }
  }
  endCommand()
  return { commands, subs, ok }
}

// The index just past the quoted or substituted span that starts at `i`, or
// -1 when it never closes. The inside of each `$(...)` and backtick span is
// pushed to `subs`.
function skipNested(line: string, i: number, subs: string[]): number {
  const open = line[i]!
  if (open === '`') {
    const end = line.indexOf('`', i + 1)
    if (end < 0) return -1
    subs.push(line.slice(i + 1, end))
    return end + 1
  }
  if (open === '"') {
    let j = i + 1
    while (j < line.length && line[j] !== '"') {
      if (line[j] === '\\') j += 2
      else if (line[j] === '`' || (line[j] === '$' && (line[j + 1] === '(' || line[j + 1] === '{'))) {
        j = skipNested(line, j, subs)
        if (j < 0) return -1
      } else j++
    }
    return j < line.length ? j + 1 : -1
  }
  // `$(` or `${`: to the matching close, minding quotes inside.
  const [up, down] = line[i + 1] === '(' ? ['(', ')'] : ['{', '}']
  let depth = 0
  let j = i + 1
  while (j < line.length) {
    const c = line[j]!
    if (c === up) depth++
    else if (c === down && --depth === 0) {
      if (up === '(') subs.push(line.slice(i + 2, j))
      return j + 1
    } else if (c === "'" && up === '(') {
      const end = line.indexOf("'", j + 1)
      if (end < 0) return -1
      j = end
    } else if (c === '"' || c === '`' || (c === '$' && (line[j + 1] === '(' || line[j + 1] === '{'))) {
      const stop = skipNested(line, j, subs)
      if (stop < 0) return -1
      j = stop - 1
    } else if (c === '\\') j++
    j++
  }
  return -1
}

// Git's options that come before the subcommand and take a value.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
// Words that can come before a command without being it: shell keywords and
// commands that run the rest of the line.
const PREFIX = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'command', 'exec', 'nohup', 'nice', 'env', 'sudo', 'xargs', 'timeout'])
const SHELLS = /(^|\/)(ba|da|z|k)?sh$/
// Subcommands that make a commit or a merge, by the action they count as.
const MAKES: Record<string, GitAction> = {
  commit: 'commit', 'cherry-pick': 'commit', revert: 'commit', am: 'commit', rebase: 'commit',
  merge: 'merge', pull: 'merge', push: 'push',
}

// What one simple command does that the guard cares about. Scripts it runs
// (`bash -c '...'`, `eval ...`) are returned to be read in turn.
export function gitAction(words: readonly string[]): { action?: GitAction; scripts: string[] } {
  let i = 0
  while (
    i < words.length &&
    (PREFIX.has(words[i]!) || /^[A-Za-z_]\w*=/.test(words[i]!) || /^-/.test(words[i]!) || /^\d+[smhd]?$/.test(words[i]!))
  )
    i++
  const head = words[i] ?? ''
  if (head === 'eval') return { scripts: [words.slice(i + 1).join(' ')] }
  if (SHELLS.test(head)) {
    const c = words.findIndex((w, k) => k > i && /^-[a-z]*c[a-z]*$/.test(w))
    return { scripts: c > 0 && words[c + 1] !== undefined ? [words[c + 1]!] : [] }
  }
  if (!/(^|\/)git$/.test(head)) return { scripts: [] }
  i++
  while (i < words.length && words[i]!.startsWith('-')) {
    if (GIT_VALUE_OPTS.has(words[i]!)) i++
    i++
  }
  const sub = words[i] ?? ''
  const args = words.slice(i + 1)
  const has = (...flags: string[]) => args.some(a => flags.includes(a))
  if (sub === 'add' || sub === 'stage') return { action: forcesQueues(args) ? 'force-add' : undefined, scripts: [] }
  const action = MAKES[sub]
  if (!action || has('--abort', '--quit')) return { scripts: [] }
  if ((sub === 'commit' || sub === 'push') && has('--dry-run')) return { scripts: [] }
  if (sub === 'push' && has('-n')) return { scripts: [] }
  return { action, scripts: [] }
}

// Without `--force`, git refuses to stage an ignored path by itself; with it,
// a pathspec that could reach the queue folder (the whole tree, a glob, a
// magic or out-of-folder path, or queues/ itself) would stage it.
function forcesQueues(args: readonly string[]) {
  let force = false
  let all = false
  let dashdash = false
  const paths: string[] = []
  for (const a of args) {
    if (!dashdash && a === '--') dashdash = true
    else if (!dashdash && a.startsWith('--')) {
      if (a === '--force') force = true
      if (a === '--all') all = true
    } else if (!dashdash && a.startsWith('-') && a.length > 1) {
      if (a.includes('f')) force = true
      if (a.includes('A')) all = true
    } else paths.push(a)
  }
  if (!force) return false
  if (paths.length === 0) return all
  return paths.some(p => p === '.' || p === './' || /[*?[]/.test(p) || /^(:|\/|\.\.)/.test(p) || /^(\.\/)?queues(\/|$)/.test(p))
}

export function gitActions(command: string, depth = 0): Set<GitAction> {
  const found = new Set<GitAction>()
  const { text, ok: closed } = stripHeredocs(command)
  const { commands, subs, ok } = simpleCommands(text)
  const scripts = [...subs]
  for (const words of commands) {
    const r = gitAction(words)
    if (r.action) found.add(r.action)
    scripts.push(...r.scripts)
  }
  for (const s of scripts) {
    if (depth >= 4) found.add('unreadable')
    else for (const a of gitActions(s, depth + 1)) found.add(a)
  }
  if ((!closed || !ok) && /\bgit\b/.test(command)) found.add('unreadable')
  return found
}

// The words a short approval is made of: every word is from NAMED, BARE, or
// FILLER, and at least one from NAMED or BARE ("commit", "yes please", "go
// ahead and commit", "lgtm"). A negation ("don't commit"), a question
// ("commit?"), or anything longer is no approval, so the dialog stays.
// NAMED words say what's approved; a BARE "yes" or "ok" approves only when
// Claude's last reply was about a commit or merge (`replyIsAboutCommit`), so
// a "yes" to some other question (a go-ahead) doesn't wave a commit through.
const NAMED = new Set(['commit', 'merge', 'approve', 'approved', 'lgtm'])
const BARE = new Set(['yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'go'])
const FILLER = new Set(['it', 'now', 'please', 'ahead', 'and'])
const MAX_WORDS = 8

export type Approval = 'named' | 'bare' | undefined

export function approvalOf(text: string): Approval {
  if (text.includes('?')) return undefined
  const words = text
    .toLowerCase()
    .split(/[\s,;:]+/)
    .map(w => w.replace(/[.!]+$/, ''))
    .filter(Boolean)
  if (words.length === 0 || words.length > MAX_WORDS) return undefined
  if (!words.every(w => NAMED.has(w) || BARE.has(w) || FILLER.has(w))) return undefined
  return words.some(w => NAMED.has(w)) ? 'named' : words.some(w => BARE.has(w)) ? 'bare' : undefined
}

// Whether the user's latest message approved a commit or merge, kept in this
// session's `$.state` (each conversation its own) and written by `notePrompt`.
// It holds until the next prompt, so one approval covers the session's commit,
// its merge, and the hash-recording commit (SKILL.md, workflow 3, step 6).
const approved = atom({ plugin: 'session-queue', key: 'approved' } as const, false, { shape: 'approved-1' })

async function replyIsAboutCommit($: EngineInterface) {
  const recent = await $.session.messages({ last: 6 })
  if ('deny' in recent) return false
  const reply = [...recent].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')
  return reply !== undefined && /\b(commit|merge)/i.test(reply.text)
}

// Called by `register.ts` for every prompt before anything else reads it, and
// with `undefined` when a session starts (a /clear). Only the user's own
// typing (terminal or phone) can approve, and any other prompt that starts a
// turn, or a slash command, takes the approval back. A prompt from elsewhere
// delivered into a running turn (a background task's notification) isn't the
// user's message, so it leaves the approval as it was. Never throws; on a
// failure to read, there's no approval.
export async function notePrompt(
  $: EngineInterface,
  e: { text: string; command?: unknown; isMeta?: true; turnId?: string; origin: { kind: string } } | undefined,
) {
  let yes = false
  if (e !== undefined) {
    const typed = !e.isMeta && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')
    if (!typed && e.turnId !== undefined) return
    const kind = typed && !e.command ? approvalOf(e.text) : undefined
    yes = kind === 'named' || (kind === 'bare' && (await replyIsAboutCommit($).catch(() => false)))
  }
  await update($, approved, () => yes).catch(() => undefined)
}

async function queuesIgnored($: EngineInterface) {
  try {
    return (await $.process.run(['git', 'check-ignore', '-q', 'queues/'])).exitCode === 0
  } catch {
    return false
  }
}

const NAME = 'session-queue'

function commandOf(input: unknown) {
  const command = (input as { command?: unknown } | null)?.command
  return typeof command === 'string' ? command : ''
}

export function guard(on: On) {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const actions = gitActions(commandOf(e.input))
    if (actions.size === 0) return next(e)
    const queues = await openQueues($)
    if (queues.length === 0) return next(e)
    const core = await next(e)
    if (core.decision === 'deny') return core

    if (actions.has('force-add') && (await queuesIgnored($)))
      return { decision: 'deny', reason: `${NAME}: git ignores queues/, so the queue's files stay unstaged. Leave queues/ out of this git add.` }
    const writes = ['commit', 'merge', 'push', 'unreadable'].some(a => actions.has(a as GitAction))
    if (writes && e.agentId !== undefined)
      return { decision: 'deny', reason: `${NAME}: a subagent leaves its work uncommitted and unpushed; the conversation that launched it commits after approval.` }
    if (actions.has('push'))
      return { decision: 'ask', reason: `${NAME}: pushing always needs your approval.` }
    if (actions.has('unreadable'))
      return { decision: 'ask', reason: `${NAME}: couldn't read this command to see whether it commits or pushes. Allow it?` }
    if (actions.has('commit') || actions.has('merge')) {
      // A waiting queue runs no sessions yet, so its setting doesn't count (as
      // in the footer).
      const active = activeQueues(queues)
      const asks = active.some(q => !q.autoCommit)
      if (asks && !(await read($, approved))) {
        const what = actions.has('commit') && actions.has('merge') ? 'commit and merge' : actions.has('commit') ? 'commit' : 'merge'
        return { decision: 'ask', reason: `${NAME}: the queue's Commits setting is approve. Allow this ${what}?` }
      }
      // For the note on the call's row (display.tsx).
      if (!asks && active.length > 0 && e.tool_use_id !== undefined) await noteAutoCommit($, e.tool_use_id).catch(() => undefined)
    }
    return core
  }).catch(($, e, next) => {
    // A broken guard asks about anything that looks like git and lets the
    // rest through on the engine's own verdict, so a bug can't stop every
    // Bash call or wave a push through.
    return /\bgit\b/.test(commandOf(e.input))
      ? { decision: 'ask', reason: `${NAME}: the commit guard failed on this command. Allow it?` }
      : next(e)
  })
}
