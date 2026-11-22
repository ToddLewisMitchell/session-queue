import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { QueueSettings } from '../types'
import { activeQueues, type Queue } from './queues'

// What the settings display (display.tsx) draws, kept in `$.state`: each
// active queue's settings, written by `refresh` in status.ts, and the Bash
// calls the commit guard let through because Auto-commit is `on` (guard.ts).
// Each atom's `read` and `update` stay in this file, beside it, so the engine
// can list the values the module keeps.

// Change a tag when its value's fields change: a reload keeps what the old
// code stored, and the tag declines it.
const settings = atom({ plugin: 'session-queue', key: 'settings' } as const, [], { shape: 'settings-5' })
const autoCommits = atom({ plugin: 'session-queue', key: 'autoCommits' } as const, [], { shape: 'auto-commits-1' })
// Enough for a long session's commits; older rows lose their note.
const AUTO_COMMITS_KEPT = 50

export const settingsOf = (q: Queue): QueueSettings => ({
  name: q.name,
  parallels: q.parallels,
  autoStart: q.autoStart ? 'on' : 'off',
  autoCommit: q.autoCommit ? 'on' : 'off',
  clear: q.clear ? 'on' : 'off',
  notify: q.notify ? 'on' : 'off',
  autoAdvance: q.autoAdvance === undefined ? 'off' : `${q.autoAdvance}%`,
})

// The settings shown, by the queue line's name, in the template's order.
export const SHOWN = [
  ['Parallels', 'parallels'],
  ['Auto-start', 'autoStart'],
  ['Auto-commit', 'autoCommit'],
  ['Clear', 'clear'],
  ['Auto-advance', 'autoAdvance'],
  ['Notify', 'notify'],
] as const

// Every setting as `name: value`, joined by ` · `: the prompt footer's text
// (display.tsx) and `/queue`'s settings line (commands.ts), so the two read
// the same. Clear reads as `auto-clear` there, after its command.
const LABEL: Partial<Record<keyof QueueSettings, string>> = { clear: 'auto-clear' }
export const summary = (s: QueueSettings) =>
  SHOWN.map(([name, key]) => `${LABEL[key] ?? name.toLowerCase()}: ${key === 'autoAdvance' && s[key] !== 'off' ? `until ${s[key]} weekly` : s[key]}`).join(' · ')

// What changed between two reads of the same queues, as toast lines
// ("Parallels → auto"). A queue new to the list (the first read, a queue just
// opened or no longer waiting) isn't a change.
export function changes(before: readonly QueueSettings[], after: readonly QueueSettings[]) {
  const many = after.length > 1
  const out: string[] = []
  for (const q of after) {
    const old = before.find(o => o.name === q.name)
    if (!old) continue
    for (const [name, key] of SHOWN)
      if (old[key] !== q[key]) out.push(`${many ? `${q.name}: ` : ''}${name} → ${q[key]}`)
  }
  return out
}

// Writes the active queues' settings, which redraws the footer and the pane,
// and returns what changed since the last write.
export async function setSettings($: EngineInterface, open: Queue[]) {
  const now = activeQueues(open).map(settingsOf)
  const found = changes(await read($, settings), now)
  await update($, settings, () => now)
  return found
}

// The settings, while drawing: the read redraws the reader when they change.
export async function settingsNow($: EngineInterface) {
  return read($, settings)
}

// Called by the commit guard for a commit or merge it let through because
// Auto-commit is `on`.
export async function noteAutoCommit($: EngineInterface, toolUseId: string) {
  await update($, autoCommits, ids => [...ids.filter(id => id !== toolUseId), toolUseId].slice(-AUTO_COMMITS_KEPT))
}

// Whether the guard let this call through because Auto-commit is `on`.
export async function isAutoCommit($: EngineInterface, toolUseId: string) {
  return (await read($, autoCommits)).includes(toolUseId)
}
