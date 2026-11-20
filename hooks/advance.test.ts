import { expect, mock, test } from 'claude-code/testing'
import { decide } from './advance'
import { parseQueue } from './queues'

// Auto-advance: a row going DONE in a turn types next-session for the user
// after a cancellable delay, through the clear. Each hook here stands for the
// engine: a fake queues/ folder, the usage windows, the model, and records of
// the toasts, commands, and prompts that reach it.
function fake(on: any, files: Record<string, string>, opts: { weekly?: number; fiveHour?: number; model?: string } = {}) {
  const toasts: string[] = []
  const calls: string[] = []
  let box = ''
  let messages = 0
  const clock = mock.clock(on)
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => ((files[e.path.split('/').pop() ?? ''] = e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: { text: string }) => (toasts.push(e.text), { value: undefined }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: Array.from({ length: messages }, () => ({ role: 'user', text: 'x', toolUses: [] })) }))
  on('agent.list', () => ({ value: [] }))
  on('session.model', () => ({ value: opts.model ?? 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {},
      rateLimits: [
        ...(opts.weekly === undefined ? [] : [{ kind: 'seven_day', percentUsed: opts.weekly }]),
        ...(opts.fiveHour === undefined ? [] : [{ kind: 'five_hour', percentUsed: opts.fiveHour }]),
      ],
    },
  }))
  on('prompt.edit', (_: unknown, e: { text: string; inputText: string }) => ({ text: e.text + e.inputText, cursor: (e.text + e.inputText).length }))
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => ((box = e.text), { isFilled: true }))
  on('command.run', (_: unknown, e: { command: string }) => (calls.push(`/${e.command}`), { text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => (calls.push(e.text), { text: e.text }))
  return { toasts, calls, clock, setBox: (t: string) => (box = t), used: () => (messages = 3) }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
// A fresh conversation runs next-session (no clear: nothing to clear), and
// the session in it gets going.
async function runSession($: any, used: () => void, calls: string[]) {
  await start($)
  await $.prompt.submit({ text: 'next-session', wait: false, origin: { kind: 'composer' } })
  used()
  calls.length = 0
}
const turn = ($: any, reason = 'answer') => $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't1', reason })

const ALL_AUTO = [
  '**Go-ahead.** auto (chosen 2026-11-20).',
  '**Commits.** auto (chosen 2026-11-20).',
  '**Clear.** auto (chosen 2026-11-20).',
  '**Auto-advance.** on: until 80% of the weekly usage limit (chosen 2026-11-20).',
].join('\n\n')

const queue = (rows: string[], settings = ALL_AUTO) =>
  [settings, '', '| # | Session | Topic file | Status | Model |', '|---|---|---|---|---|', ...rows].join('\n') + '\n'

const RUNNING = queue([
  '| 1 | First | `d/one.md` | IN PROGRESS 2026-11-20 (building; s) | opus |',
  '| 2 | Second. More words | `d/two.md` | TODO | opus |',
])
const FINISHED = RUNNING.replace('IN PROGRESS 2026-11-20 (building; s)', '**DONE 2026-11-20** (committed abc; ok)')

test('a row going DONE advances after the delay, through the clear', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { toasts, calls, clock, used } = fake(on, files, { weekly: 40 })
  await runSession($, used, calls)
  files['queue-demo.md'] = FINISHED
  await turn($)
  expect(toasts.at(-1)).toBe('session-queue: auto-advance runs 2 (Second) in 15s; type in the prompt box to cancel.')
  await clock.advance(14_000)
  expect(calls).toEqual([])
  await clock.advance(1_000)
  await clock.settle()
  expect(calls).toEqual(['/clear', 'next-session'])
})

test('typing in the box cancels it', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { toasts, calls, clock, used } = fake(on, files, { weekly: 40 })
  await runSession($, used, calls)
  files['queue-demo.md'] = FINISHED
  await turn($)
  // A bare cursor move doesn't cancel; typing does.
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '' })
  expect(toasts.at(-1)).toContain('in 15s')
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' })
  await clock.advance(20_000)
  await clock.settle()
  expect(calls).toEqual([])
  expect(toasts.at(-1)).toBe('session-queue: auto-advance cancelled (you typed in the prompt box).')
})

test('text in the box when the timer fires cancels it', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { toasts, calls, clock, setBox, used } = fake(on, files, { weekly: 40 })
  await runSession($, used, calls)
  files['queue-demo.md'] = FINISHED
  await turn($)
  setBox('a draft')
  await clock.advance(20_000)
  await clock.settle()
  expect(calls).toEqual([])
  expect(toasts.at(-1)).toContain('the prompt box has text')
})

test('no next-session here, or a turn that did not answer: nothing happens', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { toasts, calls, clock, used } = fake(on, files, { weekly: 40 })
  // A row another conversation finishes doesn't advance this one.
  await start($)
  used()
  files['queue-demo.md'] = FINISHED
  await turn($)
  await clock.advance(20_000)
  await clock.settle()
  expect(calls).toEqual([])
  expect(toasts.filter(t => t.includes('auto-advance'))).toEqual([])
})

