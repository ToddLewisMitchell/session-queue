import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit } from 'claude-code'
import { activeQueues, nextRowOf, openQueues, rows, type Queue, type Row } from './queues'

// Auto-advance (the queue line `**Auto-advance.** on: until <P>% of the weekly
// usage limit`, off by default): when a session's row goes DONE, type
// `next-session` for the user, after a 15-second toast they can cancel by
// typing in the prompt box. register.ts sends it through the same clear as a
// typed `next-session`.
//
// It goes on only when nothing needs the user, and otherwise says in a toast
// why it stopped:
// - Auto-start, Auto-commit, and Clear are `on` (turning auto-advance on with
//   its command turns them on; turning one off later stops it);
// - this conversation ran `next-session` (typed, or auto-advance's own), a
//   row went DONE since then, and no row is IN PROGRESS (a session that
//   paused, asked, or stopped for approval leaves its row unfinished, so the
//   loop stops there by itself; a row another conversation finishes doesn't
//   clear this one unless it is running a queue session too);
// - the next row isn't PAUSED (resuming asks about its blocker), doesn't start
//   with its discussion, and runs on the current model;
// - the weekly window (`seven_day`) is under the queue's percentage, and the
//   five-hour window under 90%, so a session doesn't start only to hit a
//   limit halfway. With no weekly reading (API-key billing, or no reply yet),
//   it stops rather than guess.
//
// When the countdown ends while a background agent of this conversation is
// still at work, or the turn reading an agent's report is running, it waits
// rather than stop: the clear would lose the report, so it checks again every
// POLL_MS, for up to WAIT_MAX_MS, and still cancels when the user types or
// sends a prompt (a background task's notification isn't one).

const FIVE_HOUR_MAX = 90
export const DELAY_MS = 15_000
export const POLL_MS = 15_000
export const WAIT_MAX_MS = 30 * 60_000

// Agents whose report would be lost if the conversation were cleared.
const BUSY = new Set(['pending', 'running', 'waiting'])

// How many of the session's agents are still at work; undefined on a failure
// to read (then the clear's own check refuses).
export async function busyAgents($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.agent.list()).filter(a => BUSY.has(a.status)).length
  } catch {
    return undefined
  }
}

// Whether a main-loop turn is running that a background task's notification
// started (register.ts): the agent's report being read. The wait goes on until
// it ends, so the clear doesn't cut it off. A module variable, like `pending`.
// Returns whether one was running.
let notificationTurn = false
export function noteNotificationTurn(open: boolean) {
  const was = notificationTurn
  notificationTurn = open
  return was
}

const DONE = /^DONE\b/i
export const doneIds = (text: string) => rows(text).filter(r => DONE.test(r.status)).map(r => r.id)

export type Decision = { advance: Row } | { stop: string } | undefined

// Whether queue `q`, with the DONE rows `before` it had when this
// conversation's `next-session` was sent, goes on to its next row now. Undefined: nothing to do or say (no
// row finished, or auto-advance is off).
export function decide(q: Queue, before: readonly string[] | undefined, limits: readonly SessionRateLimit[], model: string): Decision {
  const percent = q.autoAdvance
  if (percent === undefined || before === undefined) return undefined
  if (!doneIds(q.text).some(id => !before.includes(id))) return undefined
  if (!q.autoStart || !q.autoCommit || !q.clear) return { stop: 'Auto-start, Auto-commit, and Clear must be on' }
  const all = rows(q.text)
  const running = all.find(r => /^IN PROGRESS\b/i.test(r.status))
  if (running) return { stop: `${running.id} is still in progress` }
  const next = nextRowOf(all)
  if (!next) return { stop: 'no session left to run' }
  const name = `${next.id} (${short(next.session)})`
  if (/^PAUSED\b/i.test(next.status)) return { stop: `${name} is paused; resume it yourself` }
  if (/starts with its discussion/i.test(next.session)) return { stop: `${name} starts with its discussion` }
  if (next.model && !model.toLowerCase().includes(next.model.toLowerCase()))
    return { stop: `${name} runs on ${next.model}; switch with /model` }
  const weekly = limits.find(l => l.kind === 'seven_day')
  if (!weekly) return { stop: 'no weekly usage reading' }
  if (weekly.percentUsed >= percent) return { stop: `weekly usage is at ${weekly.percentUsed}% (limit set: ${percent}%)` }
  const fiveHour = limits.find(l => l.kind === 'five_hour')
  if (fiveHour && fiveHour.percentUsed >= FIVE_HOUR_MAX) return { stop: `five-hour usage is at ${fiveHour.percentUsed}%` }
  return { advance: next }
}

