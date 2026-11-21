import type { EngineInterface, On } from 'claude-code'
import { settingsOf, summary } from './settings-state'
import { refresh } from './status'
import {
  activeQueues,
  advancePercent,
  DEFAULT_PERCENT,
  isOpen,
  isWaiting,
  nextRow,
  waitedFor,
  openQueues,
  parseQueue,
  pickQueues,
  rows,
  settingValue,
  type Queue,
} from './queues'

// Slash commands that read or change the queue file with no model turn:
// - `/queue [name]`: the open rows, what `next-session` runs next, and the
//   settings (SKILL.md, workflow 6, without its ListAgents check).
// - `/queue-<setting> <value> [name]`: one settings line, rewritten in the
//   template's form with today's date, keeping the old line's own notes after
//   `(chosen <date>;` (a targeted line replacement, Principle 6). A missing
//   line is added where the template puts it.
// The queue name is needed only with two active queues (a queue waiting for
// another isn't active); it and the value may come in either order, in any case.

export type Setting = {
  command: string
  // What the command does, in the user's terms, for the command list.
  description: string
  name: string
  section: string
  // Each value, with the template's explanation where it has one.
  values: Record<string, string>
  // The line's older name, replaced by a change when the new one is missing.
  legacy?: string
  // Auto-advance only: a percentage (`80` or `80%`) also means `on`, until
  // that share of the weekly usage limit.
  percent?: true
  // Settings a change to `on` turns on too (Auto-advance needs all three).
  turnsOn?: readonly (readonly [name: string, value: string])[]
  // Older values still found in queue files, and the value each reads as.
  older?: Record<string, string>
}

const GACC = 'Go-ahead, Commits, and Clear'
export const SETTINGS: readonly Setting[] = [
  {
    command: 'queue-parallels',
    description: 'Choose how many queue sessions run at once: off (one at a time), ask (offer parallel ones), or auto (start every one that can)',
    name: 'Parallels',
    section: 'Parallels',
    values: { off: '', ask: '', auto: '' },
    legacy: 'Pace',
  },
  {
    command: 'queue-go-ahead',
    description: "Choose whether a session waits for your go-ahead before building: ask, or auto (go on when there's nothing to decide)",
    name: 'Go-ahead',
    section: GACC,
    values: { ask: '', auto: "start building without waiting when there's nothing to decide" },
  },
  {
    command: 'queue-commit',
    description: 'Choose whether a session commits on its own: ask (wait for your approval), or auto (commit when the checks and review pass)',
    name: 'Commits',
    section: GACC,
    values: { ask: '', auto: 'commit and merge without waiting when the Checks and review pass' },
    older: { approve: 'ask' },
  },
  {
    command: 'queue-autoclear',
    description: 'Choose whether next-session clears the conversation first: auto (clear it), or off (keep it)',
    name: 'Clear',
    section: GACC,
    values: { auto: 'clear the conversation when I type next-session', off: '' },
  },
  {
    command: 'queue-autoadvance',
    description:
      'Choose whether the queue runs its next session by itself when one finishes: off, or on until a share of your weekly usage limit (80% unless you give one, e.g. 70%); on also turns on auto go-ahead, auto-commit, and auto-clear',
    name: 'Auto-advance',
    section: GACC,
    values: { off: '', on: '' },
    percent: true,
    turnsOn: [
      ['Go-ahead', 'auto'],
      ['Commits', 'auto'],
      ['Clear', 'auto'],
    ],
  },
  {
    command: 'queue-notify',
    description: 'Choose whether a session sends a push notification when it needs you: on or off',
    name: 'Notify',
    section: 'Notifications',
    values: { off: '', on: 'push a notification when a session stops for my decision or approval' },
  },
]

// The settings lines in the template's order, for placing a missing one. `Pace`
// is the older name of the Parallels line, still found in older queues.
const ORDER = ['Branching', 'Parallels', 'Pace', 'Go-ahead', 'Commits', 'Clear', 'Auto-advance', 'Notify']

