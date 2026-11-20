import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { PaneQueue } from '../types'
import { activeQueues, isOpen, nextRowOf, rows, type Queue } from './queues'

// What the queue pane (pane.tsx) draws, kept in `$.state`: written by `refresh`
// in status.ts, read by the pane. A file of its own so status.ts and pane.tsx
// don't import each other. The engine lists the values a module keeps by
// reading each `read` and `update` beside its atom, so both stay in this file.

export const PANE = 'session-queue'
// Change the tag when PaneQueue's fields change: a reload keeps what the old
// code stored, and the tag declines it.
const queues = atom({ plugin: 'session-queue', key: 'queues' } as const, [], { shape: 'queues-2' })

// The pane's rows for the active queues (a queue waiting for another doesn't
// run yet, so it isn't shown).
export function paneQueues(open: Queue[]): PaneQueue[] {
  return activeQueues(open).map(q => {
    const all = rows(q.text)
    // By identity, so a second row with the same id isn't marked too.
    const next = nextRowOf(all)
    return {
      name: q.name,
      rows: all
        .filter(isOpen)
        .map(r => ({ id: r.id, session: r.session, status: r.status, isNext: r === next, isRunning: /^IN PROGRESS\b/i.test(r.status) })),
    }
  })
}

// Writes the rows, which redraws the pane if it's open.
export async function setPaneQueues($: EngineInterface, open: Queue[]) {
  await update($, queues, () => paneQueues(open))
}

// The rows, while drawing: the read makes the pane redraw when they change.
export async function paneQueuesNow($: EngineInterface) {
  return read($, queues)
}
