import type { EngineInterface, On } from 'claude-code'
import { refresh } from './status'
import { isOpen, nextRow, openQueues, pickQueues, rows, settingValue, type Queue } from './queues'

// Slash commands that read or change the queue file with no model turn:
// - `/queue [name]`: the open rows, what `next-session` runs next, and the
//   settings (SKILL.md, workflow 6, without its ListAgents check).
// - `/queue-<setting> <value> [name]`: one settings line, rewritten in the
//   template's form with today's date, keeping the old line's own notes after
//   `(chosen <date>;` (a targeted line replacement, Principle 6). A missing
//   line is added where the template puts it.
// The queue name is needed only with two open queues; it and the value may
// come in either order, in any case.

type Setting = {
  command: string
  name: string
  section: string
  // Each value, with the template's explanation where it has one.
  values: Record<string, string>
  // The line's older name, replaced by a change when the new one is missing.
  legacy?: string
}

const GACC = 'Go-ahead, Commits, and Clear'
export const SETTINGS: readonly Setting[] = [
  { command: 'queue-parallels', name: 'Parallels', section: 'Parallels', values: { off: '', ask: '', auto: '' }, legacy: 'Pace' },
  {
    command: 'queue-go-ahead',
    name: 'Go-ahead',
    section: GACC,
    values: { ask: '', auto: "start building without waiting when there's nothing to decide" },
  },
  {
    command: 'queue-commits',
    name: 'Commits',
    section: GACC,
    values: { approve: '', auto: 'commit and merge without waiting when the Checks and review pass' },
  },
  {
    command: 'queue-clear',
    name: 'Clear',
    section: GACC,
    values: { auto: 'clear the conversation when I type next-session', off: '' },
  },
  {
    command: 'queue-notify',
    name: 'Notify',
    section: 'Notifications',
    values: { off: '', on: 'push a notification when a session stops for my decision or approval' },
  },
]

// The settings lines in the template's order, for placing a missing one. `Pace`
// is the older name of the Parallels line, still found in older queues.
const ORDER = ['Branching', 'Parallels', 'Pace', 'Go-ahead', 'Commits', 'Clear', 'Notify']

// `[^\\r\\n]*` rather than `.*`, so a Windows line ending stays.
const lineOf = (name: string) => new RegExp(`^\\*\\*${name}\\.\\*\\*[^\\r\\n]*`, 'mi')

// Today's date, YYYY-MM-DD, in local time.
function today(ms: number) {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

// The queue text with `s` set to `value`: its line replaced, or a new one put
// after the closest earlier settings line (else before the closest later one,
// else before the first `##` heading, else at the end).
export function setLine(text: string, s: Setting, value: string, date: string) {
  const why = s.values[value]
  const old = lineOf(s.name).exec(text) ?? (s.legacy ? lineOf(s.legacy).exec(text) : null)
  // The old line's notes after `(chosen <date>;`, kept (an older name's section
  // renamed); else the template's.
  const notes = old
    ? /\(chosen [^;)]*;\s*(.*)\)\.?\s*$/.exec(old[0])?.[1]?.replace(new RegExp(`\\b${s.legacy ?? s.name} section\\b`), `${s.section} section`)
    : undefined
  const line = `**${s.name}.** ${value}${why ? `: ${why}` : ''} (chosen ${date}; ${notes ?? `see the skill's ${s.section} section`}).`
  if (old) return text.slice(0, old.index) + line + text.slice(old.index + old[0].length)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const at = ORDER.indexOf(s.name)
  for (const name of ORDER.slice(0, at).reverse()) {
    const m = lineOf(name).exec(text)
    if (m) return `${text.slice(0, m.index + m[0].length)}${nl}${nl}${line}${text.slice(m.index + m[0].length)}`
  }
  for (const name of ORDER.slice(at + 1)) {
    const m = lineOf(name).exec(text)
    if (m) return `${text.slice(0, m.index)}${line}${nl}${nl}${text.slice(m.index)}`
  }
  const heading = /^## /m.exec(text)
  if (heading) return `${text.slice(0, heading.index)}${line}${nl}${nl}${text.slice(heading.index)}`
  return `${text.trimEnd()}${nl}${nl}${line}${nl}`
}

