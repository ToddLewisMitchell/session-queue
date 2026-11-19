import { expect, mock, test } from 'claude-code/testing'
import { SETTINGS, setLine } from './commands'
import { nextRow } from './queues'

// A fake queues/ folder the commands read and write, and the status lines and
// commands the plugin registers.
function fakeFolder(on: any, files: Record<string, string>, opts: { failWrite?: boolean } = {}) {
  const shown: (string | undefined)[] = []
  const registered: string[] = []
  const clock = mock.clock(on)
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    if (opts.failWrite) throw new Error('EACCES')
    files[e.path.split('/').pop() ?? ''] = e.text
    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => (registered.push(e.name), { value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return { shown, registered, clock }
}

const run = ($: any, command: string, args = '') => $.command.run({ command, args })

const QUEUE = [
  '# Demo queue',
  '',
  '**Branching.** work on main (chosen 2026-11-01; see the skill\'s Branching section).',
  '',
  '**Pace.** economy (chosen 2026-11-01; parallel runs would conflict; see the skill\'s Pace section).',
  '',
  '**Commits.** approve (chosen 2026-11-01; see the skill\'s Go-ahead, Commits, and Clear section).',
  '',
  '## Checks',
  '- tests',
  '',
  '## Sessions',
  '',
  '| # | Session | Topic file | Status | Model |',
  '|---|---|---|---|---|',
  '| 1 | First | `d/one.md` | **DONE 2026-11-02** (committed abc) | opus |',
  '| 2 | Second | `d/two.md` | IN PROGRESS 2026-11-03 (building; s-1) | opus |',
  '| 3 | Third | `d/three.md` | TODO (after 2) | sonnet |',
  '| 4 | Fourth | `d/four.md` | TODO | opus |',
  '| 5 | Fifth | `d/five.md` | TODO (last) | opus |',
  '| 6 | Sixth | `d/six.md` | DROPPED 2026-11-04 (not needed) | opus |',
  '',
].join('\n')

test('the commands are registered at session start', async ($, on) => {
  const { registered } = fakeFolder(on, { 'queue-demo.md': QUEUE })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['queue', 'queue-pace', 'queue-go-ahead', 'queue-commits', 'queue-clear', 'queue-notify'])
})

test('/queue shows the open rows, the next row, and the settings', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE })
  const { text } = await run($, 'queue')
  expect(text).toContain('Queue demo: pace economy · go-ahead ask · commits approve · clear auto · notify off')
  expect(text).toContain('next-session runs 4 (Fourth) on opus')
  expect(text).toContain('2  Second: IN PROGRESS 2026-11-03 (building; s-1)')
  expect(text).toContain('5  Fifth: TODO (last)')
  expect(text).not.toContain('First')
  expect(text).not.toContain('Sixth')
})

test('/queue with two queues shows both, or the one named in any case', async ($, on) => {
  fakeFolder(on, { 'queue-a.md': QUEUE, 'queue-b.md': '**Pace.** speed\n' })
  expect((await run($, 'queue')).text).toContain('Queue b: pace speed')
  const one = (await run($, 'queue', 'A')).text
  expect(one).toContain('Queue a:')
  expect(one).not.toContain('Queue b:')
  expect((await run($, 'queue', 'c')).text).toBe('No open queue named c. Open: a, b.')
})

test('/queue-pace rewrites the line with today\'s date and refreshes the status', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  const { shown, clock } = fakeFolder(on, files)
  await clock.set(new Date(2026, 10, 20, 12).getTime())
  const { text } = await run($, 'queue-pace', 'Speed')
  expect(text).toBe('Queue demo: Pace set to speed.')
  // The old line's own notes stay; only the value and the date change.
  expect(files['queue-demo.md']).toContain("**Pace.** speed (chosen 2026-11-20; parallel runs would conflict; see the skill's Pace section).\n\n**Commits.**")
  expect(files['queue-demo.md']).not.toContain('economy')
  expect(shown.at(-1)).toBe('pace: ⚡ speed')
})

