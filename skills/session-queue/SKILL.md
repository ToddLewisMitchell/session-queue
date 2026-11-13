---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, discussion first, risk lines, approval before commits, and optional parallel worktrees and notifications). Use for `next-session`, `parallel-session <id>`, or starting, adding to, reordering, or closing a queue (`prompts/prompt*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan, and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
<queue-dir>/                      default: prompts/
  prompt<Name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Queue file: short** (≤ about 500 lines), because every session reads it all. Only the goal and a pointer to this skill, **Branching**, **Notify**, **Checks**, **Worktree setup**, the session table, and ordering notes.
- **Topic files: everything else.** The user's words, quoted and dated. Decisions, open questions, plans, and `## Session notes` appended by each session.
- **Git.** The queue file records whether its folder is committed (many users ignore `prompts/` because notes are private). Never stage an ignored queue folder.
- **Templates:** `templates/queue.md`, `templates/topic.md`.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber; insert rows in order with a new id.
- **Status:** `TODO`, `TODO (placement not decided)` (the user must place it before it runs), `TODO (after X)` / `TODO (last)`, `IN PROGRESS <date> (<stage>)`, or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit, and the next session adds the hash.
- **IN PROGRESS is a claim.** A session sets its row to `IN PROGRESS <date> (discussion)` or `(building)` when it starts, moves it from `(discussion)` to `(building)` once the user decides, and sets `(waiting for approval)` when it proposes the commit. Other conversations can't see this one, so the row is how they know it's taken and at what stage. Treat any `IN PROGRESS` row as running. A crashed or abandoned session leaves a stale claim: only the user clears it (back to `TODO`), so ask rather than take a claimed row over.
- **Model:** to switch, tell the user (`/model`) and **wait**.

## Principles
1. **A risk line on every option and recommendation.** Mark the recommended one ★.
2. **Never commit, push, merge, or publish without the user's approval.** Propose a commit message instead.
3. **Sessions that "start with their discussion"** present choices with risk lines and wait for decisions before building.
4. **Spike before queueing** a feasibility claim you can't verify. Split long plans into several sessions.
5. **Don't re-derive or re-litigate** what a topic file records as decided.
6. **Targeted edits only** to the queue file, never a full rewrite. Another session may be editing it.
7. **Document as you go:** remarks in code, decisions and notes in the topic file, and a handoff in memory (or, if the host has none, in the topic file's session notes).

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
3. **Parallel check.** A session is running if it runs in this conversation, has a worktree in `git worktree list`, or has an `IN PROGRESS` row. Uncommitted changes in the main checkout that this conversation didn't make may mean a session is running in another conversation: ask the user, don't infer. If this task could run alongside a running session (workflow 4), offer a worktree with a risk line. Otherwise say why in one line. Never start one without a yes.
   - If a session is running in another conversation, say plainly that this conversation can't reach it: the user is the only messenger.
4. **Folding a task into another session** (instead of giving it its own):
   - into a `TODO` row: add a `## Folded in` section to that row's topic file, and set the folded row to `TODO (folded into X)`. Safe, because X reads its topic file when it starts. Risk: low.
   - into an `IN PROGRESS` row: only if the user confirms they'll pass it on to that conversation. Write the same section, and set the folded row to `TODO (folded into X, pending)`. Say in the risk line that X may already be past building. Risk: medium.
   - never mark a folded task done from outside the session that does it. Session X marks it done (or returns it to `TODO`) when it commits.

### 3. `next-session`
1. **Pick the queue.** With more than one open queue, use the one named in `next-session <Name>`, or ask. Read the queue file, the topic file of the first runnable `TODO` row, and the project memory. If only unplaced rows are left, ask the user to place them. If the last DONE row is missing its hash, add it. Skip `IN PROGRESS` rows and rows folded into another. If the main checkout has uncommitted changes, ask whether another conversation is running a session before starting here.
2. **Present the scope in one message:** the work, open questions, model, and branch (if any). In the same message, offer up to two parallel sessions (workflow 4), one line each with a risk line. The user decides based on workload and usage limits. Claim the row (`IN PROGRESS`, see Status).
3. Create the session branch if the mode calls for one.
4. If the session starts with its discussion, hold it, **wait for the user's decisions before building** (notify if on), and record them in the topic file.
   - **Split before building.** Once the plan is set (here, or at step 2 if there's no discussion), check whether any parts touch different files and don't depend on each other's design. If so, offer to split them off, with a risk line that says how sure you are they're independent. Each part run in parallel costs a cold start, a second run of the Checks, and a merge, so offer it only for parts big enough to be worth that. With a yes, give each part its own placed `TODO` row (not ordered after this one) and a topic file holding the decisions it needs, so it doesn't start with a discussion. Keep one part in this session, and offer the new rows per workflow 4.
5. Do the work, keeping the **Checks** clean.
6. **End of session:**
   - re-read the topic file and the queue row for items added since the session started (such as a `## Folded in` section). Do them, or ask the user to carry them over, before the rest of this list;
   - the Checks pass (give the counts);
   - the queue's code review has run on the diff, with findings applied or explained;
   - session notes are in the topic file;
   - memory (or the session notes) has a DONE note and a handoff;
   - the row says `IN PROGRESS <date> (waiting for approval)`;
   - a commit message is proposed (notify if on).

   After approval: commit, and merge if on a branch. Mark the row DONE (see Status), along with any rows folded into it that this session did. Name the next session and its model; if the model differs, tell the user to switch (`/model`) before typing `next-session`.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row (not folded into another) that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. Recommend at most two, because each one uses up limits faster and adds a merge.

**Running one** (`parallel-session <id>`, or a yes to an offer):
1. Make a worktree on branch `q/<id>-<slug>`:
   - **typed in a new conversation:** `EnterWorktree` (this conversation becomes the parallel session);
   - **from the conversation already running a session:** a background agent with `isolation: "worktree"`. Never `EnterWorktree` here, because it would move the current session. The agent leaves its work uncommitted in the worktree, since it can't ask for approval (see step 5).
2. Apply the queue's **Worktree setup**.
3. **Edit the queue, topic file, and memory in the main checkout by full path, touching only this session's row.** Claim it first (`IN PROGRESS`, see Status); for a background agent, the conversation that launched it does this. This applies whether or not the queue folder is committed: an untracked one isn't in the worktree, and editing a committed one's copy in the worktree conflicts at merge.
4. Run the Checks in the worktree.
5. **A background agent's work:** when it finishes, this session sends the notify if it's on, shows the diff and the Checks results, proposes a commit message, and after approval commits in the worktree.
6. **Merge only with approval,** after the main session has committed, by the branch-per-session steps in every mode (`--no-ff`, rerun the Checks on the merged result, delete the branch). Then remove the worktree.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed ("a record only");
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).
