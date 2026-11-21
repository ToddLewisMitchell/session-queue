import { expect, test } from 'claude-code/testing'
import { approvalOf, gitActions } from './guard'

// --- Reading the command line ----------------------------------------------

const acts = (cmd: string) => [...gitActions(cmd)].sort()

test('finds git at the head of each command', () => {
  expect(acts('git commit -m x')).toEqual(['commit'])
  expect(acts('cd a && git merge --no-ff q/1-x; git push origin main')).toEqual(['merge', 'push'])
  expect(acts('git -C ../wt -c user.name=x commit -m y')).toEqual(['commit'])
  expect(acts('GIT_EDITOR=true /usr/bin/git merge main')).toEqual(['merge'])
  expect(acts('git status && git log -1 && git merge-base a b')).toEqual([])
})

test('a commit message is not read as commands', () => {
  const heredoc = `git commit -m "$(cat <<'EOF'\nFix it; git push later\n\ngit merge main\nEOF\n)"`
  expect(acts(heredoc)).toEqual(['commit'])
  expect(acts(`git commit -m 'a; git push'`)).toEqual(['commit'])
  expect(acts(`echo "git push" | cat`)).toEqual([])
  expect(acts(`git commit -F - <<EOF\ngit push\nEOF\ngit status`)).toEqual(['commit'])
})

test('harmless forms pass', () => {
  expect(acts('git merge --abort')).toEqual([])
  expect(acts('git push --dry-run')).toEqual([])
  expect(acts('git commit --dry-run')).toEqual([])
  expect(acts('git add queues/queue-a.md')).toEqual([])
  expect(acts('git add -p hooks/guard.ts')).toEqual([])
})

test('force-staging the queue folder or the whole tree is found', () => {
  expect(acts('git add -f queues/queue-a.md')).toEqual(['force-add'])
  expect(acts('git add --force .')).toEqual(['force-add'])
  expect(acts('git add -fA')).toEqual(['force-add'])
  expect(acts('git add -f ./queues')).toEqual(['force-add'])
  expect(acts('git add -f hooks/x.ts')).toEqual([])
})

test('the review\'s escapes are caught', () => {
  // An apostrophe in a heredoc message inside $(...).
  expect(acts(`git commit -m "$(cat <<'EOF'\nDon't break it\nEOF\n)" && git push`)).toEqual(['commit', 'push'])
  // A line continuation.
  expect(acts('git -C ../wt \\\n  push origin main')).toEqual(['push'])
  // Shell keywords, wrappers, and scripts run by a shell or eval.
  expect(acts('if git merge x; then git push; fi')).toEqual(['merge', 'push'])
  expect(acts(`bash -c 'git push'`)).toEqual(['push'])
  expect(acts('sudo -E git push')).toEqual(['push'])
  expect(acts('eval git push')).toEqual(['push'])
  expect(acts('echo $(git push)')).toEqual(['push'])
  // A here-string is not a heredoc.
  expect(acts('cat <<< word\ngit push\nword')).toEqual(['push'])
  // ${#var} is not a comment.
  expect(acts('echo ${#a} && git push')).toEqual(['push'])
  // Other ways to make a commit or a merge.
  expect(acts('git pull && git cherry-pick abc')).toEqual(['commit', 'merge'])
  expect(acts('git rebase main')).toEqual(['commit'])
  expect(acts('git rebase --abort')).toEqual([])
  // A glob under -f reaches the queue folder.
  expect(acts(`git add -f '*.md'`)).toEqual(['force-add'])
})

test('everyday commands are left alone', () => {
  expect(acts(`git commit -m "$(cat <<'EOF'\nAdd the guard; don't push yet\n\nCo-Authored-By: X <x@y>\nEOF\n)"`)).toEqual(['commit'])
  expect(acts('timeout 300 claude plugin test . 2>&1 | tail -3')).toEqual([])
  expect(acts('git log --oneline -5 | head && git diff --stat')).toEqual([])
  expect(acts(`grep -n "git push" README.md`)).toEqual([])
  expect(acts(`python3 - <<'EOF'\nos.system("git push")\nEOF`)).toEqual([])
})

test('a command it cannot read asks when it mentions git', () => {
  expect(acts(`git commit -m 'unclosed`)).toEqual(['commit', 'unreadable'])
  expect(acts(`cat <<EOF\ngit push`)).toEqual(['unreadable'])
  expect(acts(`echo 'unclosed`)).toEqual([])
})

// --- The verdicts ------------------------------------------------------------

function fake(on: any, files: Record<string, string>, opts: { ignored?: boolean; core?: 'allow' | 'ask' | 'deny'; reply?: string } = {}) {
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path.split('/').pop() ?? ''] }))
  on('process.run', () => ({ value: { exitCode: opts.ignored ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.check', () => ({ decision: opts.core ?? 'allow' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  // Claude's last reply, which a bare "yes" answers.
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'next-session', toolUses: [] },
    { role: 'assistant', text: opts.reply ?? 'Proposed commit message: Add x. Approve?', toolUses: [] },
  ] }))
}

const say = ($: any, text: string, kind = 'composer', turnId?: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind }, ...(turnId ? { turnId } : {}) })

const check = ($: any, command: string) => $.tool.check({ tool: 'Bash', input: { command } })
const APPROVE = { 'queue-a.md': '**Commits.** ask (chosen 2026-11-19)\n' }
const AUTO = { 'queue-a.md': '**Commits.** auto (chosen 2026-11-19)\n' }

