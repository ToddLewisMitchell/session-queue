import type { EngineInterface, Register } from 'claude-code'
import { afterTurn, cancelAdvance, noteNextSession } from './advance'
import { commands, registerCommands } from './commands'
import { queueContext } from './context'
import { display } from './display'
import { guard, notePrompt } from './guard'
import { pane, registerPaneCommand } from './pane'
import { openQueues, pickQueues } from './queues'
import { refresh } from './status'

// Seven jobs, all read from the open queue files. Unnamed, `next-session` and
// the commands mean the active queues: those not waiting for another open one
// (`activeQueues` in queues.ts).
// - The settings display (`display.tsx`): each active queue's settings in the
//   prompt footer, a note on auto commits, and a toast on a change. Re-read
//   when the session starts and after every turn (`refresh`), so a change
//   shows as soon as the turn that made it ends.
// - Clear: when the user types `next-session` in a conversation that already
//   has messages, run `/clear` first and then `next-session` in the fresh
//   conversation, unless the queue's Clear line is `off`.
// - Context: attach the queue file and the next row's topic file to
//   `next-session` (`context.ts`), so the session doesn't spend tool calls
//   reading them.
// - The commit guard (`guard.ts`): commits, merges, and pushes ask first, as
//   the Auto-commit setting says, unless the user's latest message approved the
//   commit (`notePrompt`, fed every prompt below).
// - Slash commands (`commands.ts`): `/queue` shows the queue,
//   `/queue-<setting>` changes one settings line, and `/queue-remove` deletes
//   a row and its topic file, with no model turn.
// - The queue pane (`pane.tsx`): `/queue-pane` opens a pane of the open rows,
//   redrawn on every refresh (the settings are under the prompt).
// - Auto-advance (`advance.ts`): when a session's row goes DONE and the queue's
//   Auto-advance line is on, type `next-session` for the user after a
//   cancellable delay, through the same clear as their own typing.

// `next-session`, optionally followed by a queue name, and nothing else, in
// any case (`Next-session` too).
const NEXT = /^\s*next-session(?:\s+([\w.-]+))?\s*$/i
// Agents whose report would be lost if the conversation were cleared.
const BUSY = new Set(['pending', 'running', 'waiting'])

// Whether to clear before this `next-session`: the queue it names (or, unnamed,
// every active queue) has Clear on, the conversation has messages, and no
// background agent of this conversation is still at work.
async function shouldClear($: EngineInterface, named: string | undefined) {
  const picked = pickQueues(await openQueues($), named)
  if (picked.length === 0 || !picked.every(q => q.clear)) return false
  const last = await $.session.messages({ last: 1 })
  if ('deny' in last || last.length === 0) return false
  return !(await $.agent.list()).some(a => BUSY.has(a.status))
}

// The engine hands a dropped prompt back to the box as a draft; once the
// clear has run, the `next-session` it held is on its way as the resubmit, so
// empty the box, but only while it still reads just that (never a new draft).
// Never throws: a box left full mustn't read as a failed clear.
// Says whether it emptied the box, so the watch below stands down once the
// draft has come back and gone.
async function emptyBox($: EngineInterface, text: string) {
  try {
    const box = await $.prompt.read()
    if (box.text.trim() !== text) return false
    await $.prompt.fill({ text: '' })
    if (watchBox?.text === text) watchBox = undefined
    return true
  } catch {
    return false
  }
}

// After a clear before `next-session`: the text the box must not be left
// holding, until when. The engine may hand the dropped prompt back to the box
// after both of the timer's checks have run (seen live on 2026-11-20), so
// `prompt.change` empties it whenever it comes back within the window.
let watchBox: { text: string; until: number } | undefined
const WATCH_BOX_MS = 30_000

// Set while a clear before `next-session` runs: the queue it names, for the
// fresh conversation's context blocks. Good for a short window only, so a
// resubmit that never arrives can't leave it for some later conversation.
let cleared: { named: string | undefined; at: number } | undefined
const CLEARED_FOR_MS = 60_000


// Runs `/clear`, then `text` in the fresh conversation, whose context blocks
// carry the queue files (the `prompt.context` hook below): the resubmit
// doesn't come back through this plugin's own `prompt.submit` hook (the engine
// skips the hook a call came from, and the timer counts as this one).
// `dropped`: the user's typed prompt was dropped, so the engine may hand it
// back to the box as a draft, to be emptied.
async function clearThenRun($: EngineInterface, text: string, named: string | undefined, dropped: boolean) {
  const at = await $.clock.now()
  cleared = { named, at }
  if (dropped) watchBox = { text, until: at + WATCH_BOX_MS }
  // The clear and the resubmit outlive this dispatch, so they run on a timer.
  $.clock.after(0, () => {
    void $.command
      .run({ command: 'clear' })
      .catch(() => {
        cleared = undefined // no fresh conversation: no context blocks
        watchBox = undefined // and no dropped draft to watch for
        $.ui.toast('session-queue: couldn’t clear; running next-session here')
      })
      .then(() => dropped && emptyBox($, text))
      .then(() => $.prompt.submit({ text }))
      // Again once it's in, in case the box got the draft back late.
      .then(() => dropped && emptyBox($, text))
  })
}

