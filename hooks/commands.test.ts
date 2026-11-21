import { expect, mock, test } from 'claude-code/testing'
import { removeRow, SETTINGS, setLine } from './commands'
import { nextRow, parseQueue } from './queues'

// A fake queues/ folder the commands read and write, and the status lines and
// commands the plugin registers.
function fakeFolder(on: any, files: Record<string, string>, opts: { failWrite?: boolean } = {}) {
  const shown: (string | undefined)[] = []
  const registered: string[] = []
  const described: Record<string, string> = {}
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
  on('command.register', (_: unknown, e: { name: string; description: string }) => {
    registered.push(e.name)
    described[e.name] = e.description
    return { value: { command: e.name } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return { shown, registered, described, clock }
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
  expect(registered).toEqual(['queue', 'queue-remove', 'queue-parallels', 'queue-go-ahead', 'queue-commit', 'queue-autoclear', 'queue-autoadvance', 'queue-notify', 'queue-pane'])
})

test('/queue shows the open rows, the next row, and the settings', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE })
  const { text } = await run($, 'queue')
  expect(text).toContain('Queue demo · parallels: off · go-ahead: ask · commit: ask · auto-clear: on · auto-advance: off · notify: off')
  expect(text).toContain('next-session runs 4 (Fourth) on opus')
  expect(text).toContain('2  Second: IN PROGRESS 2026-11-03 (building; s-1)')
  expect(text).toContain('5  Fifth: TODO (last)')
  expect(text).not.toContain('First')
  expect(text).not.toContain('Sixth')
})

test('/queue with two queues shows both, or the one named in any case', async ($, on) => {
  fakeFolder(on, { 'queue-a.md': QUEUE, 'queue-b.md': '**Parallels.** auto\n' })
  expect((await run($, 'queue')).text).toContain('Queue b · parallels: auto')
  const one = (await run($, 'queue', 'A')).text
  expect(one).toContain('Queue a ·')
  expect(one).not.toContain('Queue b ·')
  expect((await run($, 'queue', 'c')).text).toBe('No open queue named c. Open: a, b.')
})

test('/queue-parallels replaces an older Pace line with today\'s date', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  const { clock } = fakeFolder(on, files)
  await clock.set(new Date(2026, 10, 20, 12).getTime())
  const { text } = await run($, 'queue-parallels', 'Auto')
  expect(text).toBe('Queue demo: Parallels set to auto.')
  // The old line's own notes stay, its section renamed; the name, value, and date change.
  expect(files['queue-demo.md']).toContain("**Parallels.** auto (chosen 2026-11-20; parallel runs would conflict; see the skill's Parallels section).\n\n**Commits.**")
  expect(files['queue-demo.md']).not.toContain('economy')
  expect(files['queue-demo.md']).not.toContain('**Pace.**')
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
  expect((await run($, 'queue-autoclear', 'maybe a')).text).toBe('Usage: /queue-autoclear <off|on> [queue]')
  expect((await run($, 'queue-autoclear', 'off a b')).text).toBe('Usage: /queue-autoclear <off|on> [queue]')
  expect((await run($, 'queue-autoclear', 'off')).text).toBe('Two or more queues are active; name one: a, b.')
  expect(files['queue-a.md']).toBe(QUEUE)
  expect(files['queue-b.md']).toBe(QUEUE)
  expect((await run($, 'queue-autoclear', 'B off')).text).toBe('Queue b: Clear set to off.')
  expect(files['queue-a.md']).toBe(QUEUE)
})

test('the same value again changes nothing', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  await run($, 'queue-commit', 'auto')
  const once = files['queue-demo.md']
  expect((await run($, 'queue-commit', 'auto')).text).toBe('Queue demo: Commits is already auto.')
  expect(files['queue-demo.md']).toBe(once)
})


test('setLine with no settings lines goes before the first heading, or at the end', () => {
  const parallels = SETTINGS[0]!
  expect(setLine('# T\n\n## Sessions\n', parallels, 'auto', '2026-11-20')).toBe(
    "# T\n\n**Parallels.** auto (chosen 2026-11-20; see the skill's Parallels section).\n\n## Sessions\n",
  )
  expect(setLine('# T\n', parallels, 'auto', '2026-11-20')).toBe("# T\n\n**Parallels.** auto (chosen 2026-11-20; see the skill's Parallels section).\n")
})

test('nextRow skips rows after an open row, and last while others are open', () => {
  expect(nextRow(QUEUE)?.id).toBe('4')
  const only = QUEUE.replace('| TODO |', '| DONE |').replace('IN PROGRESS 2026-11-03 (building; s-1)', 'DONE')
  expect(nextRow(only)?.id).toBe('3')
})

test('an inherited key is not a value', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-parallels', 'constructor')).text).toBe('Usage: /queue-parallels <off|ask|auto> [queue]')
  expect(files['queue-demo.md']).toBe(QUEUE)
})

test('a queue named like a value is still named', async ($, on) => {
  const files: Record<string, string> = { 'queue-auto.md': QUEUE, 'queue-b.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-commit', 'auto auto')).text).toBe('Queue auto: Commits set to auto.')
  expect(files['queue-b.md']).toBe(QUEUE)
})