test('an interrupted turn leaves the advance to the next answer', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { calls, clock, used } = fake(on, files, { weekly: 40 })
  await runSession($, used, calls)
  files['queue-demo.md'] = FINISHED
  await turn($, 'aborted')
  await clock.advance(20_000)
  expect(calls).toEqual([])
  await turn($)
  await clock.advance(20_000)
  await clock.settle()
  expect(calls).toEqual(['/clear', 'next-session'])
})

test('/queue-autoadvance on 70% reads as 70%', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': RUNNING }
  fake(on, files)
  await start($)
  const r = await ($ as any).command.run({ command: 'queue-autoadvance', args: 'on 70%' })
  expect(r.text).toBe('Queue demo: Auto-advance set to on until 70% of the weekly usage limit.')
})

test('the weekly limit stops it with a toast', async ($, on) => {
  const files = { 'queue-demo.md': RUNNING }
  const { toasts, calls, clock, used } = fake(on, files, { weekly: 80 })
  await runSession($, used, calls)
  files['queue-demo.md'] = FINISHED
  await turn($)
  await clock.advance(20_000)
  await clock.settle()
  expect(calls).toEqual([])
  expect(toasts.at(-1)).toBe('session-queue: auto-advance stopped: weekly usage is at 80% (limit set: 80%).')
})

// --- decide -----------------------------------------------------------------

const q = (text: string) => parseQueue('demo', 'queues', text)
const WEEKLY = (n: number) => [{ kind: 'seven_day', percentUsed: n }]
const stopOf = (d: ReturnType<typeof decide>) => (d && 'stop' in d ? d.stop : d && 'advance' in d ? `advance ${d.advance.id}` : d)

test('decide: each stop', () => {
  const opus = 'claude-opus-5-5'
  expect(stopOf(decide(q(FINISHED), ['x'], WEEKLY(10), opus))).toBe('advance 2')
  expect(stopOf(decide(q(FINISHED), ['1'], WEEKLY(10), opus))).toBe(undefined) // nothing new
  expect(stopOf(decide(q(FINISHED), undefined, WEEKLY(10), opus))).toBe(undefined) // no baseline
  expect(stopOf(decide(q(FINISHED.replace('**Auto-advance.** on', '**Auto-advance.** off')), [], WEEKLY(10), opus))).toBe(undefined)
  expect(stopOf(decide(q(FINISHED.replace('**Commits.** auto', '**Commits.** approve')), [], WEEKLY(10), opus))).toBe(
    'Go-ahead, Commits, and Clear must all be auto',
  )
  expect(stopOf(decide(q(FINISHED), [], [], opus))).toBe('no weekly usage reading')
  expect(stopOf(decide(q(FINISHED), [], [...WEEKLY(10), { kind: 'five_hour', percentUsed: 92 }], opus))).toBe('five-hour usage is at 92%')
  expect(stopOf(decide(q(FINISHED), [], WEEKLY(10), 'claude-sonnet-5-5'))).toBe('2 (Second) runs on opus; switch with /model')
  expect(stopOf(decide(q(FINISHED.replace('| 2 | Second.', '| 2 | Second. **Starts with its discussion**.')), [], WEEKLY(10), opus))).toBe(
    '2 (Second) starts with its discussion',
  )
  expect(stopOf(decide(q(FINISHED.replace('| TODO |', '| PAUSED 2026-11-20 (blocked; branch) |')), [], WEEKLY(10), opus))).toBe(
    '2 (Second) is paused; resume it yourself',
  )
  expect(stopOf(decide(q(FINISHED.replace('| TODO |', '| **DONE 2026-11-20** (x) |')), ['1'], WEEKLY(10), opus))).toBe('no session left to run')
  expect(stopOf(decide(q(FINISHED.replace('80%', '30%')), [], WEEKLY(35), opus))).toBe('weekly usage is at 35% (limit set: 30%)')
})

// --- The command ------------------------------------------------------------

test('/queue-autoadvance 70 turns it on with the three auto settings; off leaves them', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': queue(['| 1 | First | `d/one.md` | TODO | opus |'], '**Go-ahead.** ask\n\n**Commits.** approve\n\n**Clear.** auto\n') }
  fake(on, files, { weekly: 10 })
  await start($)
  const r = await ($ as any).command.run({ command: 'queue-autoadvance', args: '70%' })
  expect(r.text).toBe('Queue demo: Auto-advance set to on until 70% of the weekly usage limit. Also set Go-ahead and Commits to auto.')
  const text = files['queue-demo.md']!
  expect(text).toMatch(/^\*\*Auto-advance\.\*\* on: until 70% of the weekly usage limit \(chosen /m)
  expect(text).toContain('**Go-ahead.** auto')
  expect(text).toContain('**Commits.** auto')
  expect(parseQueue('demo', 'queues', text).autoAdvance).toBe(70)
  const off = await ($ as any).command.run({ command: 'queue-autoadvance', args: 'off' })
  expect(off.text).toBe('Queue demo: Auto-advance set to off.')
  expect(files['queue-demo.md']).toContain('**Commits.** auto')
  expect(parseQueue('demo', 'queues', files['queue-demo.md']!).autoAdvance).toBe(undefined)
  // `on` alone keeps the default.
  await ($ as any).command.run({ command: 'queue-autoadvance', args: 'on' })
  expect(parseQueue('demo', 'queues', files['queue-demo.md']!).autoAdvance).toBe(80)
})