// The value a queue's line gives the setting named `name`, an older value
// read as its new one (`approve` as `ask`), so comparing with a value from the
// command doesn't take an old line for a different setting.
export function currentValue(text: string, name: string) {
  const v = settingValue(text, name)
  const older = SETTINGS.find(s => s.name === name)?.older
  return v !== undefined && older && Object.hasOwn(older, v) ? older[v] : v
}

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
export function setLine(text: string, s: Setting, value: string, date: string, why = s.values[value]) {
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

// Sets one settings line of queue `q`'s file, re-read just before writing so
// an edit since the read isn't lost. `value` may be worked out from that text
// (the pane's buttons step on from the current value). Used by the commands
// and the queue pane's settings buttons (pane.tsx). Auto-advance `on` keeps
// the percentage given, else the line's own, else the default, and turns on
// the settings it needs in the same write (`also`, the ones it changed).
// Returns the value written, or why it couldn't.
export async function writeSetting(
  $: EngineInterface,
  q: Queue,
  s: Setting,
  value: string | ((current: Queue) => string),
  percent?: number,
) {
  const path = `${q.dir}/queue-${q.name}.md`
  try {
    const current = await $.fs.read(path)
    const v = typeof value === 'string' ? value : value(parseQueue(q.name, q.dir, current))
    const date = today(await $.clock.now())
    const on = s.percent && v === 'on'
    const why = on ? `until ${percent ?? advancePercent(current) ?? DEFAULT_PERCENT}% of the weekly usage limit` : undefined
    let text = setLine(current, s, v, date, why)
    const also: string[] = []
    if (on)
      for (const [name, value] of s.turnsOn ?? []) {
        const t = SETTINGS.find(x => x.name === name)
        if (!t || currentValue(text, name) === value) continue
        text = setLine(text, t, value, date)
        also.push(name)
      }
    await $.fs.write(path, text)
    return { value: v, also }
  } catch {
    return { failed: `Couldn't update ${path}; nothing was changed.` }
  }
}

// The waiting queues an unnamed change left on another value, as a sentence
// (empty when none): a queue that copied these settings isn't left behind
// unseen.
export function keptBy(queues: Queue[], s: Setting, value: string) {
  const waiting = queues.filter(o => isWaiting(o, queues) && currentValue(o.text, s.name) !== value)
  if (waiting.length === 0) return ''
  return `Waiting ${waiting.length > 1 ? 'queues' : 'queue'} ${waiting.map(o => o.name).join(', ')} kept ${s.name} as it was; add the name to change ${waiting.length > 1 ? 'them' : 'it'} too.`
}

// `a`, `a and b`, `a, b, and c`.
export const list = (xs: readonly string[]) =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`

// The one queue a command acts on, or the reason there isn't one.
function oneQueue(queues: Queue[], named: string | undefined): Queue | string {
  const picked = pickQueues(queues, named)
  if (picked.length === 1) return picked[0]!
  if (queues.length === 0) return 'No open queue (queues/queue-<name>.md).'
  if (named !== undefined && picked.length > 1) return `More than one queue is named ${named}: ${picked.map(q => q.name).join(', ')}.`
  if (named !== undefined) return `No open queue named ${named}. Open: ${queues.map(q => q.name).join(', ')}.`
  return `Two or more queues are active; name one: ${picked.map(q => q.name).join(', ')}.`
}

// The `/queue` view of one queue; `waitsFor`, the open queue it waits for.
export function view(q: Queue, waitsFor?: Queue) {
  const open = rows(q.text).filter(isOpen)
  const next = nextRow(q.text)
  const lines = [`Queue ${q.name} · ${summary(settingsOf(q))}`]
  if (waitsFor) lines.push(`Waits for queue ${waitsFor.name}: next-session runs it once that queue closes`)
  else lines.push(next ? `next-session runs ${next.id} (${next.session}) on ${next.model || 'the current model'}` : 'next-session: no runnable row')
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
        description: s.description,
        argumentHint: `<${Object.keys(s.values).join('|')}${s.percent ? '|<n>%' : ''}> [queue]`,
      })
      .catch(() => undefined)
  }
}

// Answers the commands.
export function commands(on: On) {

  on('command.run', { command: 'queue' }, async ($, e) => {
    const queues = await openQueues($)
    const named = e.args.trim() || undefined
    // Unnamed, every open queue: the active ones first, then any waiting ones.
    const active = activeQueues(queues)
    const picked = named === undefined ? [...active, ...queues.filter(q => !active.includes(q))] : pickQueues(queues, named)
    if (picked.length === 0) {
      const r = oneQueue(queues, named)
      return { text: typeof r === 'string' ? r : view(r) }
    }
    return { text: picked.map(q => view(q, active.includes(q) ? undefined : waitedFor(q, queues))).join('\n\n') }
  })

  for (const s of SETTINGS) {
    on('command.run', { command: s.command }, async ($, e) => {
      const usage = `Usage: /${s.command} <${Object.keys(s.values).join('|')}${s.percent ? '|<n>%' : ''}> [queue]`
      const words = e.args.trim().split(/\s+/).filter(Boolean)
      // Own keys only: `in` would also take `constructor` and the like. A
      // percentage, where the setting takes one, means `on` until it.
      const isPercent = (w: string) => s.percent === true && /^\d{1,3}%?$/.test(w) && Number(w.replace('%', '')) >= 1 && Number(w.replace('%', '')) <= 100
      const pc = words.findIndex(isPercent)
      const percent = pc >= 0 ? Number(words[pc]!.replace('%', '')) : undefined
      // With a percentage, an `on` beside it is the same value (`on 70%`).
      const at = words.findIndex((w, i) => i !== pc && Object.hasOwn(s.values, w.toLowerCase()) && (pc < 0 || w.toLowerCase() === 'on'))
      const value = percent !== undefined ? 'on' : words[at]?.toLowerCase()
      // Only those words are the value, so a queue named `auto` still works.
      const rest = words.filter((_, i) => i !== at && i !== pc)
      if (value === undefined || rest.length > 1) return { text: usage }
      const queues = await openQueues($)
      const q = oneQueue(queues, rest[0])
      if (typeof q === 'string') return { text: q }
      const same = currentValue(q.text, s.name) === value && (percent === undefined || percent === q.autoAdvance)
      const needs = value === 'on' ? (s.turnsOn ?? []).filter(([n, v]) => currentValue(q.text, n) !== v) : []
      if (same && needs.length === 0) return { text: `Queue ${q.name}: ${s.name} is already ${value}.` }
      const written = await writeSetting($, q, s, value, percent)
      if ('failed' in written) return { text: written.failed }
      const until = s.percent && value === 'on' ? ` until ${percent ?? q.autoAdvance ?? DEFAULT_PERCENT}% of the weekly usage limit` : ''
      const also = written.also.length > 0 ? ` Also set ${list(written.also)} to auto.` : ''
      // Quiet: this reply reports the change, so no toast repeats it.
      await refresh($, { quiet: true }).catch(() => undefined)
      // Unnamed, only the active queue changed: say which waiting ones didn't,
      // so a queue that copied these settings isn't left behind unseen.
      const kept = rest.length === 0 ? keptBy(queues, s, value) : ''
      return { text: `Queue ${q.name}: ${s.name} set to ${value}${until}.${also}${kept ? ` ${kept}` : ''}` }
    })
  }
}
