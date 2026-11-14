import { expect, test } from 'claude-code/testing'

// Each hook here stands for the engine: a fake prompts/ folder, and a record
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
  const shown = fakeQueues(on, { 'promptDemo.md': '# Demo\n\n**Pace.** speed (chosen 2026-11-13).\n' })
  await start($)
  expect(shown.at(-1)).toBe('mode: ⚡ speed')
})

test('a missing Pace line is balanced', async ($, on) => {
  const shown = fakeQueues(on, { 'promptDemo.md': '# Demo\n\n**Notify.** off\n' })
  await start($)
  expect(shown.at(-1)).toBe('mode: balanced')
})

test('a closed queue is ignored; its successor counts', async ($, on) => {
  const shown = fakeQueues(on, {
    'promptDemo.md': '# Demo\n\nClosed 2026-11-10, a record only.\n\n**Pace.** speed\n',
    'promptCalc2.md': '# Calc2\n\nSuccessor to `promptDemo.md` (closed 2026-11-10, a record only).\n\n**Pace.** economy\n',
    'notes.md': '**Pace.** speed\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('mode: economy')
})

test('two queues on different paces are named', async ($, on) => {
  const shown = fakeQueues(on, {
    'promptA.md': '**Pace.** speed\n',
    'promptB.md': '**Pace.** balanced\n',
  })
  await start($)
  expect(shown.at(-1)).toBe('A: ⚡ speed · B: balanced')
})

test('no queue folder clears the line', async ($, on) => {
  const shown: (string | undefined)[] = []
  on('fs.list', () => { throw new Error('ENOENT') })
  on('ui.status', (_: unknown, e: { text?: string }) => (shown.push(e.text), { value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await start($)
  expect(shown.at(-1)).toBe(undefined)
})
