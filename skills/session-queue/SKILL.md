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
- **Status:** `TODO`, `TODO (placement not decided)` (the user must place it before it runs), `TODO (after X)` / `TODO (last)`, `TODO (folded into X, pending)` (workflow 2, step 4), `IN PROGRESS <date> (<stage>; <session>)`, or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit, and the next session adds the hash.
- **IN PROGRESS is a claim.** A session sets its row to `IN PROGRESS <date> (<stage>; <session>)` when it starts. The stage is `discussion` or `building` at first, moves from `discussion` to `building` once the user decides, and becomes `waiting for approval` when the session proposes the commit. `<session>` is the name other conversations use to message this one (see **Messages between sessions**). It stays on the claim through every stage; leave it out if the host has no messaging. Other conversations can't see this one, so the row is how they know it's taken, at what stage, and whom to tell about changes. Treat any `IN PROGRESS` row as running. A crashed or abandoned session leaves a stale claim: only the user clears it (back to `TODO`), so ask rather than take a claimed row over. If the named session isn't in `ListAgents`, say so when asking ("session `<name>` isn't running"); the user still decides.
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

## Messages between sessions
Some hosts let one conversation message another on the same machine (for example, `ListAgents` to find sessions and `SendMessage` to send). A session learns its own name from `ListAgents` and writes it in its claim. Without messaging, the user is the only messenger.

When a conversation changes something that a running session needs, it messages the session named in that row's claim:
- a task folded in (workflow 2, step 4);
- a decision, correction, or question added to its topic file;
- a change to its row's scope or placement.

