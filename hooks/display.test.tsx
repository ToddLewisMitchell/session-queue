import { expect, mock, test } from 'claude-code/testing'

// The settings display: the footer labels, the phone's hint line, the note on
// an auto commit's row, the toast on a change, and the pane's settings buttons.
// Each hook here stands for the engine: a fake queues/ folder the plugin reads
// and writes, and a record of its toasts.
function fake(on: any, files: Record<string, string>) {
  const toasts: string[] = []
  mock.clock(on)
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[e.path.split('/').pop() ?? ''] = e.text
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: { text: string }) => (toasts.push(e.text), { value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  // What reaches the engine's footer and hint line, beneath the plugin.
  const seen = { modes: [] as readonly string[], hint: '' }
  on('ui.render', { component: 'SessionMode' }, (_: unknown, e: any, next: any) => ((seen.modes = e.props.modes), next(e)))
  on('ui.render', { component: 'PromptHint' }, (_: unknown, e: any, next: any) => ((seen.hint = e.props.hint), next(e)))
  return { toasts, seen }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const turn = ($: any) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

const QUEUE = [
  '# Demo',
  '',
  "**Parallels.** off (chosen 2026-11-01; see the skill's Parallels section).",
  '',
  "**Commits.** auto (chosen 2026-11-01; see the skill's Go-ahead, Commits, and Clear section).",
  '',
  '| # | Session | Topic file | Status | Model |',
  '|---|---|---|---|---|',
  '| 1 | First | `d/one.md` | TODO | opus |',
  '',
].join('\n')

test('the footer keeps its own modes and adds the queue settings', async ($, on: any) => {
  const { seen } = fake(on, { 'queue-demo.md': QUEUE })
  await start($)
  const ui = await $.ui.mount({ plugin: 'session-queue', component: 'SessionMode', surface: 'desktop', props: { modes: ['focus'] } })
  expect(seen.modes).toEqual(['focus', 'queue: parallels off · auto-commit'])
  await ui.unmount()
})

test('the phone gets the settings at the end of the hint line; the terminal keeps its own', async ($, on: any) => {
  const { seen } = fake(on, { 'queue-demo.md': QUEUE })
  await start($)
  const props = { hint: '? for shortcuts', isDraft: false, isWorking: false }
  const phone = await $.ui.mount({ plugin: 'session-queue', component: 'PromptHint', surface: 'mobile', props })
  expect(seen.hint).toBe('? for shortcuts · queue: parallels off · auto-commit')
  await phone.unmount()
  const terminal = await $.ui.mount({ plugin: 'session-queue', component: 'PromptHint', surface: 'terminal', props })
  expect(seen.hint).toBe('? for shortcuts')
  await terminal.unmount()
})

test('a hand edit shows a toast after the turn; the first read and a quiet command do not', async ($, on: any) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  const { toasts } = fake(on, files)
  await start($)
  expect(toasts).toEqual([])
  files['queue-demo.md'] = QUEUE.replace('**Parallels.** off', '**Parallels.** auto')
  await turn($)
  expect(toasts).toEqual(['Parallels → auto'])
  // The command's own reply says what changed, so no toast repeats it.
  const { text } = await ($ as any).command.run({ command: 'queue-autocommit', args: 'approve' })
  expect(text).toBe('Queue demo: Commits set to approve.')
  expect(toasts).toEqual(['Parallels → auto'])
})

test('two queues name the queue in the toast', async ($, on: any) => {
  const files: Record<string, string> = { 'queue-a.md': QUEUE, 'queue-b.md': QUEUE }
  const { toasts } = fake(on, files)
  await start($)
  files['queue-b.md'] = QUEUE.replace('**Commits.** auto', '**Commits.** approve')
  await turn($)
  expect(toasts).toEqual(['b: Commits → approve'])
})

const toolUse = (id: string, command: string, more: object = {}) =>
  ({
    plugin: 'session-queue',
    component: 'ToolUse',
    surface: 'terminal',
    props: { tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false, ...more },
  }) as any

test('a commit let through by Commits auto gets a note on its row', async ($, on: any) => {
  fake(on, { 'queue-demo.md': QUEUE })
  await ($ as any).tool.check({ tool: 'Bash', input: { command: 'git commit -m x' }, tool_use_id: 'tu1' })
  const row = await $.ui.mount(toolUse('tu1', 'git commit -m x'))
  expect((await row.find({ type: 'Text', text: /without the queue asking/ }))?.text).toBe('  commit allowed without the queue asking (Commits: auto)')
  expect(await row.keepsBeneath()).toBe(true)
  await row.unmount()
  // Another call, and the same one while it runs, have no note.
  for (const t of [toolUse('tu2', 'git commit -m y'), toolUse('tu1', 'git commit -m x', { isRunning: true })]) {
    const other = await $.ui.mount(t)
    expect(await other.find({ type: 'Text', text: /without the queue asking/ })).toBeUndefined()
    await other.unmount()
  }
})

test('a commit under Commits approve gets no note', async ($, on: any) => {
  fake(on, { 'queue-demo.md': QUEUE.replace('**Commits.** auto', '**Commits.** approve') })
  await ($ as any).tool.check({ tool: 'Bash', input: { command: 'git merge q/1' }, tool_use_id: 'tu3' })
  const row = await $.ui.mount(toolUse('tu3', 'git merge q/1'))
  expect(await row.find({ type: 'Text', text: /without the queue asking/ })).toBeUndefined()
  await row.unmount()
})

const PANE = {
  plugin: 'session-queue',
  component: 'Pane',
  requestId: 'session-queue',
  surface: 'terminal',
  props: { title: 'Queue', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the pane shows a button per setting; a press moves it on and writes the line', async ($, on: any) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  const { toasts } = fake(on, files)
  await start($)
  const ui = await $.ui.mount(PANE)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
    'Parallels: off',
    'Go-ahead: ask',
    'Commits: auto',
    'Clear: auto',
    'Notify: off',
  ])
  await ui.press({ key: 'demo/Parallels' })
  expect(files['queue-demo.md']).toMatch(/^\*\*Parallels\.\*\* ask \(chosen \d{4}-\d\d-\d\d; see the skill's Parallels section\)\.$/m)
  expect(toasts).toEqual(['Parallels → ask'])
  expect((await ui.find({ type: 'Button', key: 'demo/Parallels' }))?.text).toBe('Parallels: ask')
  // Commits: auto comes round to approve.
  await ui.press({ key: 'demo/Commits' })
  expect(files['queue-demo.md']).toContain('**Commits.** approve (chosen')
  await ui.unmount()
})

test('two quick presses move a setting two steps; a waiting queue left behind is named', async ($, on: any) => {
  const files: Record<string, string> = { 'queue-a.md': QUEUE, 'queue-b.md': 'Waits for `queue-a.md`: starts when it closes.\n\n' + QUEUE }
  const { toasts } = fake(on, files)
  await start($)
  const ui = await $.ui.mount(PANE)
  await Promise.all([ui.press({ key: 'a/Parallels' }), ui.press({ key: 'a/Parallels' })])
  expect(files['queue-a.md']).toContain('**Parallels.** auto (chosen')
  expect(files['queue-b.md']).toContain('**Parallels.** off (chosen')
  expect(toasts).toContain('Waiting queue b kept Parallels as it was; add the name to change it too.')
  await ui.unmount()
})
