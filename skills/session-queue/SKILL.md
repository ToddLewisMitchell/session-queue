---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, discussion first, risk lines, approval before commits, optional parallel worktrees and notifications). Use for `next-session`, `parallel-session <id>`, or starting, adding to, reordering or closing a queue (`prompts/prompt*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
<queue-dir>/                      default: prompts/
  prompt<Name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Queue file: short** (≤ about 500 lines), because every session reads it all. Only the goal and a pointer to this skill, **Branching**, **Notify**, **Checks**, **Worktree setup**, the session table and ordering notes.
- **Topic files: everything else.** The user's words, quoted and dated. Decisions, open questions, plans, and `## Session notes` appended by each session.
- **Git.** The queue file records whether its folder is committed (many users ignore `prompts/` because notes are private). Never stage an ignored queue folder.
- **Templates:** `templates/queue.md`, `templates/topic.md`.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber; insert rows in order with a new id.
- **Status:** `TODO`, `TODO (placement not decided)` (the user must place it before it runs), `TODO (after X)` / `TODO (last)`, or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit, and the next session adds the hash.
- **Model:** to switch, tell the user (`/model`) and **wait**.

## Principles
1. **A risk line on every option and recommendation.** Mark the recommended one ★.
2. **Never commit, push, merge or publish without the user's approval.** Propose a commit message instead.
3. **Sessions that "start with their discussion"** present choices with risk lines and wait for decisions before building.
4. **Spike before queueing** a feasibility claim you can't verify. Split long plans into several sessions.
5. **Don't re-derive or re-litigate** what a topic file records as decided.
6. **Targeted edits only** to the queue file, never a full rewrite. Another session may be editing it.
7. **Document as you go:** remarks in code, decisions and notes in the topic file, a handoff in memory (or, if the host has none, in the topic file's session notes).

## Branching
The user picks one of three modes when the queue starts. Always use the full mode names. Read `references/branching.md` only to explain the options, at queue start or when the user asks to change modes. Missing means **work on main**.

"Main" means the repo's default branch (often `main` or `master`). Find it with `git symbolic-ref refs/remotes/origin/HEAD`, or by which one exists. If both exist and there's no remote, ask.
- **work on main**: commit each session on main.
- **branch per session**: work on `q/<id>-<slug>` from an up-to-date main. After approval: commit, merge main in first if it moved on, rerun the Checks, merge into main (`--no-ff`), delete the branch.
- **branch for risky sessions**: main, except rows marked **Branch** (judged risky by the user or a topic file). Those follow branch per session.

An abandoned branch session leaves main untouched. Ask before deleting an unmerged branch.

## Notifications
The queue's **Notify** line is `on` or `off`; missing means **off**. Offer it only if the host can push notifications (for example `PushNotification`, which reaches the phone when Remote Control is connected).

When it's on, send **one** notification each time a session stops and needs the user:
- a discussion waits for decisions;
- a commit or merge waits for approval;
- a parallel session is ready to merge;
- a model switch is needed;
- a blocker.

Never notify for routine progress.
- **Format:** one line, under 200 characters, leading with the session id and the action, e.g. `Queue 2b: commit ready for approval (checks green)`.
- **No private content:** no code or topic-file quotes, since the message can show on a lock screen.
- **"Not sent" is normal** (the user is at the terminal, or notifications are off). Don't retry.
- **Never approval:** a notification doesn't count as an answer. Still wait for one.

## Workflows

### 1. Start a queue
**Read `references/start-queue.md` before asking the user anything.** It covers an existing open queue, the goal and name, git, branching, Notify, Checks, Worktree setup, and roll-overs from workflow 5.

### 2. Add a task
1. **Pick the queue** as in workflow 3, step 1. Write a topic file from `templates/topic.md`: the user's words with the date, the placement, what's known, and open questions with ★ and risk lines.
2. Add a row with a targeted edit. Use `TODO (placement not decided)` unless the user gave a placement. Update the ordering notes if needed.
   - **Reordering** means editing Status constraints and the ordering notes. Never renumber.
3. **Parallel check.** If a session is running (in this conversation, or a worktree in `git worktree list`) and this task could run alongside it (workflow 4), offer a worktree with a risk line. Otherwise say why in one line. Never start one without a yes.

### 3. `next-session`
1. **Pick the queue.** With more than one open queue, use the one named in `next-session <Name>`, or ask. Read the queue file, the topic file of the first runnable `TODO` row, and the project memory. If only unplaced rows are left, ask the user to place them. If the last DONE row is missing its hash, add it.
2. **Present the scope in one message:** the work, open questions, model, and branch (if any). In the same message, offer up to two parallel sessions (workflow 4), one line each with a risk line. The user decides based on workload and usage limits.
3. Create the session branch if the mode calls for one.
4. If the session starts with its discussion, hold it, **wait for the user's decisions before building** (notify if on), and record them in the topic file.
5. Do the work, keeping the **Checks** clean.
6. **End of session:**
   - the Checks pass (give the counts);
   - the queue's code review has run on the diff, with findings applied or explained;
   - session notes are in the topic file;
   - memory (or the session notes) has a DONE note and a handoff;
   - a commit message is proposed (notify if on).

   After approval: commit, and merge if on a branch. Mark the row DONE (see Status). Name the next session and its model; if the model differs, tell the user to switch (`/model`) before typing `next-session`.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. Recommend at most two, because each one uses up limits faster and adds a merge.

**Running one** (`parallel-session <id>`, or a yes to an offer):
1. Make a worktree on branch `q/<id>-<slug>`:
   - **typed in a new conversation:** `EnterWorktree` (this conversation becomes the parallel session);
   - **from the conversation already running a session:** a background agent with `isolation: "worktree"`. Never `EnterWorktree` here, because it would move the current session. The agent leaves its work uncommitted in the worktree, since it can't ask for approval (see step 5).
2. Apply the queue's **Worktree setup**.
3. **Edit the queue, topic file and memory in the main checkout by full path, touching only this session's row.** This applies whether or not the queue folder is committed: an untracked one isn't in the worktree, and editing a committed one's copy in the worktree conflicts at merge.
4. Run the Checks in the worktree.
5. **A background agent's work:** when it finishes, this session sends the notify if it's on, shows the diff and the Checks results, proposes a commit message, and after approval commits in the worktree.
6. **Merge only with approval,** after the main session has committed, by the branch-per-session steps in every mode (`--no-ff`, rerun the Checks on the merged result, delete the branch). Then remove the worktree.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed ("a record only");
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).
