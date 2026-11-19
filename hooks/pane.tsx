import type { EngineInterface, On } from 'claude-code'
import { PANE, paneQueuesNow } from './pane-state'
import { refresh } from './status'

// The live queue pane (`/queue-pane`): each open queue's open rows (id, name,
// status), the row `next-session` would run marked. It opens only from the
// command, never unasked. The rows sit in `$.state` (pane-state.ts), written by
// `refresh` in status.ts (session start, after each turn, after a settings
// command), so the pane redraws when the status line does.

export async function registerPaneCommand($: EngineInterface) {
  await $.command
    .register({ name: 'queue-pane', description: 'Show the open queue in a pane beside the chat, kept up to date' })
    .catch(() => undefined)
}

export function pane(on: On) {
  on('command.run', { command: 'queue-pane' }, async $ => {
    // Fresh rows first, so the pane doesn't open on stale ones.
    await refresh($).catch(() => undefined)
    // The open is refused when another plugin holds the id or a hook refuses it.
    const opened = await $.ui.open({ id: PANE, title: 'Queue' }).catch((err: unknown) => String(err))
    if (typeof opened === 'string') return { text: `Queue pane couldn't open: ${opened}` }
    return { text: opened.isPlaced ? 'Queue pane opened.' : `Queue pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await paneQueuesNow($)
    if (list.length === 0) return <Text dimColor>No open queue (queues/queue-&lt;name&gt;.md).</Text>
    const many = list.length > 1

    // A minimized pane on the desktop app: what `next-session` runs, at a glance.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          {list.map(q => {
            const next = q.rows.find(r => r.isNext)
            return (
              <Text>
                {many ? `${q.name}: ` : ''}
                {next ? `next ${next.id} ${next.session}` : 'no runnable row'}
              </Text>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.map(q => (
          <Box flexDirection="column" marginBottom={many ? 1 : 0}>
            {many && <Text bold>Queue {q.name}</Text>}
            {q.rows.length === 0 && <Text dimColor>No open rows.</Text>}
            {q.rows.map(r => (
              <Box flexDirection="column">
                <Text bold={r.isNext}>
                  {r.isNext ? '▶ ' : '  '}
                  {r.id} {r.session}
                </Text>
                <Text dimColor>    {r.status}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
