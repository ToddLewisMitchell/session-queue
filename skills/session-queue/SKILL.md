---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, discussion first, risk lines, approval before commits, optional parallel worktrees). Use for `next-session`, `parallel-session <id>`, or starting, adding to, reordering or closing a queue (`prompts/prompt*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
<queue-dir>/                      default: prompts/
  prompt<Name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Keep the queue file short** (≤ about 500 lines). Every session reads it all. It holds only:
  - the goal and a pointer to this skill;
  - **Branching** (see below);
  - **Checks** and **Worktree setup**;
  - the session table and ordering notes.
- **Topic files hold everything else:**
  - the user's words, quoted and dated;
  - decisions and open questions;
  - plans, and `## Session notes` appended by each session.
- **Git.** Ask whether the queue folder is committed. Many users keep `prompts/` in `.gitignore` because notes are private. Record the answer, and never stage an ignored queue folder.
- **Templates:** `templates/queue.md` and `templates/topic.md`.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber. Insert rows in order, with a new id.
- **Status:**
  - `TODO`;
  - `TODO (placement not decided)`: the user must place it before it runs;
  - `TODO (after X)` / `TODO (last)`: an ordering constraint;
  - `**DONE <date>** (committed <hash>; outcome)`.
- **Model:** the model the session should run on. To switch, tell the user (`/model`) and **wait**.

## Principles
1. **A risk line on every option and recommendation.** Mark the recommended option ★.
2. **Never commit, push, merge or publish without the user's approval.** Propose a commit message instead.
3. **Sessions that "start with their discussion"** present choices with risk lines and wait for decisions before building.
4. **Spike before queueing** a feasibility claim you can't verify. Split long plans into several sessions.
5. **Don't re-derive or re-litigate** what a topic file records as decided.
6. **Targeted edits only** to the queue file, never a full rewrite. Another session may be editing it.
7. **Document as you go:** remarks in code, decisions and notes in the topic file, a handoff in memory.

## Branching
The queue file records one of three modes, chosen by the user when the queue starts. Always show the user the full mode names below, never shortened. To explain the options, read `references/branching.md`; only then, or when the user asks to change modes. Missing means **work on main**. "Main" means the repo's default branch, whatever it's called (often `main` or `master`). Find it with `git symbolic-ref refs/remotes/origin/HEAD`, or by which of the two exists. Don't assume; if both exist and there's no remote, ask.
- **work on main**: commit each session on the main branch.
- **branch per session**: each session works on branch `q/<id>-<slug>` from an up-to-date main.
  - At the end, after approval: commit on the branch, rerun the Checks, merge into main (`--no-ff`), and delete the branch.
  - If main moved on, merge main into the branch first and rerun the Checks.
- **branch for risky sessions**: work on main, except sessions whose row says **Branch** (set when the user or a topic file judges the session risky). Those follow the branch-per-session rules.

A session that is abandoned in branch mode leaves main untouched. Ask before deleting an unmerged branch.

## Workflows

### 1. Start a queue
1. Ask for the goal, whether the queue folder is committed, and the **branching mode**. Read `references/branching.md` and present its comparison with ★ and risk lines.
2. If there's an earlier queue, mark it closed ("a record only") and carry over its open rows and topic files.
3. Write `prompt<Name>.md` from the template. Fill in **Checks** (tests, linters, type checks, build warnings, a code-review level) and **Worktree setup** (see the last section). Ask if anything is unknown.
4. Make a project memory, if the host has memory, naming the queue file and `next-session`.

### 2. Add a task
1. Write a topic file from the template: the user's words with the date, the placement, what's known, and open questions with ★ and risk lines.
2. Add a row with a targeted edit. Use `TODO (placement not decided)` unless the user gave a placement. Update the ordering notes if needed.
3. **Parallel check.** If another session is running, check whether this task could run alongside it now (workflow 4). If so, offer to start it in a worktree, with a risk line. If not, say why in one line. Never start one without a yes.

### 3. `next-session`
1. Read the queue file, the topic file of the first runnable `TODO` row, and the project memory. If only "placement not decided" rows are left, ask the user to place them.
2. **Present the scope in one message:** the work, the open questions, the model, and the branch (if the mode gives one).
   - In the same message, **offer parallel sessions**: up to two rows that could run alongside (workflow 4), one line each, with a risk line.
   - It's an offer. The user decides based on workload and usage limits.
3. Create the session branch if the mode calls for one.
4. If the session starts with its discussion, hold it, wait for decisions, and record them in the topic file.
5. Do the work, keeping the **Checks** clean.
6. **End of session:**
   - the Checks pass (give the counts);
   - the queue's code review has run on the session's diff, with findings applied or explained;
   - session notes are in the topic file;
   - the memory has a DONE note and a handoff;
   - a commit message is proposed.

   After approval: commit, then merge if on a branch (Branching). Mark the row `**DONE <date>** (committed <hash>; outcome)`. Name the next session and its model.

### 4. Parallel sessions in git worktrees
**Eligible:**
- a placed `TODO` row that isn't ordered after the current session;
- its files don't overlap the current session's, judged from both topic files and `git status`. **Say how sure you are.**

Recommend at most two: each one uses up limits faster and adds a merge.

**Running one** (`parallel-session <id>`, or a yes to an offer):
1. Make a worktree on branch `q/<id>-<slug>`: `EnterWorktree`, or an agent with `isolation: "worktree"`.
2. Apply the queue's **Worktree setup** (separate data, databases and ports; how dependencies are reached).
3. **An untracked queue folder isn't in the worktree.** Edit the queue, topic file and memory in the main checkout by full path, touching only this session's row.
4. Run the Checks in the worktree.
5. **Merge only with approval,** after the main session has committed. Rerun the Checks on the merged result, then remove the worktree.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed ("a record only");
2. start a successor that carries over the open rows (workflow 1, keeping the branching mode unless the user changes it);
3. point the memory at the new file.

## Worktree setup: what to ask for
- **State:** the data folder or database the app writes to, and how to point a second copy elsewhere.
- **Ports:** the dev servers' ports, and how to change them.
- **Dependencies:** whether the virtualenv or `node_modules` can be shared by path, or must be installed per worktree (for example, native binaries for another OS).
- **Singletons:** anything that allows only one running copy per machine.
