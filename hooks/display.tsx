import type { On } from 'claude-code'
import type { QueueSettings } from '../types'
import { gitActions } from './guard'
import { isAutoCommit, settingsNow, summary } from './settings-state'

// The settings shown beside the chat, from the values `refresh` (status.ts)
// keeps in `$.state`:
// - In the prompt footer's mode labels (`SessionMode`, terminal and desktop):
//   every setting of each active queue, `queue · parallels: ask · auto-start:
//   on · …`, so the user always knows how much runs without asking them
//   (a separator after `queue`, so each setting keeps its own colon).
// - On the phone, where the footer isn't drawn, the same at the end of the
//   hint line under the prompt (`PromptHint`).
// - Under a Bash row that committed or merged because Auto-commit is `on` (the
//   commit guard records it), one dim line saying so.
// The toast on a change is `refresh`'s.

// The labels for the active queues: one when they all read the same, else
// one per queue, by name.
export function footerLabels(list: readonly QueueSettings[]): string[] {
  if (list.length === 0) return []
  const each = list.map(summary)
  if (new Set(each).size === 1) return [`queue · ${each[0]}`]
  return list.map((s, i) => `queue ${s.name} · ${each[i]}`)
}

function commandOf(input: unknown) {
  const command = (input as { command?: unknown } | null)?.command
  return typeof command === 'string' ? command : ''
}

export function display(on: On) {
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const labels = footerLabels(await settingsNow($))
    if (labels.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...labels] } })
  })

  // Only on the phone: elsewhere the footer shows them. `tail` isn't drawn
  // there yet, so the line is rewritten with the labels added at its end.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'mobile') return next(e)
    const labels = footerLabels(await settingsNow($))
    if (labels.length === 0) return next(e)
    const hint = [e.props.hint, ...labels].filter(Boolean).join(' · ')
    return next({ ...e, props: { ...e.props, hint } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'Bash' || p.isRunning || p.isErrored || p.isInterrupted) return next(e)
    if (!(await isAutoCommit($, p.tool_use_id))) return next(e)
    // Named by what the guard let through, not by what git did (a `git pull`
    // may have had nothing to merge).
    const actions = gitActions(commandOf(p.input))
    const what = actions.has('commit') && actions.has('merge') ? 'commit and merge' : actions.has('merge') ? 'merge' : 'commit'
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>  {what} allowed without the queue asking (auto-commit: on)</Text>
      </Box>
    )
  })
}