test('a missing line goes where the template puts it', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  await run($, 'queue-go-ahead', 'auto')
  await run($, 'queue-notify', 'on')
  const text = files['queue-demo.md']!
  const at = (s: string) => text.indexOf(s)
  expect(at('**Pace.**') < at('**Go-ahead.** auto: start building')).toBe(true)
  expect(at('**Go-ahead.**') < at('**Commits.**')).toBe(true)
  expect(at('**Commits.**') < at('**Notify.** on: push a notification')).toBe(true)
  expect(at('**Notify.**') < at('## Checks')).toBe(true)
})

test('a bad value, an extra word, or an unnamed second queue writes nothing', async ($, on) => {
  const files: Record<string, string> = { 'queue-a.md': QUEUE, 'queue-b.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-clear', 'maybe a')).text).toBe('Usage: /queue-clear <auto|off> [queue]')
  expect((await run($, 'queue-clear', 'off a b')).text).toBe('Usage: /queue-clear <auto|off> [queue]')
  expect((await run($, 'queue-clear', 'off')).text).toBe('Two or more queues are open; name one: a, b.')
  expect(files['queue-a.md']).toBe(QUEUE)
  expect(files['queue-b.md']).toBe(QUEUE)
  expect((await run($, 'queue-clear', 'B off')).text).toBe('Queue b: Clear set to off.')
  expect(files['queue-a.md']).toBe(QUEUE)
})

test('the same value again changes nothing', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-commits', 'approve')).text).toBe('Queue demo: Commits is already approve.')
  expect(files['queue-demo.md']).toBe(QUEUE)
})

test('setLine with no settings lines goes before the first heading, or at the end', () => {
  const pace = SETTINGS[0]!
  expect(setLine('# T\n\n## Sessions\n', pace, 'speed', '2026-11-20')).toBe(
    "# T\n\n**Pace.** speed (chosen 2026-11-20; see the skill's Pace section).\n\n## Sessions\n",
  )
  expect(setLine('# T\n', pace, 'speed', '2026-11-20')).toBe("# T\n\n**Pace.** speed (chosen 2026-11-20; see the skill's Pace section).\n")
})

test('nextRow skips rows after an open row, and last while others are open', () => {
  expect(nextRow(QUEUE)?.id).toBe('4')
  const only = QUEUE.replace('| TODO |', '| DONE |').replace('IN PROGRESS 2026-11-03 (building; s-1)', 'DONE')
  expect(nextRow(only)?.id).toBe('3')
})

test('an inherited key is not a value', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-pace', 'constructor')).text).toBe('Usage: /queue-pace <economy|balanced|speed> [queue]')
  expect(files['queue-demo.md']).toBe(QUEUE)
})

test('a queue named like a value is still named', async ($, on) => {
  const files: Record<string, string> = { 'queue-auto.md': QUEUE, 'queue-b.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-clear', 'auto auto')).text).toBe('Queue auto: Clear set to auto.')
  expect(files['queue-b.md']).toBe(QUEUE)
})

test('a failed write says so', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, { failWrite: true })
  expect((await run($, 'queue-pace', 'speed')).text).toBe("Couldn't update queues/queue-demo.md; nothing was changed.")
})

test('Windows line endings are kept', () => {
  const crlf = QUEUE.replace(/\n/g, '\r\n')
  const out = setLine(setLine(crlf, SETTINGS[0]!, 'speed', '2026-11-20'), SETTINGS[4]!, 'on', '2026-11-20')
  expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false)
  expect(out).toContain('**Pace.** speed (chosen 2026-11-20; parallel runs would conflict;')
})

test('nextRow: held rows do not block last; every id after "after" counts', () => {
  const t = (rows: string[]) => ['| # | Session | Topic file | Status | Model |', '|---|---|---|---|---|', ...rows].join('\n') + '\n'
  expect(nextRow(t(['| 5 | Last | `d/l.md` | TODO (last) | opus |', '| 7 | Held | `d/h.md` | TODO (placement not decided) | opus |']))?.id).toBe('5')
  const after = t([
    '| 2 | Two | `d/2.md` | DONE | opus |',
    '| 3 | Three | `d/3.md` | IN PROGRESS 2026-11-19 (building; s) | opus |',
    '| 4 | Four | `d/4.md` | TODO (after 2, 3) | opus |',
    '| 5 | Five | `d/5.md` | TODO | opus |',
  ])
  expect(nextRow(after)?.id).toBe('5')
})