test('Commits ask asks before a commit or merge', async ($, on) => {
  fake(on, APPROVE)
  const r = await check($, 'git commit -m x')
  expect(r.decision).toBe('ask')
  expect(r.reason).toContain("the queue's Commits setting is ask. Allow this commit?")
  expect((await check($, 'git merge --no-ff q/1-x')).decision).toBe('ask')
  expect((await check($, 'git status')).decision).toBe('allow')
})

test('a missing Commits line means ask', async ($, on) => {
  fake(on, { 'queue-a.md': '**Pace.** economy\n' })
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
})

test('Commits auto lets a commit through; a push still asks', async ($, on) => {
  fake(on, AUTO)
  expect((await check($, 'git commit -m x')).decision).toBe('allow')
  expect((await check($, 'git push')).decision).toBe('ask')
})

test('one queue on ask (or an older approve) is enough to ask', async ($, on) => {
  fake(on, { ...AUTO, 'queue-b.md': '**Commits.** approve\n' })
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
})

test('no open queue, no guard', async ($, on) => {
  fake(on, { 'queue-a.md': 'Closed 2026-11-10, a record only.\n' })
  expect((await check($, 'git push')).decision).toBe('allow')
})

test('a deny beneath stands', async ($, on) => {
  fake(on, APPROVE, { core: 'deny' })
  expect((await check($, 'git commit -m x')).decision).toBe('deny')
})

test('a subagent commit is refused, even on auto', async ($, on) => {
  fake(on, AUTO)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x', agentId: 'a1' })
  expect(r.isError).toBe(true)
  expect(String(r.text)).toContain('subagent')
})

test('force-staging an ignored queue folder is refused', async ($, on) => {
  fake(on, AUTO, { ignored: true })
  const r = await check($, 'git add -f queues/')
  expect(r.decision).toBe('deny')
  expect(String(r.reason)).toContain('queues/')
})

test('a worktree session finds the queue in the main checkout', async ($, on) => {
  on('fs.list', (_: unknown, e: { path: string }) => {
    if (e.path !== '/repo/queues') throw new Error('ENOENT')
    return { value: [{ name: 'queue-a.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('fs.read', () => ({ value: '**Commits.** auto\n' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.check', () => ({ decision: 'allow' }))
  expect((await check($, 'git push')).decision).toBe('ask')
})

test('after a cd, the ignore check runs where the queue folder was found', async ($, on) => {
  const cwds: (string | undefined)[] = []
  on('fs.list', (_: unknown, e: { path: string }) => {
    if (e.path !== '/repo/queues') throw new Error('ENOENT')
    return { value: [{ name: 'queue-a.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('fs.read', () => ({ value: '**Commits.** auto\n' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.cwd', () => ({ value: '/repo/src' }))
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }) => {
    if (e.argv[1] === 'check-ignore') cwds.push(e.init?.cwd)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  expect((await check($, 'git add -f queues/')).decision).toBe('deny')
  expect(cwds).toEqual(['/repo'])
})

test('an unreadable git command asks', async ($, on) => {
  fake(on, AUTO)
  expect((await check($, `cat <<EOF\ngit push`)).decision).toBe('ask')
})

test('force-staging a committed queue folder is allowed', async ($, on) => {
  fake(on, AUTO, { ignored: false })
  expect((await check($, 'git add -f queues/')).decision).toBe('allow')
})

// --- The user's own approval -----------------------------------------------

test('a short approval is read as one; anything else is not', () => {
  for (const t of ['commit', 'Commit.', 'commit it', 'yes commit', 'Yes, please commit', 'go ahead and commit', 'Yes. Commit it.', 'approved', 'lgtm', 'merge'])
    expect([t, approvalOf(t)]).toEqual([t, 'named'])
  for (const t of ['yes', 'y', 'ok!', 'go ahead', 'yes please', 'Okay.'])
    expect([t, approvalOf(t)]).toEqual([t, 'bare'])
  for (const t of ["don't commit yet", 'commit?', 'no', 'not yet', 'wait', 'it', 'please', '', 'yes but fix the test first', 'commit and push', 'looks good', 'go with that'])
    expect([t, approvalOf(t)]).toEqual([t, undefined])
})

test('a bare yes approves only when Claude last asked about a commit', async ($, on) => {
  fake(on, APPROVE, { reply: 'Scope: the guard change. Nothing to decide. Go ahead?' })
  await say($, 'yes')
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
  await say($, 'commit')
  expect((await check($, 'git commit -m x')).decision).toBe('allow')
})

test('the user typing an approval skips the commit dialog; a push still asks', async ($, on) => {
  fake(on, APPROVE)
  await say($, 'commit')
  expect((await check($, 'git commit -m x')).decision).toBe('allow')
  expect((await check($, 'git merge --no-ff q/1-x')).decision).toBe('allow')
  expect((await check($, 'git push')).decision).toBe('ask')
})

test('from the phone counts too', async ($, on) => {
  fake(on, APPROVE)
  await say($, 'yes', 'bridge')
  expect((await check($, 'git commit -m x')).decision).toBe('allow')
})

test('the next prompt takes the approval back', async ($, on) => {
  fake(on, APPROVE)
  await say($, 'commit')
  await say($, 'actually, add a test first')
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
})

test("a plugin's prompt is no approval, and starting a turn takes one back", async ($, on) => {
  fake(on, APPROVE)
  await say($, 'commit')
  await say($, 'yes', 'plugin')
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
})

test("a notification delivered into the running turn leaves the user's approval", async ($, on) => {
  fake(on, APPROVE)
  await say($, 'commit')
  await say($, 'agent done', 'task-notification', 't1')
  expect((await check($, 'git commit -m x')).decision).toBe('allow')
})

test('a new conversation holds no approval', async ($, on) => {
  fake(on, APPROVE)
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await say($, 'commit')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await check($, 'git commit -m x')).decision).toBe('ask')
})