// Auto-advance's `next-session` (advance.ts), always in a fresh conversation:
// where the clear would be skipped (a background agent still at work), it
// stops instead of running the next session on top of this one.
async function advance($: EngineInterface, text: string) {
  const named = NEXT.exec(text)?.[1]
  if (await shouldClear($, named).catch(() => false)) return clearThenRun($, text, named, false)
  $.ui.toast('session-queue: auto-advance stopped: the conversation can’t be cleared (Clear is off, or a background agent is still running).')
}

export const register: Register = on => {
  guard(on)
  commands(on)
  pane(on)
  display(on)

  // The first message after the clear carries the queue files as a context
  // block of their own.
  on('prompt.context', async ($, e, next) => {
    const done = await next(e)
    const pending = cleared
    cleared = undefined
    if (!pending || (await $.clock.now()) - pending.at > CLEARED_FOR_MS) return done
    // The fresh conversation runs a queue session: auto-advance's baseline.
    await noteNextSession($).catch(() => undefined)
    const text = await queueContext($, pending.named).catch(() => undefined)
    return text === undefined ? done : { ...done, blocks: [...done.blocks, { name: 'sessionQueue', text }] }
  })

  // The dropped `next-session` coming back to the box, emptied once, on a
  // timer so the fill doesn't run inside this event. Only the engine's own
  // writes count (a kind not known here is the engine's): a plugin's fill, or
  // the user's history recall or undo, puts it there on purpose.
  on('prompt.change', async ($, e, next) => {
    const done = await next(e)
    const w = watchBox
    const deliberate = e.origin.kind === 'plugin' || e.origin.kind === 'history' || e.origin.kind === 'undo'
    if (w && !deliberate && e.text.trim() === w.text) {
      if ((await $.clock.now()) > w.until) watchBox = undefined
      else {
        watchBox = undefined
        $.clock.after(0, () => void emptyBox($, w.text))
      }
    }
    return done
  })

  on('session.start', async ($, e, next) => {
    await notePrompt($, undefined) // a fresh conversation holds no approval
    const done = await next(e)
    await refresh($).catch(() => undefined)
    // A fresh conversation (a new session, or after a clear) runs no queue
    // session yet; a reload mid-conversation keeps auto-advance's baseline.
    const last = await $.session.messages({ last: 1 }).catch(() => [])
    if (!('deny' in last) && last.length === 0) await noteNextSession($, null).catch(() => undefined)
    // On an engine without the command API, the session still starts.
    await registerCommands($).catch(() => undefined)
    await registerPaneCommand($).catch(() => undefined)
    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    await refresh($).catch(() => undefined)
    // Only a turn that ended with an answer: an interrupt, a refusal, or an
    // error is the user's to look at.
    if (e.reason === 'answer') await afterTurn($, text => advance($, text)).catch(() => undefined)
    return done
  })

  // The user typing in the box cancels a pending auto-advance.
  // A bare cursor move doesn't count.
  on('prompt.edit', async ($, e, next) => {
    if (e.inputText !== '' || e.start !== e.end) cancelAdvance($, 'you typed in the prompt box')
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await notePrompt($, e)
    // A prompt the user sends cancels a pending auto-advance (this plugin's
    // own resubmit doesn't come through here).
    if (e.origin.kind !== 'plugin') cancelAdvance($, 'a prompt was sent')
    // `next-session` alone, between turns (not a /command, a meta prompt, or a
    // prompt queued into a running turn).
    const m = NEXT.exec(e.text)
    if (!m || e.command || e.isMeta || e.turnId !== undefined) return next(e)
    // Clear first only for the user's own typing (terminal or phone);
    // auto-advance clears for itself (`advance`).
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (typed && (await shouldClear($, m[1]).catch(() => false))) {
      const text = e.text.trim()
      await clearThenRun($, text, m[1], true)
      return { drop: `Clearing the conversation, then running ${text}` }
    }
    // Run here, not cleared: auto-advance's baseline.
    await noteNextSession($).catch(() => undefined)
    // This plugin's own resubmit after a clear, should the engine pass it
    // through here: the `prompt.context` block carries the files.
    if (e.origin.kind === 'plugin' && e.origin.name === 'session-queue') return next(e)
    // Any other origin gets the queue files attached too: another plugin's or
    // the SDK's `next-session`.
    const context = await queueContext($, m[1]).catch(() => undefined)
    return next(context === undefined ? e : { ...e, context: [...(e.context ?? []), context] })
  })
}