test('a failed write says so', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, { failWrite: true })
  expect((await run($, 'queue-parallels', 'auto')).text).toBe("Couldn't update queues/queue-demo.md; nothing was changed.")
})

test('Windows line endings are kept', () => {
  const crlf = QUEUE.replace(/\n/g, '\r\n')
  const out = setLine(setLine(crlf, SETTINGS[0]!, 'auto', '2026-11-20'), SETTINGS[4]!, 'on', '2026-11-20')
  expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false)
  expect(out).toContain('**Parallels.** auto (chosen 2026-11-20; parallel runs would conflict;')
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

test('nextRow: ids after "before" or a ";" in an after status do not block', () => {
  const t = (rows: string[]) => ['| # | Session | Topic file | Status | Model |', '|---|---|---|---|---|', ...rows].join('\n') + '\n'
  const q = t([
    '| R30 | Thirty | `d/30.md` | DONE | opus |',
    '| R31 | Thirty-one | `d/31.md` | TODO (after R30, before R10, R24 and R15; moved before R10 by the user, 2026-11-19) | opus |',
    '| R10 | Ten | `d/10.md` | TODO (future version, not soon) | opus |',
    '| R24 | Twenty-four | `d/24.md` | TODO | opus |',
  ])
  expect(nextRow(q)?.id).toBe('R31')
  const semi = t([
    '| 1 | One | `d/1.md` | TODO (after 2; 3 is related) | opus |',
    '| 2 | Two | `d/2.md` | DONE | opus |',
    '| 3 | Three | `d/3.md` | TODO | opus |',
  ])
  expect(nextRow(semi)?.id).toBe('1')
})

// --- A queue that waits for another ----------------------------------------

const WAITING = QUEUE.replace('# Demo queue\n', '# Later queue\n\nWaits for `queue-a.md`: starts when it closes.\n')

test('/queue-commit takes ask or auto; an older approve line already reads as ask', async ($, on) => {
  // Both on `approve`; later waits for a.
  const files: Record<string, string> = { 'queue-a.md': QUEUE, 'queue-later.md': WAITING }
  fakeFolder(on, files)
  expect((await run($, 'queue-commit', 'approve')).text).toBe('Usage: /queue-commit <ask|auto> [queue]')
  expect((await run($, 'queue-commit', 'ask')).text).toBe('Queue a: Commits is already ask.')
  expect(files['queue-a.md']).toBe(QUEUE)
  // A waiting queue on approve isn't named as left behind by a change to ask.
  await run($, 'queue-commit', 'auto')
  expect((await run($, 'queue-commit', 'ask')).text).toBe('Queue a: Commits set to ask.')
  expect(files['queue-a.md']).toMatch(/^\*\*Commits\.\*\* ask \(chosen \d{4}-\d\d-\d\d; see the skill's Go-ahead, Commits, and Clear section\)\.$/m)
  expect(files['queue-later.md']).toBe(WAITING)
})

test('a waiting queue is not active: commands unnamed act on the active one', async ($, on) => {
  const files: Record<string, string> = { 'queue-a.md': QUEUE, 'queue-later.md': WAITING }
  fakeFolder(on, files)
  expect((await run($, 'queue-autoclear', 'off')).text).toBe(
    'Queue a: Clear set to off. Waiting queue later kept Clear as it was; add the name to change it too.',
  )
  expect(files['queue-later.md']).toBe(WAITING)
  // Named, the waiting queue still changes.
  expect((await run($, 'queue-commit', 'auto later')).text).toBe('Queue later: Commits set to auto.')
})

test('/queue shows the waiting queue after the active one, without a next row', async ($, on) => {
  fakeFolder(on, { 'queue-later.md': WAITING, 'queue-a.md': QUEUE })
  const text = (await run($, 'queue')).text
  expect(text.indexOf('Queue a ·') < text.indexOf('Queue later ·')).toBe(true)
  expect(text).toContain('Waits for queue a: next-session runs it once that queue closes')
  expect(text.match(/next-session runs 4/g)?.length).toBe(1)
})

test('a queue whose predecessor closed, or that waits in a loop, is active', async ($, on) => {
  const closed = 'Closed 2026-11-19, a record only.\n' + QUEUE
  const loop = QUEUE.replace('# Demo queue\n', '# A\n\nWaits for `queue-later.md`.\n')
  const files: Record<string, string> = { 'queue-a.md': closed, 'queue-later.md': WAITING }
  fakeFolder(on, files)
  expect((await run($, 'queue-notify', 'on')).text).toBe('Queue later: Notify set to on.')
  files['queue-a.md'] = loop
  expect((await run($, 'queue-notify', 'on')).text).toBe('Two or more queues are active; name one: a, later.')
  // A third queue outside the loop doesn't hide it.
  files['queue-c.md'] = QUEUE
  expect((await run($, 'queue-notify', 'off')).text).toBe('Two or more queues are active; name one: a, later, c.')
})

test('a Waits line in bold or a quote still counts', () => {
  for (const line of ['**Waits for** `queue-a.md`: starts when it closes.', '> Waits for queue-a.md.', 'Waits for `queue-v1.2.md`.'])
    expect(parseQueue('later', 'queues', `# Later\n\n${line}\n`).waitsFor).toBe(line.includes('v1.2') ? 'v1.2' : 'a')
})

test('the commands describe what they choose', async ($, on) => {
  const { described } = fakeFolder(on, { 'queue-demo.md': QUEUE })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const s of SETTINGS) expect(described[s.command]).not.toContain('line')
  expect(described['queue-commit']).toContain('commits on its own')
})

test('/queue-remove deletes the row, keeps the topic file, and names rows after it', async ($, on) => {
  const files = { 'queue-demo.md': QUEUE.replace('## Sessions', 'Session 4 runs before 5.\n\n## Sessions').replace('| TODO (last) |', '| TODO (after 4) |') }
  fakeFolder(on, files)
  const { text } = await run($, 'queue-remove', '4')
  expect(text).toContain('Queue demo: removed row 4 (Fourth).')
  expect(text).toContain('queues/d/four.md, is still there')
  expect(text).toContain('Row 5 (TODO (after 4)) still names it')
  expect(text).toContain('notes under the table mention it')
  expect(files['queue-demo.md']).not.toContain('Fourth')
  expect(files['queue-demo.md']).toContain('| 3 | Third |')
  expect(files['queue-demo.md']).toContain('| 5 | Fifth |')
})

test('/queue-remove refuses a running row and an unknown id, and deletes DONE and DROPPED rows', async ($, on) => {
  const files = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-remove', '2')).text).toContain('Row 2 (Second) is in progress in session s-1')
  expect((await run($, 'queue-remove', '9')).text).toContain('Queue demo has no row 9. A task folded')
  expect((await run($, 'queue-remove', '')).text).toBe('Usage: /queue-remove <id> [queue]')
  expect(files['queue-demo.md']).toBe(QUEUE)
  expect((await run($, 'queue-remove', '1')).text).toContain('removed row 1 (First)')
  expect((await run($, 'queue-remove', '6')).text).toContain('removed row 6 (Sixth)')
  expect(files['queue-demo.md']).not.toContain('First')
  expect(files['queue-demo.md']).not.toContain('Sixth')
})

test('/queue-remove names a PAUSED row\'s partial work, and needs the queue with two active', async ($, on) => {
  const paused = QUEUE.replace('| 4 | Fourth | `d/four.md` | TODO |', '| 4 | Fourth | `d/four.md` | PAUSED 2026-11-05 (blocked; on branch q/4-four) |')
  const files = { 'queue-a.md': paused, 'queue-b.md': QUEUE }
  fakeFolder(on, files)
  expect((await run($, 'queue-remove', '4')).text).toContain('Two or more queues are active')
  const { text } = await run($, 'queue-remove', 'A 4')
  expect(text).toContain('It was PAUSED 2026-11-05 (blocked; on branch q/4-four); its branch or worktree, if any, is left alone.')
  expect(files['queue-a.md']).not.toContain('Fourth')
  expect(files['queue-b.md']).toBe(QUEUE)
})

test('removeRow: case-insensitive ids, duplicates, folded rows, Windows line endings, and lists of sessions', () => {
  const t = ['| # | Session | Topic file | Status | Model |', '|---|---|---|---|---|', '| R3 | A | `a.md` | TODO | opus |', '| 4 | B | `b.md` | TODO (folded into R3, pending) | opus |', '', 'Sessions 1, 2, and R3 share files.', ''].join('\r\n')
  const r = removeRow(t, 'r3')
  if ('error' in r) throw new Error(r.error)
  expect(r.text).toBe(t.replace('| R3 | A | `a.md` | TODO | opus |\r\n', ''))
  expect(r.others.map(o => o.id)).toEqual(['4'])
  expect(r.notes).toBe(true)
  expect(removeRow(t.replace('| 4 |', '| R3 | C | `c.md` | TODO | opus |\r\n| 4 |'), 'R3')).toEqual({ error: 'duplicate' })
  const n = removeRow(t, '4')
  if ('error' in n) throw new Error(n.error)
  expect(n.notes).toBe(false)
  expect(n.others).toEqual([])
})

test('removeRow takes only the session table; folded tasks and dash ranges are named', async ($, on) => {
  const other = QUEUE.replace('## Checks', '| 4 | not | a | session | row |\n\n## Checks').replace('Sessions 6 and', 'x').replace('## Sessions', 'Sessions 3–4 share files.\n\n## Sessions').replace('| 4 | Fourth |', '| 4 | Fourth + Extra |')
  const files = { 'queue-demo.md': other }
  fakeFolder(on, files)
  const { text } = await run($, 'queue-remove', '4')
  expect(text).toContain('The tasks folded into it')
  expect(text).toContain('notes under the table mention it')
  expect(files['queue-demo.md']).toContain('| 4 | not | a | session | row |')
  expect(files['queue-demo.md']).not.toContain('Fourth')
})