// The one queue a command acts on, or the reason there isn't one.
function oneQueue(queues: Queue[], named: string | undefined): Queue | string {
  const picked = pickQueues(queues, named)
  if (picked.length === 1) return picked[0]!
  if (queues.length === 0) return 'No open queue (queues/queue-<name>.md).'
  if (named !== undefined && picked.length > 1) return `More than one queue is named ${named}: ${picked.map(q => q.name).join(', ')}.`
  if (named !== undefined) return `No open queue named ${named}. Open: ${queues.map(q => q.name).join(', ')}.`
  return `Two or more queues are open; name one: ${queues.map(q => q.name).join(', ')}.`
}

const settingsSummary = (q: Queue) =>
  [
    `parallels ${q.parallels}`,
    `go-ahead ${q.autoGoAhead ? 'auto' : 'ask'}`,
    `commits ${q.autoCommit ? 'auto' : 'approve'}`,
    `clear ${q.clear ? 'auto' : 'off'}`,
    `notify ${q.notify ? 'on' : 'off'}`,
  ].join(' · ')

// The `/queue` view of one queue.
export function view(q: Queue) {
  const open = rows(q.text).filter(isOpen)
  const next = nextRow(q.text)
  const lines = [`Queue ${q.name}: ${settingsSummary(q)}`]
  lines.push(next ? `next-session runs ${next.id} (${next.session}) on ${next.model || 'the current model'}` : 'next-session: no runnable row')
  if (open.length === 0) lines.push('No open rows.')
  else for (const r of open) lines.push(`  ${r.id}  ${r.session}: ${r.status}`)
  return lines.join('\n')
}

// Declares the commands; called from register.ts's own `session.start` hook
// (the engine takes one unmatched hook per event).
export async function registerCommands($: EngineInterface) {
  await $.command
    .register({ name: 'queue', description: 'Show the open queue: its rows, what next-session runs, and its settings', argumentHint: '[queue]' })
    .catch(() => undefined)
  for (const s of SETTINGS) {
    await $.command
      .register({
        name: s.command,
        description: `Set the queue's ${s.name} line`,
        argumentHint: `<${Object.keys(s.values).join('|')}> [queue]`,
      })
      .catch(() => undefined)
  }
}

// Answers the commands.
export function commands(on: On) {

  on('command.run', { command: 'queue' }, async ($, e) => {
    const queues = await openQueues($)
    const named = e.args.trim() || undefined
    const picked = pickQueues(queues, named)
    if (picked.length === 0) {
      const r = oneQueue(queues, named)
      return { text: typeof r === 'string' ? r : view(r) }
    }
    return { text: picked.map(view).join('\n\n') }
  })

  for (const s of SETTINGS) {
    on('command.run', { command: s.command }, async ($, e) => {
      const usage = `Usage: /${s.command} <${Object.keys(s.values).join('|')}> [queue]`
      const words = e.args.trim().split(/\s+/).filter(Boolean)
      // Own keys only: `in` would also take `constructor` and the like.
      const at = words.findIndex(w => Object.hasOwn(s.values, w.toLowerCase()))
      const value = words[at]?.toLowerCase()
      // Only that one word is the value, so a queue named `auto` still works.
      const rest = words.filter((_, i) => i !== at)
      if (value === undefined || rest.length > 1) return { text: usage }
      const q = oneQueue(await openQueues($), rest[0])
      if (typeof q === 'string') return { text: q }
      if (settingValue(q.text, s.name) === value)
        return { text: `Queue ${q.name}: ${s.name} is already ${value}.` }
      const path = `${q.dir}/queue-${q.name}.md`
      try {
        // Re-read just before writing, so an edit since the read isn't lost.
        const current = await $.fs.read(path)
        await $.fs.write(path, setLine(current, s, value, today(await $.clock.now())))
      } catch {
        return { text: `Couldn't update ${path}; nothing was changed.` }
      }
      await refresh($).catch(() => undefined)
      return { text: `Queue ${q.name}: ${s.name} set to ${value}.` }
    })
  }
}