Rules:
- **The change goes in the files first.** The message only says what changed and where. Lead with the queue and session id, e.g. `Queue 2b: a task was folded in; re-read "## Folded in" in prompts/app/sync.md`. Write paths as plain text; `@` attaches nothing in a message.
- **Inform, never instruct.** Don't ask the other session to run, commit, approve, or delete anything; its user decides that.
- **Receiving:** if this session holds no such row (a reused name or a stale claim), reply saying so and ignore the message. Otherwise re-read the named section before going on. A new task or a change to a decision goes to the user in one line; if it has open questions, or changes what's already decided, wait for their answers before building it. If it's too late to act on (for example, the session is already past building), reply and say so (reply to the message's `from`), and raise it again at the end of the session.
- **Replies:** the sender passes any reply to its user in one line. On "too late", it also turns a pending placeholder row into the task's own `TODO` row, with the `## Folded in` section moved into a topic file of its own.
- **Sent isn't read.** The other session's user may have to approve the message first, or it may never arrive. If `ListAgents` doesn't show a session by that name, or the send fails, tell the user, who then becomes the messenger. The end-of-session re-read (workflow 3, step 6) is the backstop either way.
- **Background agents:** the conversation that launched one claims the row under its own name. It can't pass on open questions, since the agent can't ask the user: it gets the user's answers first, writes them into the topic file, and then tells the agent.

## Workflows

### 1. Start a queue
**Read `references/start-queue.md` before asking the user anything.** It covers an existing open queue, the goal and name, git, branching, Notify, Checks, Worktree setup, and roll-overs from workflow 5.

### 2. Add a task
1. **Pick the queue** as in workflow 3, step 1. If the user chose to fold the task into another session, go to step 4 instead of steps 2–3. Otherwise, write a topic file from `templates/topic.md`: the user's words with the date, the placement, what's known, and open questions with ★ and risk lines.
2. Add a row with a targeted edit. Use `TODO (placement not decided)` unless the user gave a placement. Update the ordering notes if needed.
   - **Reordering** means editing Status constraints and the ordering notes. Never renumber.
3. **Parallel check.** A session is running if it runs in this conversation, has a worktree in `git worktree list`, or has an `IN PROGRESS` row. Uncommitted changes in the main checkout that this conversation didn't make may mean a session is running in another conversation: ask the user, don't infer. If this task could run alongside a running session (workflow 4), offer a worktree with a risk line. Otherwise say why in one line. Never start one without a yes.
   - If a session is running in another conversation, this conversation can reach it only by a message (see **Messages between sessions**). Without messaging, say plainly that the user is the only messenger.
4. **Folding a task into another session X** (instead of giving it its own). This is the user's choice: Claude may suggest it, with ★ and a risk line, next to giving the task its own row. Write the task into X's topic file, not a topic file of its own. Add a `## Folded in` section there with the user's words and the date, what's known, and open questions with ★ and risk lines.
   - into the session running in this conversation: no row of its own and no message. Tell the user it's added to this session's scope. Risk: low.
   - into a `TODO` row: no row of its own. Add `+ <short title>` to X's Session cell, so the table still shows it. Safe, because X reads its topic file when it starts. Risk: low.
   - into an `IN PROGRESS` row: also add a placeholder row `TODO (folded into X, pending)` whose topic file is X's, and message X (see **Messages between sessions**). Without messaging, or if the claim names no session, do this only if the user confirms they'll pass it on to that conversation. Say in the risk line that X may already be past building; the placeholder keeps the task from being lost if so. Risk: medium.
   - X settles a pending row when it commits: DONE if it did the task, or back to `TODO` with the section moved into a topic file of its own. The only other change allowed is the sender returning it to `TODO` when X replies "too late" (see **Messages between sessions**). Never mark it done from outside X.

### 3. `next-session`
1. **Pick the queue.** With more than one open queue, use the one named in `next-session <Name>`, or ask. Read the queue file, the topic file of the first runnable `TODO` row, and the project memory. If only unplaced rows are left, ask the user to place them. If the last DONE row is missing its hash, add it. Skip `IN PROGRESS` rows and rows folded into another. If the main checkout has uncommitted changes, ask whether another conversation is running a session before starting here.
2. **Present the scope in one message:** the work, open questions, model, and branch (if any). In the same message, offer up to two parallel sessions (workflow 4), one line each with a risk line. The user decides based on workload and usage limits. Claim the row (`IN PROGRESS`, see Status).
3. Create the session branch if the mode calls for one.
4. If the session starts with its discussion, hold it, **wait for the user's decisions before building** (notify if on), and record them in the topic file.
   - **Split before building.** Once the plan is set (here, or at step 2 if there's no discussion), check whether any parts touch different files and don't depend on each other's design. If so, offer to split them off, with a risk line that says how sure you are they're independent. Each part run in parallel costs a cold start, a second run of the Checks, and a merge, so offer it only for parts big enough to be worth that. With a yes, give each part its own placed `TODO` row (not ordered after this one) and a topic file holding the decisions it needs, so it doesn't start with a discussion. Keep one part in this session, and offer the new rows per workflow 4.
5. Do the work, keeping the **Checks** clean. If a message says this session's topic file or row changed, re-read it, and tell the user about any new task before building it (see **Messages between sessions**).
6. **End of session:**
   - re-read the topic file and the queue row for items added since the session started (such as a `## Folded in` section). Do them, or ask the user to carry them over, before the rest of this list;
   - the Checks pass (give the counts);
   - the queue's code review has run on the diff, with findings applied or explained;
   - session notes are in the topic file;
   - memory (or the session notes) has a DONE note and a handoff;
   - the row says `IN PROGRESS <date> (waiting for approval; <session>)`;
   - a commit message is proposed (notify if on).

   After approval: commit, and merge if on a branch. Mark the row DONE (see Status), and settle any pending rows folded into it (workflow 2, step 4). Name the next session and its model; if the model differs, tell the user to switch (`/model`) before typing `next-session`.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row (not folded into another) that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. Recommend at most two, because each one uses up limits faster and adds a merge.

**Running one** (`parallel-session <id>`, or a yes to an offer):
1. Make a worktree on branch `q/<id>-<slug>`:
   - **typed in a new conversation:** `EnterWorktree` (this conversation becomes the parallel session);
   - **from the conversation already running a session:** a background agent with `isolation: "worktree"`. Never `EnterWorktree` here, because it would move the current session. The agent leaves its work uncommitted in the worktree, since it can't ask for approval (see step 5).
2. Apply the queue's **Worktree setup**.
3. **Edit the queue, topic file, and memory in the main checkout by full path, touching only this session's row.** Claim it first (`IN PROGRESS`, see Status); for a background agent, the conversation that launched it does this, under its own name. This applies whether or not the queue folder is committed: an untracked one isn't in the worktree, and editing a committed one's copy in the worktree conflicts at merge.
4. Run the Checks in the worktree.
5. **A background agent's work:** when it finishes, this session sends the notify if it's on, shows the diff and the Checks results, proposes a commit message, and after approval commits in the worktree.
6. **Merge only with approval,** after the main session has committed, by the branch-per-session steps in every mode (`--no-ff`, rerun the Checks on the merged result, delete the branch). Then remove the worktree.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed ("a record only");
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).
