import type { EngineInterface } from 'claude-code'
import { setPaneQueues } from './pane-state'
import { openQueues, type Queue } from './queues'

// The line under the prompt: each open queue's Parallels setting, plus `auto go-ahead` and
// `auto-commit` when those settings are on, and the queue pane's rows
// (pane-state.ts). Refreshed by register.ts (session start, after each turn) and by
// the commands (commands.ts, pane.tsx).

const label = (q: Queue) =>
  [
    q.parallels === 'auto' ? `⚡ ${q.parallels}` : q.parallels,
    q.autoGoAhead ? 'auto go-ahead' : '',
    q.autoCommit ? 'auto-commit' : '',
  ].filter(Boolean)

export async function refresh($: EngineInterface) {
  const queues = await openQueues($)
  await setPaneQueues($, queues).catch(() => undefined)
  if (queues.length === 0) return $.ui.status(undefined)
  const labels = queues.map(q => label(q))
  $.ui.status(
    new Set(labels.map(l => l.join())).size === 1
      ? `parallels: ${labels[0]!.join(' · ')}`
      : queues.map((q, i) => `${q.name}: ${labels[i]!.join(', ')}`).join(' · '),
  )
}
