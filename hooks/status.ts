import type { EngineInterface } from 'claude-code'
import { openQueues, type Queue } from './queues'

// The line under the prompt: each open queue's Pace, plus `auto go-ahead` and
// `auto-commit` when those settings are on. Refreshed by register.ts (session
// start, after each turn) and by the settings commands (commands.ts).

const label = (q: Queue) =>
  [
    q.pace === 'speed' ? `⚡ ${q.pace}` : q.pace,
    q.autoGoAhead ? 'auto go-ahead' : '',
    q.autoCommit ? 'auto-commit' : '',
  ].filter(Boolean)

export async function refresh($: EngineInterface) {
  const queues = await openQueues($)
  if (queues.length === 0) return $.ui.status(undefined)
  const labels = queues.map(q => label(q))
  $.ui.status(
    new Set(labels.map(l => l.join())).size === 1
      ? `pace: ${labels[0]!.join(' · ')}`
      : queues.map((q, i) => `${q.name}: ${labels[i]!.join(', ')}`).join(' · '),
  )
}
