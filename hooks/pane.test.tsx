import { expect, test } from 'claude-code/testing'

// A fake queues/ folder, and the engine's answers the pane needs.
// With `listAt`, the queue files are in `<listAt>/queues` only: the relative
// `queues` (where the shell's cd is) holds other files, and other folders none.
function fakeFolder(on: any, files: Record<string, string>, openResult: object = { isPlaced: true }, listAt?: string) {
  const opened: string[] = []
  on('fs.list', (_: unknown, e: { path: string }) => {
    if (listAt !== undefined && e.path === 'queues') return { value: [{ name: 'worker.ts', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
    if (listAt !== undefined && e.path !== `${listAt}/queues`) throw new Error('ENOENT')
    return { value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (listAt !== undefined && !e.path.startsWith(`${listAt}/queues/`)) throw new Error('ENOENT')
    return { value: files[e.path.split('/').pop() ?? ''] }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_: unknown, e: { id: string }) => (opened.push(e.id), { value: openResult }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  return { opened }
}

const QUEUE = [
  '# Demo queue',
  '',
  '**Pace.** economy (chosen 2026-11-01; see the skill\'s Pace section).',
  '',
  '| # | Session | Topic file | Status | Model |',
  '|---|---|---|---|---|',
  '| 1 | First | `d/one.md` | **DONE 2026-11-02** (committed abc) | opus |',
  '| 2 | Second | `d/two.md` | TODO | opus |',
  '| 3 | Third | `d/three.md` | TODO (last) | opus |',
  '',
].join('\n')

const PANE = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', placement: 'dock' | 'inline' | 'widget' = 'dock') =>
  ({
    plugin: 'session-queue',
    component: 'Pane',
    requestId: 'session-queue',
    surface,
    props: {
      title: 'Queue',
      isFocused: false,
      bodyColumns: 40,
      placement,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  }) as const

test('/queue-pane opens the pane, which lists the open rows on every surface', async ($, on) => {
  const { opened } = fakeFolder(on, { 'queue-demo.md': QUEUE })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual([]) // never opened unasked
  // `any`, as in commands.test.ts: the input's origin and presentation are the engine's.
  const { text } = await ($ as any).command.run({ command: 'queue-pane', args: '' })
  expect(text).toBe('Queue pane opened.')
  expect(opened).toEqual(['session-queue'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect((await ui.find({ type: 'Text', text: /2 Second/ }))?.text).toBe('▶ 2 Second')
    expect((await ui.find({ type: 'Text', text: /3 Third/ }))?.text).toBe('  3 Third')
    expect(await ui.find({ type: 'Text', text: /First/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Queue demo/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the pane follows the queue file after a turn', async ($, on) => {
  const files: Record<string, string> = { 'queue-demo.md': QUEUE }
  fakeFolder(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('desktop'))
  expect((await ui.find({ type: 'Text', text: /2 Second/ }))?.text).toBe('▶ 2 Second')

  files['queue-demo.md'] = QUEUE.replace('| 2 | Second | `d/two.md` | TODO |', '| 2 | Second | `d/two.md` | IN PROGRESS 2026-11-03 (building; s-1) |').replace('TODO (last)', 'TODO')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // The running row is marked ● and in bold; the next one keeps ▶, not bold.
  const running = await ui.find({ type: 'Text', text: /2 Second/ })
  expect(running?.text).toBe('● 2 Second')
  expect(running?.props.bold).toBe(true)
  const next = await ui.find({ type: 'Text', text: /3 Third/ })
  expect(next?.text).toBe('▶ 3 Third')
  expect(next?.props.bold).toBe(false)
  expect((await ui.find({ type: 'Text', text: /building/ }))?.text).toContain('IN PROGRESS 2026-11-03 (building; s-1)')
  await ui.unmount()
  const widget = await $.ui.mount(PANE('desktop', 'widget'))
  expect((await widget.find({ type: 'Text' }))?.text).toBe('running 2 Second · next 3')
  await widget.unmount()
})

test('a minimized pane shows what next-session runs; two queues are named', async ($, on) => {
  fakeFolder(on, { 'queue-a.md': QUEUE, 'queue-b.md': QUEUE.replace(/\| TODO \|/, '| DROPPED 2026-11-04 (no) |').replace('TODO (last)', 'DONE 2026-11-05') })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const widget = await $.ui.mount(PANE('desktop', 'widget'))
  expect((await widget.find({ type: 'Text', text: /^a:/ }))?.text).toBe('a: next 2 Second')
  expect((await widget.find({ type: 'Text', text: /^b:/ }))?.text).toBe('b: no runnable row')
  await widget.unmount()
  const dock = await $.ui.mount(PANE('terminal'))
  expect((await dock.find({ type: 'Text', text: /Queue b/ }))?.text).toBe('Queue b')
  expect((await dock.find({ type: 'Text', text: /No open rows/ }))?.text).toBe('No open rows.')
  await dock.unmount()
})

test('with no open queue the pane says so', async ($, on) => {
  fakeFolder(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No open queue (queues/queue-<name>.md).')
  await ui.unmount()
})

test('after the shell cds into a subfolder with a queues/ of its own, the pane finds the queue under the project root', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, undefined, '/proj')
  on('session.root', () => ({ value: '/proj' }))
  await $.session.start({ cwd: '/proj/src', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /2 Second/ }))?.text).toBe('▶ 2 Second')
  await ui.unmount()
})

test('a worktree session finds the queue in the main copy the engine names', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, undefined, '/repo')
  on('session.root', () => ({ value: '/repo/.claude/worktrees/w' }))
  on('vcs.detect', () => ({ vcs: 'git', root: '/repo/.claude/worktrees/w', mainRoot: '/repo', revision: null, branch: null, defaultBranch: null, remote: null }))
  await $.session.start({ cwd: '/repo/.claude/worktrees/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /2 Second/ }))?.text).toBe('▶ 2 Second')
  await ui.unmount()
})

test('rows an earlier version stored are declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ queue: 'old' }], version: 1 } }))
  const ui = await $.ui.mount(PANE('desktop'))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No open queue (queues/queue-<name>.md).')
  await ui.unmount()
})

test('a refused open says why', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, { isPlaced: false, reason: 'no surface' })
  expect((await ($ as any).command.run({ command: 'queue-pane', args: '' })).text).toBe('Queue pane not shown: no surface')
})

test('only the next row is marked when two rows share its id', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE.replace('| 3 | Third |', '| 2 | Third |') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /Second/ }))?.text).toBe('▶ 2 Second')
  expect((await ui.find({ type: 'Text', text: /Third/ }))?.text).toBe('  2 Third')
  await ui.unmount()
})

test('a session started in a topic folder finds the queue folder above it', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, undefined, '/p/code')
  on('session.root', () => ({ value: '/p/code/queues/word-add-in' }))
  // The engine's lookup names the session's own folder, not the checkout above it.
  on('vcs.detect', () => ({ vcs: 'git', root: '/p/code/queues/word-add-in', mainRoot: null, revision: null, branch: null, defaultBranch: null, remote: null }))
  await $.session.start({ cwd: '/p/code/queues/word-add-in', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text', text: /2 Second/ }))?.text).toBe('▶ 2 Second')
  await ui.unmount()
})

test('a project with no queue of its own does not take a queue folder above it', async ($, on) => {
  fakeFolder(on, { 'queue-demo.md': QUEUE }, undefined, '/p')
  on('session.root', () => ({ value: '/p/other-repo' }))
  await $.session.start({ cwd: '/p/other-repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No open queue (queues/queue-<name>.md).')
  await ui.unmount()
})