// A session's name for a toast: up to its first `.`, `+`, or 40 characters.
export function short(session: string) {
  const s = session.split(/[.+]/)[0]!.trim()
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

// Each open queue's DONE rows when this conversation sent `next-session`,
// kept in `$.state` so a hot reload doesn't lose them. Absent: this
// conversation isn't running a queue session, so nothing advances.
const doneSeen = atom({ plugin: 'session-queue', key: 'doneSeen' } as const, null, { shape: 'done-seen-2' })

// Takes the baseline: when `next-session` is sent in this conversation
// (register.ts). `undefined` drops it (a fresh conversation, or a decision
// made).
export async function noteNextSession($: EngineInterface, queues?: Queue[] | null) {
  const open = queues === null ? null : (queues ?? (await openQueues($)))
  await update($, doneSeen, () => (open === null ? null : Object.fromEntries(open.map(q => [q.name, doneIds(q.text)]))))
}

// The pending advance, if any: cancelled by the user typing or sending a
// prompt (`cancelAdvance`), checked again when its timer fires. A module
// variable: a hot reload drops it, and the advance with it.
// `waitingSince`: when it began waiting for a background agent.
let pending: { gen: number; text: string; queue: string; row: string; before: readonly string[]; waitingSince?: number } | undefined
let gen = 0

export function cancelAdvance($: EngineInterface, why: string) {
  if (!pending) return
  pending = undefined
  $.ui.toast(`session-queue: auto-advance cancelled (${why}).`)
}

// After a main-loop turn that ended with an answer: decide for each active
// queue with auto-advance on. The first that advances wins; with none, the
// stops are shown. Either way the baseline is dropped, so a decision is made
// once per next-session. `submit` sends the `next-session` (register.ts's
// own path, so it clears first).
export async function afterTurn($: EngineInterface, submit: (text: string) => Promise<unknown>) {
  const before = await read($, doneSeen)
  if (before === null) return
  const open = await openQueues($)
  const active = activeQueues(open)
  const on = active.filter(q => q.autoAdvance !== undefined && Object.hasOwn(before, q.name))
  if (on.length === 0) return
  const [usage, model] = await Promise.all([$.session.usage().catch(() => undefined), $.session.model().catch(() => '')])
  const stops: string[] = []
  let go: { q: Queue; row: Row } | undefined
  for (const q of on) {
    const d = decide(q, before[q.name], usage?.rateLimits ?? [], model)
    if (d && 'advance' in d) {
      go = { q, row: d.advance }
      break
    }
    if (d) stops.push(on.length > 1 ? `${q.name}: ${d.stop}` : d.stop)
  }
  // Nothing finished yet: the session goes on, the baseline stays.
  if (!go && stops.length === 0) return
  await noteNextSession($, null)
  if (!go) return $.ui.toast(`session-queue: auto-advance stopped: ${stops.join('; ')}.`)
  const { q, row } = go
  const text = active.length > 1 ? `next-session ${q.name}` : 'next-session'
  const mine = { gen: ++gen, text, queue: q.name, row: row.id, before: before[q.name] ?? [] }
  pending = mine
  $.ui.toast(`session-queue: auto-advance runs ${row.id} (${short(row.session)}) in ${DELAY_MS / 1000}s; type in the prompt box to cancel.`)
  $.clock.after(DELAY_MS, () => void fire($, mine, submit))
}

// What a wait is for, in a toast.
function waitingFor(busy: number | undefined) {
  if (busy === undefined) return 'the background agents (their list can’t be read)'
  if (busy === 0) return 'the agent’s report'
  return busy === 1 ? 'a background agent' : `${busy} background agents`
}

// The timer's end: still pending, the box still empty, and `decide` still
// advancing to the same row (a setting changed since, a new claim, or
// the usage since is seen). With a background agent still at work, it stays
// pending and looks again in POLL_MS, until WAIT_MAX_MS.
async function fire($: EngineInterface, mine: NonNullable<typeof pending>, submit: (text: string) => Promise<unknown>) {
  if (pending?.gen !== mine.gen) return
  // Superseded or cancelled meanwhile (the user typed): no second toast.
  const stop = (text: string) => {
    if (pending?.gen !== mine.gen) return
    pending = undefined
    $.ui.toast(text)
  }
  try {
    const box = await $.prompt.read().catch(() => ({ text: '' }))
    if (box.text.trim() !== '') return stop('session-queue: auto-advance cancelled (the prompt box has text).')
    const q = (await openQueues($)).find(o => o.name === mine.queue)
    const [usage, model] = await Promise.all([$.session.usage().catch(() => undefined), $.session.model().catch(() => '')])
    const d = q ? decide(q, mine.before, usage?.rateLimits ?? [], model) : undefined
    if (!d || !('advance' in d) || d.advance.id !== mine.row)
      return stop(`session-queue: auto-advance cancelled (${d && 'stop' in d ? d.stop : 'the queue changed'}).`)
    const busy = await busyAgents($)
    // Cancelled while reading (the user typed): nothing more to do.
    if (pending?.gen !== mine.gen) return
    // An agent list that can't be read counts as busy: look again.
    if (busy !== 0 || notificationTurn) {
      const now = await $.clock.now()
      if (mine.waitingSince === undefined) {
        mine.waitingSince = now
        $.ui.toast(
          `session-queue: auto-advance waits for ${waitingFor(busy)} to finish, then runs ${mine.row}; type in the prompt box to cancel.`,
        )
      } else if (now - mine.waitingSince >= WAIT_MAX_MS)
        return stop(`session-queue: auto-advance stopped: still waiting for ${waitingFor(busy)} after ${WAIT_MAX_MS / 60_000} minutes.`)
      $.clock.after(POLL_MS, () => void fire($, mine, submit))
      return
    }
    pending = undefined
    await submit(mine.text)
  } catch {
    stop('session-queue: auto-advance couldn’t send next-session.')
  }
}
