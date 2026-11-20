import type { EngineInterface, On } from 'claude-code'
import type { QueueSettings } from '../types'
import { keptBy, SETTINGS, writeSetting } from './commands'
import { PANE, paneQueuesNow } from './pane-state'
import { openQueues } from './queues'
import { SHOWN, settingsNow, settingsOf } from './settings-state'
import { refresh } from './status'

// The live queue pane (`/queue-pane`): each active queue's open rows (id, name,
// status), the running ones marked ● and the row `next-session` would run ▶.
// The running row is in bold, else the next one, so the session at work stands
// out over the one that comes after it. It opens only from the
// command, never unasked. The rows sit in `$.state` (pane-state.ts), written by
// `refresh` in status.ts (session start, after each turn, after a settings
// command), so the pane redraws whenever they're re-read. Above each queue's
// rows, a button per setting moves it to its next value (`toggle`).

export async function registerPaneCommand($: EngineInterface) {
  await $.command
    .register({ name: 'queue-pane', description: 'Show the open queue in a pane beside the chat, kept up to date' })
    .catch(() => undefined)
}

// Moves one setting of a queue to its next value, in the order its command
// lists them (Parallels: off, ask, auto, then off again), through the same
// writer as `/queue-<setting>`, stepping on from the value in the text it
// re-reads. Presses run one after another (`pressing`), so two quick presses
// move it two steps. The toast that `refresh` shows for a change confirms it;
// a failure, or a waiting queue that kept the old value (as the command says),
// gets a toast of its own.
let pressing: Promise<unknown> = Promise.resolve()
function toggle($: EngineInterface, queue: string, name: string) {
  pressing = pressing.then(() => step($, queue, name)).catch(() => undefined)
  return pressing
}

async function step($: EngineInterface, queue: string, name: string) {
  const s = SETTINGS.find(x => x.name === name)
  const key = SHOWN.find(([n]) => n === name)?.[1]
  const queues = await openQueues($)
  const q = queues.find(o => o.name === queue)
  if (!s || !key || !q) return $.ui.toast(`session-queue: queue ${queue} isn't open any more.`)
  const values = Object.keys(s.values)
  const written = await writeSetting($, q, s, current => values[(values.indexOf(settingsOf(current)[key]) + 1) % values.length]!)
  if ('failed' in written) return $.ui.toast(`session-queue: ${written.failed}`)
  await refresh($).catch(() => undefined)
  const kept = keptBy(queues, s, written.value)
  if (kept) $.ui.toast(kept)
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await paneQueuesNow($)
    if (list.length === 0) return <Text dimColor>No open queue (queues/queue-&lt;name&gt;.md).</Text>
    const many = list.length > 1

    // A minimized pane on the desktop app: what `next-session` runs, at a glance.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          {list.map(q => {
            const running = q.rows.filter(r => r.isRunning)
            const next = q.rows.find(r => r.isNext)
            // One running row by name; several by id, so the next row still fits.
            const busy =
              running.length === 1 ? `running ${running[0]!.id} ${running[0]!.session}` : running.length > 1 ? `running ${running.map(r => r.id).join(', ')}` : ''
            const after = next ? (running.length > 0 ? `next ${next.id}` : `next ${next.id} ${next.session}`) : running.length > 0 ? '' : 'no runnable row'
            return (
              <Text>
                {many ? `${q.name}: ` : ''}
                {[busy, after].filter(Boolean).join(' · ')}
              </Text>
            )
          })}
        </Box>
      )
    }

    const settings = await settingsNow($)
    // One button per setting, wrapped to the pane's width; each press moves
    // that setting on (`toggle`).
    const buttons = (s: QueueSettings) => (
      <Box flexWrap="wrap" columnGap={1} marginBottom={1}>
        {SHOWN.map(([name, key]) => (
          <Button key={`${s.name}/${name}`} label={`${name}: ${s[key]}`} dimColor onPress={() => void toggle($, s.name, name)} />
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {list.map(q => {
          const anyRunning = q.rows.some(r => r.isRunning)
          const s = settings.find(o => o.name === q.name)
          return (
          <Box flexDirection="column" marginBottom={many ? 1 : 0}>
            {many && <Text bold>Queue {q.name}</Text>}
            {s && buttons(s)}
            {q.rows.length === 0 && <Text dimColor>No open rows.</Text>}
            {q.rows.map(r => (
              <Box flexDirection="column">
                <Text bold={r.isRunning || (r.isNext && !anyRunning)}>
                  {r.isRunning ? '● ' : r.isNext ? '▶ ' : '  '}
                  {r.id} {r.session}
                </Text>
                <Text dimColor>    {r.status}</Text>
              </Box>
            ))}
          </Box>
          )
        })}
      </Box>
    )
  })
}
