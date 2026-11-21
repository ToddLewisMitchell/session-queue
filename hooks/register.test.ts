import { expect, mock, test } from 'claude-code/testing'

// Each hook here stands for the engine: a fake queues/ folder, and a record
// of every status line the plugin sets (now only cleared: the settings are in
// the footer).
function fakeQueues(on: any, files: Record<string, string>) {
  const shown: (string | undefined)[] = []
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  recordFooter(on)
  return shown
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// The prompt footer's mode labels as the plugin leaves them, joined as the
// footer joins them: a hook beneath the plugin (registered before the test's
// first call of $, by `recordFooter`) records what reaches it.
let seen: readonly string[] = []
function recordFooter(on: any) {
  on('ui.render', { component: 'SessionMode' }, (_: unknown, e: any, next: any) => ((seen = e.props.modes), next(e)))
}
async function footer($: any, modes: string[] = []) {
  seen = []
  const ui = await $.ui.mount({ plugin: 'session-queue', component: 'SessionMode', surface: 'terminal', props: { modes } })
  await ui.unmount()
  return seen.join(' & ')
}

// The footer's settings: each one's value, missing ones at their defaults.
const DEFAULTS = { parallels: 'ask', 'go-ahead': 'ask', commit: 'ask', clear: 'auto', 'auto-advance': 'off', notify: 'off' }
const shown = (o: Partial<typeof DEFAULTS> = {}) =>
  Object.entries({ ...DEFAULTS, ...o })
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')

test('every setting shows, missing ones at their defaults', async ($, on) => {
  fakeQueues(on, { 'queue-demo.md': '# Demo\n\n**Parallels.** auto (chosen 2026-11-13).\n' })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown({ parallels: 'auto' })}`)
})

test('an older Pace line reads as Parallels; a Parallels line wins over it', async ($, on) => {
  fakeQueues(on, { 'queue-a.md': '**Pace.** economy\n', 'queue-b.md': '**Pace.** speed\n\n**Parallels.** ask\n' })
  await start($)
  expect(await footer($)).toBe(`queue a · ${shown({ parallels: 'off' })} & queue b · ${shown()}`)
})

test('a missing Parallels line is ask', async ($, on) => {
  fakeQueues(on, { 'queue-demo.md': '# Demo\n\n**Notify.** off\n' })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown()}`)
})

