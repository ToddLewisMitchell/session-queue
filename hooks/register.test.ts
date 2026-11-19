import { expect, mock, test } from 'claude-code/testing'

// Each hook here stands for the engine: a fake queues/ folder, and a record
// of every status line the plugin pins.
function fakeQueues(on: any, files: Record<string, string>) {
  const shown: (string | undefined)[] = []
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  return shown
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('speed shows a flag', async ($, on) => {
  const shown = fakeQueues(on, { 'queue-demo.md': '# Demo\n\n**Pace.** speed (chosen 2026-11-13).\n' })
  await start($)
  expect(shown.at(-1)).toBe('pace: ⚡ speed')
})

test('a missing Pace line is balanced', async ($, on) => {
  const shown = fakeQueues(on, { 'queue-demo.md': '# Demo\n\n**Notify.** off\n' })
  await start($)
  expect(shown.at(-1)).toBe('pace: balanced')
})

test('a closed queue is ignored; its successor counts', async ($, on) => {
  const shown = fakeQueues(on, {
    'queue-demo.md': '# Demo\n\nClosed 2026-11-10, a record only.\n\n**Pace.** speed\n',
    'queue-calc2.md': '# Calc2\n\nSuccessor to `queue-demo.md` (closed 2026-11-10, a record only).\n\n**Pace.** economy\n',
    'notes.md': '**Pace.** speed\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('pace: economy')
})

test('a row that mentions closing a record stays open', async ($, on) => {
  const shown = fakeQueues(on, {
    'queue-demo.md': '# Demo\n\n**Pace.** speed\n\n| 3 | Archive | `d/a.md` | **DONE 2026-11-12** (closed the old log, a record only) | opus |\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('pace: ⚡ speed')
})

test('two queues on different paces are named', async ($, on) => {
  const shown = fakeQueues(on, {
    'queue-a.md': '**Pace.** speed\n',
    'queue-b.md': '**Pace.** balanced\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('a: ⚡ speed · b: balanced')
})

test('no queue folder clears the line', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('fs.list', () => { throw new Error('ENOENT') })
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await start($)
  expect(shown.at(-1)).toBe(undefined)
})

test('auto go-ahead and auto-commit join the flag', async ($, on) => {
  const shown = fakeQueues(on, {
    'queue-demo.md': '**Pace.** speed\n\n**Go-ahead.** auto (chosen 2026-11-19)\n\n**Commits.** auto (chosen 2026-11-19)\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('pace: ⚡ speed · auto go-ahead · auto-commit')
})

test('ask and approve add nothing', async ($, on) => {
  const shown = fakeQueues(on, { 'queue-demo.md': '**Go-ahead.** ask\n\n**Commits.** approve\n' })
  await start($)
  expect(shown.at(-1)).toBe('pace: balanced')
})

test('two queues with different settings are named', async ($, on) => {
  const shown = fakeQueues(on, {
    'queue-a.md': '**Pace.** balanced\n\n**Commits.** auto\n',
    'queue-b.md': '**Pace.** balanced\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('a: balanced, auto-commit · b: balanced')
})

// --- Clear before next-session ---------------------------------------------

function fakeSession(on: any, files: Record<string, string>, opts: { messages?: number; agents?: string[] } = {}) {
  fakeQueues(on, files)
  const clock = mock.clock(on)
  const calls: string[] = []
  on('session.messages', () => ({ value: Array.from({ length: opts.messages ?? 3 }, () => ({ role: 'user', text: 'x', toolUses: [] })) }))
  on('agent.list', () => ({ value: (opts.agents ?? []).map((status, i) => ({ id: `a${i}`, description: 'd', type: 'general-purpose', status })) }))
  on('command.run', (_: unknown, e: { command: string }) => (calls.push(`/${e.command}`), { text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => (calls.push(e.text), { text: e.text }))
  return { clock, calls }
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
