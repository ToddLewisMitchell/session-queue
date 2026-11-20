import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { QueueSettings } from '../types'
import { activeQueues, type Queue } from './queues'

// What the settings display (display.tsx) draws, kept in `$.state`: each
// active queue's settings, written by `refresh` in status.ts, and the Bash
// calls the commit guard let through because Commits is `auto` (guard.ts).
// Each atom's `read` and `update` stay in this file, beside it, so the engine
// can list the values the module keeps.

// Change a tag when its value's fields change: a reload keeps what the old
// code stored, and the tag declines it.
const settings = atom({ plugin: 'session-queue', key: 'settings' } as const, [], { shape: 'settings-1' })
const autoCommits = atom({ plugin: 'session-queue', key: 'autoCommits' } as const, [], { shape: 'auto-commits-1' })
// Enough for a long session's commits; older rows lose their note.
const AUTO_COMMITS_KEPT = 50

export const settingsOf = (q: Queue): QueueSettings => ({
  name: q.name,
  parallels: q.parallels,
  goAhead: q.autoGoAhead ? 'auto' : 'ask',
  commits: q.autoCommit ? 'auto' : 'approve',
  clear: q.clear ? 'auto' : 'off',
  notify: q.notify ? 'on' : 'off',
})

// The settings shown, by the queue line's name, in the template's order.
export const SHOWN = [
  ['Parallels', 'parallels'],
  ['Go-ahead', 'goAhead'],
  ['Commits', 'commits'],
  ['Clear', 'clear'],
  ['Notify', 'notify'],
] as const

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
// Commits is `auto`.
export async function noteAutoCommit($: EngineInterface, toolUseId: string) {
  await update($, autoCommits, ids => [...ids.filter(id => id !== toolUseId), toolUseId].slice(-AUTO_COMMITS_KEPT))
}

// Whether the guard let this call through because Commits is `auto`.
export async function isAutoCommit($: EngineInterface, toolUseId: string) {
  return (await read($, autoCommits)).includes(toolUseId)
}