test('a closed queue is ignored; its successor counts', async ($, on) => {
  fakeQueues(on, {
    'queue-demo.md': '# Demo\n\nClosed 2026-11-10, a record only.\n\n**Pace.** speed\n',
    'queue-calc2.md': '# Calc2\n\nSuccessor to `queue-demo.md` (closed 2026-11-10, a record only).\n\n**Pace.** economy\n',
    'notes.md': '**Pace.** speed\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown({ parallels: 'off' })}`)
})

test('a row that mentions closing a record stays open', async ($, on) => {
  fakeQueues(on, {
    'queue-demo.md': '# Demo\n\n**Pace.** speed\n\n| 3 | Archive | `d/a.md` | **DONE 2026-11-12** (closed the old log, a record only) | opus |\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown({ parallels: 'auto' })}`)
})

test('two queues on different Parallels settings are named', async ($, on) => {
  fakeQueues(on, {
    'queue-a.md': '**Pace.** speed\n',
    'queue-b.md': '**Pace.** balanced\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue a · ${shown({ parallels: 'auto' })} & queue b · ${shown()}`)
})

test('no queue folder: the old status line is cleared and the footer is left alone', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('fs.list', () => { throw new Error('ENOENT') })
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  recordFooter(on)
  await start($)
  expect(shown.at(-1)).toBe(undefined)
  expect(await footer($, ['focus'])).toBe('focus')
})

test('auto go-ahead and auto-commit show as auto', async ($, on) => {
  fakeQueues(on, {
    'queue-demo.md': '**Pace.** speed\n\n**Go-ahead.** auto (chosen 2026-11-19)\n\n**Commits.** auto (chosen 2026-11-19)\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown({ parallels: 'auto', 'go-ahead': 'auto', commit: 'auto' })}`)
})

test('an older Commits approve reads as ask', async ($, on) => {
  fakeQueues(on, { 'queue-demo.md': '**Go-ahead.** ask\n\n**Commits.** approve\n' })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown()}`)
})

test('auto-advance shows the weekly share it runs until', async ($, on) => {
  fakeQueues(on, { 'queue-demo.md': '**Auto-advance.** on: until 70% of the weekly usage limit (chosen 2026-11-20).\n' })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown({ 'auto-advance': 'until 70% weekly' })}`)
})

test('two queues with different settings are named', async ($, on) => {
  fakeQueues(on, {
    'queue-a.md': '**Pace.** balanced\n\n**Commits.** auto\n',
    'queue-b.md': '**Pace.** balanced\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue a · ${shown({ commit: 'auto' })} & queue b · ${shown()}`)
})

// --- Clear before next-session ---------------------------------------------

function fakeSession(on: any, files: Record<string, string>, opts: { messages?: number; agents?: string[] } = {}) {
  fakeQueues(on, files)
  const clock = mock.clock(on)
  const calls: string[] = []
  on('session.messages', () => ({ value: Array.from({ length: opts.messages ?? 3 }, () => ({ role: 'user', text: 'x', toolUses: [] })) }))
  on('agent.list', () => ({ value: (opts.agents ?? []).map((status, i) => ({ id: `a${i}`, description: 'd', type: 'general-purpose', status })) }))
  on('command.run', (_: unknown, e: { command: string }) => (calls.push(`/${e.command}`), { text: '' }))
  const context: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => (
    calls.push(e.text), context.push(e.context), { text: e.text }
  ))
  return { clock, calls, context }
}

const typed = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const QUEUE_ON = { 'queue-demo.md': '**Pace.** balanced\n' }

test('next-session clears a used conversation, then runs', async ($, on) => {
  const { clock, calls } = fakeSession(on, QUEUE_ON)
  const r = await typed($, 'next-session')
  expect('drop' in r).toBe(true)
  await clock.settle()
  expect(calls).toEqual(['/clear', 'next-session'])
})

test('the clear empties the box of the dropped next-session, never a new draft', async ($, on) => {
  const { clock } = fakeSession(on, QUEUE_ON)
  let box = 'next-session'
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => (fills.push(e.text), (box = e.text), { isFilled: true }))
  await typed($, 'next-session')
  await clock.settle()
  expect(fills).toEqual([''])

  box = 'a new draft'
  fills.length = 0
  await typed($, 'next-session')
  await clock.settle()
  expect(fills).toEqual([])
})

test('the dropped next-session coming back to the box later is emptied once', async ($, on) => {
  const { clock } = fakeSession(on, QUEUE_ON)
  let box = ''
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => (fills.push(e.text), (box = e.text), { isFilled: true }))
  on('prompt.change', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await typed($, 'next-session')
  await clock.settle()
  expect(fills).toEqual([]) // the box was empty at both checks
  // The engine hands the draft back afterwards.
  box = 'next-session'
  await ($ as any).prompt.change({ text: box, cursor: box.length, origin: { kind: 'engine' } })
  await clock.settle()
  expect(fills).toEqual([''])
  // Once only: a second put-back stays.
  box = 'next-session'
  await ($ as any).prompt.change({ text: box, cursor: box.length, origin: { kind: 'engine' } })
  await clock.settle()
  expect(fills).toEqual([''])
})

test('the user recalling next-session after the clear keeps it', async ($, on) => {
  const { clock } = fakeSession(on, QUEUE_ON)
  let box = ''
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => (fills.push(e.text), (box = e.text), { isFilled: true }))
  on('prompt.change', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await typed($, 'next-session')
  await clock.settle()
  box = 'next-session'
  for (const kind of ['history', 'undo'])
    await ($ as any).prompt.change({ text: box, cursor: box.length, origin: { kind } })
  await clock.settle()
  expect(fills).toEqual([])
})

test('a fresh conversation is not cleared', async ($, on) => {
  const { clock, calls } = fakeSession(on, QUEUE_ON, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  expect(calls).toEqual(['next-session'])
})

test('Clear off keeps the conversation', async ($, on) => {
  const { clock, calls } = fakeSession(on, { 'queue-demo.md': '**Clear.** off\n' })
  await typed($, 'next-session')
  await clock.settle()
  expect(calls).toEqual(['next-session'])
})

test('a named queue decides alone', async ($, on) => {
  const { clock, calls } = fakeSession(on, { 'queue-a.md': '**Clear.** off\n', 'queue-b.md': '**Clear.** auto\n' })
  await typed($, 'next-session b')
  await clock.settle()
  expect(calls).toEqual(['/clear', 'next-session b'])
})

test('a running background agent blocks the clear', async ($, on) => {
  const { clock, calls } = fakeSession(on, QUEUE_ON, { agents: ['completed', 'running'] })
  await typed($, 'next-session')
  await clock.settle()
  expect(calls).toEqual(['next-session'])
})

test('other prompts and origins pass through', async ($, on) => {
  const { clock, calls } = fakeSession(on, QUEUE_ON)
  await typed($, 'next-session please, after the fix')
  await $.prompt.submit({ text: 'next-session', wait: false, origin: { kind: 'sdk' } })
  await clock.settle()
  expect(calls).toEqual(['next-session please, after the fix', 'next-session'])
})

// --- Queue context at next-session -----------------------------------------

const TABLE = (rows: string[]) =>
  ['**Pace.** balanced', '', '| # | Session | Topic file | Status | Model |', '|---|---|---|---|---|', ...rows].join('\n') + '\n'

test('next-session attaches the queue file and the next topic file', async ($, on) => {
  const queue = TABLE([
    '| 1 | Done one | `d/one.md` | **DONE 2026-11-19** (committed abc) | opus |',
    '| 2 | Held | `d/held.md` | TODO (placement not decided) | opus |',
    '| 3 | Next | `d/next.md` | TODO | opus |',
    '| 4 | Later | `d/later.md` | TODO (after 3) | opus |',
  ])
  const { clock, context } = fakeSession(on, { 'queue-demo.md': queue, 'next.md': 'NEXT TOPIC', 'later.md': 'LATER' }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  const text = context[0]?.join('\n') ?? ''
  expect(text).toContain('<file path="queues/queue-demo.md">')
  expect(text).toContain('| 3 | Next |')
  expect(text).toContain('<file path="queues/d/next.md">\nNEXT TOPIC\n</file>')
  expect(text).not.toContain('LATER')
})

test('the conversation after a clear carries the context', async ($, on) => {
  const queue = TABLE(['| 1 | Paused | `d/p.md` | PAUSED 2026-11-19 (blocked; branch q/1-p) | opus |'])
  const { clock, calls, context } = fakeSession(on, { 'queue-demo.md': queue, 'p.md': 'PAUSED TOPIC' })
  on('prompt.context', (_: unknown, e: { blocks: readonly { name: string; text: string }[] }) => ({ blocks: e.blocks }))
  await typed($, 'next-session')
  await clock.settle()
  expect(calls).toEqual(['/clear', 'next-session'])
  // The resubmit skips this plugin's own hook; the fresh conversation's
  // context blocks carry the files, once.
  expect(context).toEqual([undefined])
  const first = await $.prompt.context({ blocks: [] })
  expect(first.blocks.map((b: { name: string }) => b.name)).toEqual(['sessionQueue'])
  expect(first.blocks[0]?.text).toContain('PAUSED TOPIC')
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
})

test('two queues unnamed attach only the queue files', async ($, on) => {
  const row = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const { clock, context } = fakeSession(on, { 'queue-a.md': row, 'queue-b.md': row, 'next.md': 'NEXT TOPIC' }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  const text = context[0]?.join('\n') ?? ''
  expect(text).toContain('queues/queue-a.md')
  expect(text).toContain('queues/queue-b.md')
  expect(text).not.toContain('NEXT TOPIC')
})

test('a queue waiting for another: next-session runs the active one', async ($, on) => {
  const row = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const later = 'Waits for `queue-a.md`: starts when it closes.\n' + TABLE(['| 1 | Later | `d/later.md` | TODO | opus |'])
  const { clock, context } = fakeSession(on, { 'queue-a.md': row, 'queue-b.md': later, 'next.md': 'NEXT TOPIC', 'later.md': 'LATER TOPIC' }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  const text = context[0]?.join('\n') ?? ''
  expect(text).toContain('queues/queue-a.md')
  expect(text).not.toContain('queues/queue-b.md')
  expect(text).toContain('NEXT TOPIC')
})

test('a waiting queue is not in the footer', async ($, on) => {
  fakeQueues(on, {
    'queue-a.md': '**Pace.** balanced\n',
    'queue-b.md': 'Waits for `queue-a.md`.\n\n**Pace.** speed\n',
  })
  await start($)
  expect(await footer($)).toBe(`queue · ${shown()}`)
})

test('a topic path outside the queue folder is not read', async ($, on) => {
  const queue = TABLE(['| 1 | Escape | `../secret.md` | TODO | opus |'])
  const { clock, context } = fakeSession(on, { 'queue-demo.md': queue, 'secret.md': 'SECRET' }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  const text = context[0]?.join('\n') ?? ''
  expect(text).toContain('queues/queue-demo.md')
  expect(text).not.toContain('SECRET')
})

test('no open queue attaches nothing; other prompts get nothing', async ($, on) => {
  const { clock, context } = fakeSession(on, { 'queue-demo.md': 'Closed 2026-11-10, a record only.\n' }, { messages: 0 })
  await typed($, 'next-session')
  await typed($, 'hello')
  await clock.settle()
  expect(context).toEqual([undefined, undefined])
})

test('a queue file with Windows line endings still finds its topic file', async ($, on) => {
  const queue = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |']).replace(/\n/g, '\r\n')
  const { clock, context } = fakeSession(on, { 'queue-demo.md': queue, 'next.md': 'NEXT TOPIC' }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  expect(context[0]?.join('\n') ?? '').toContain('NEXT TOPIC')
})

test('a topic file too long to attach leaves the queue file', async ($, on) => {
  const queue = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const { clock, context } = fakeSession(on, { 'queue-demo.md': queue, 'next.md': 'x'.repeat(95_000) }, { messages: 0 })
  await typed($, 'next-session')
  await clock.settle()
  const text = context[0]?.join('\n') ?? ''
  expect(text).toContain('the open queue file only')
  expect(text).toContain('| 1 | Next |')
  expect(text).not.toContain('xxxxxxxxxx')
})

test('a clear whose conversation never starts goes stale', async ($, on) => {
  const queue = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const { clock } = fakeSession(on, { 'queue-demo.md': queue, 'next.md': 'NEXT TOPIC' })
  on('prompt.context', (_: unknown, e: { blocks: readonly { name: string; text: string }[] }) => ({ blocks: e.blocks }))
  await typed($, 'next-session')
  await clock.settle()
  await clock.advance(120_000)
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
})

// --- Case-insensitive next-session -----------------------------------------

test('Next-session in capitals clears and attaches too', async ($, on) => {
  const queue = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const { clock, calls } = fakeSession(on, { 'queue-demo.md': queue, 'next.md': 'NEXT TOPIC' })
  await typed($, 'Next-session')
  await clock.settle()
  expect(calls).toEqual(['/clear', 'Next-session'])
})

test('a queue name matches in any case', async ($, on) => {
  const queue = TABLE(['| 1 | Next | `d/next.md` | TODO | opus |'])
  const { clock, calls, context } = fakeSession(on, { 'queue-Demo.md': queue, 'next.md': 'NEXT TOPIC' }, { messages: 0 })
  await typed($, 'NEXT-SESSION demo')
  await clock.settle()
  expect(calls).toEqual(['NEXT-SESSION demo'])
  expect(context[0]?.join('\n') ?? '').toContain('NEXT TOPIC')
})
