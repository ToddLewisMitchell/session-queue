import type { EngineInterface, Register } from 'claude-code'
import { guard } from './guard'
import { openQueues, type Queue } from './queues'

// Three jobs, all read from the open queue files:
// - Under the prompt: each open queue's Pace, plus `auto go-ahead` and
//   `auto-commit` when those settings are on, so the user always knows how
//   much runs without asking them. Re-read when the session starts and after
//   every turn, so a change shows as soon as the turn that made it ends.
// - Clear: when the user types `next-session` in a conversation that already
//   has messages, run `/clear` first and then `next-session` in the fresh
//   conversation, unless the queue's Clear line is `off`.
// - The commit guard (`guard.ts`): commits, merges, and pushes ask first, as
//   the Commits setting says.

// `next-session`, optionally followed by a queue name, and nothing else.
const NEXT = /^\s*next-session(?:\s+([\w-]+))?\s*$/
// Agents whose report would be lost if the conversation were cleared.
const BUSY = new Set(['pending', 'running', 'waiting'])

const label = (q: Queue) =>
  [
    q.pace === 'speed' ? `⚡ ${q.pace}` : q.pace,
    q.autoGoAhead ? 'auto go-ahead' : '',
    q.autoCommit ? 'auto-commit' : '',
  ].filter(Boolean)

async function refresh($: EngineInterface) {
  const queues = await openQueues($)
  if (queues.length === 0) return $.ui.status(undefined)
  const labels = queues.map(q => label(q))
  $.ui.status(
    new Set(labels.map(l => l.join())).size === 1
      ? `pace: ${labels[0]!.join(' · ')}`
      : queues.map((q, i) => `${q.name}: ${labels[i]!.join(', ')}`).join(' · '),
  )
}

// Whether to clear before this `next-session`: the queue it names (or, unnamed,
// every open queue) has Clear on, the conversation has messages, and no
// background agent of this conversation is still at work.
async function shouldClear($: EngineInterface, named: string | undefined) {
  const queues = await openQueues($)
  const picked = named === undefined ? queues : queues.filter(q => q.name === named)
  if (picked.length === 0 || !picked.every(q => q.clear)) return false
  const last = await $.session.messages({ last: 1 })
  if ('deny' in last || last.length === 0) return false
  return !(await $.agent.list()).some(a => BUSY.has(a.status))
}

export const register: Register = on => {
  guard(on)

  on('session.start', async ($, e, next) => {
    const done = await next(e)
    await refresh($).catch(() => undefined)
    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refresh($).catch(() => undefined)
    return done
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the user's own typing (terminal or phone), between turns.
    const m = NEXT.exec(e.text)
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!m || !typed || e.command || e.isMeta || e.turnId !== undefined) return next(e)
    if (!(await shouldClear($, m[1]).catch(() => false))) return next(e)
    const text = e.text.trim()
    // The clear and the resubmit outlive this dispatch, so they run on a timer.
    $.clock.after(0, () => {
      void $.command
        .run({ command: 'clear' })
        .catch(() => $.ui.toast('session-queue: couldn’t clear; running next-session here'))
        .then(() => $.prompt.submit({ text }))
    })
    return { drop: `Clearing the conversation, then running ${text}` }
  })
}
