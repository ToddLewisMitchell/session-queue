import type { EngineInterface, Register } from 'claude-code'

// Shows each open queue's Pace under the prompt, so the user always knows
// whether `speed` (every eligible row runs in parallel) is on. It re-reads the
// queue files when the session starts and after every turn, so a Pace change
// shows up as soon as the turn that made it ends.

const QUEUE = /^prompt(.+)\.md$/
const PACE = /^\*\*Pace\.\*\*\s*(economy|balanced|speed)\b/m
// A closed queue says "closed ... a record only"; a successor quotes its
// predecessor the same way on its "Successor to" line, so that line is skipped.
const CLOSED = /\bclosed\b[^\n]*\brecord only\b/i

type Pace = 'economy' | 'balanced' | 'speed'

const label = (pace: Pace) => (pace === 'speed' ? `⚡ ${pace}` : pace)

async function openQueues($: EngineInterface) {
  let entries
  try {
    entries = await $.fs.list('prompts')
  } catch {
    return []
  }
  const queues: { name: string; pace: Pace }[] = []
  for (const entry of entries) {
    const m = entry.kind === 'file' ? QUEUE.exec(entry.name) : null
    if (!m) continue
    let text: string
    try {
      text = await $.fs.read(`prompts/${entry.name}`)
    } catch {
      continue
    }
    if (CLOSED.test(text.replace(/^.*Successor to.*$/gm, ''))) continue
    queues.push({ name: m[1] ?? '', pace: (PACE.exec(text)?.[1] as Pace) ?? 'balanced' })
  }
  return queues
}

async function refresh($: EngineInterface) {
  const queues = await openQueues($)
  if (queues.length === 0) return $.ui.status(undefined)
  const paces = new Set(queues.map(q => q.pace))
  $.ui.status(
    paces.size === 1
      ? `mode: ${label([...paces][0] as Pace)}`
      : queues.map(q => `${q.name}: ${label(q.pace)}`).join(' · '),
  )
}

export const register: Register = on => {
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
}
