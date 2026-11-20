import type { EngineInterface } from 'claude-code'
import { setPaneQueues } from './pane-state'
import { openQueues } from './queues'
import { setSettings } from './settings-state'

// Re-reads the open queues into `$.state`: the queue pane's rows
// (pane-state.ts) and the active queues' settings (settings-state.ts), which
// redraws the pane and the settings in the prompt footer (display.tsx).
// Called by register.ts (session start, after each turn) and by the commands
// (commands.ts, pane.tsx, the pane's settings buttons). A settings change since
// the last read, a hand edit included, shows as a toast, unless `quiet`: a
// slash command reports its own change.

// Whether this load of the module has cleared the status-line entry an older
// version set (the footer has the settings now). A module variable, so the
// first refresh after a hot reload clears it too.
let statusCleared = false

export async function refresh($: EngineInterface, opts: { quiet?: boolean } = {}) {
  if (!statusCleared) {
    statusCleared = true
    try {
      $.ui.status(undefined)
    } catch {}
  }
  const open = await openQueues($)
  await setPaneQueues($, open).catch(() => undefined)
  const changed = await setSettings($, open).catch(() => [])
  if (changed.length > 0 && !opts.quiet) $.ui.toast(changed.join(' · '))
}
