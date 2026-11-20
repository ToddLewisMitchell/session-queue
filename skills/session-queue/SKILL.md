---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, a go-ahead before building, discussion first, risk lines, approval before commits, optional auto go-ahead and auto-commit, a Parallels setting for parallel worktrees, and optional notifications). Use for `next-session`, `parallel-session <id>`, or starting, showing, adding to, reordering, dropping from, pausing, changing the settings of, or closing a queue (`queues/queue-*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan, and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
queues/                           always this name, at the project root (the plugin looks only here)
  queue-<name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Queue file: short** (≤ about 500 lines), because every session reads it all. Only what `templates/queue.md` holds.
- **Topic files: everything else.** The user's words, quoted and dated. Decisions, open questions, plans, and `## Session notes` appended by each session.
- **Active queue.** A queue started to run after another has a line under its title, `Waits for queue-<name>.md: starts when it closes.` While that queue is open, the waiting one isn't active. Every other open queue is active.
- **Git.** The queue file records whether its folder is committed (many users ignore `queues/` because notes are private). Never stage an ignored queue folder. In a committed one, stage only this session's own edits (`git add -p`), never another session's claim or notes.
- **Templates:** `templates/queue.md`, `templates/topic.md`.
- **The user may edit these files by hand.** Their edits are authoritative: never undo or "repair" one unasked. If the table or a Status can't be read as below, a topic file named in the table is missing, or a queue file isn't at `queues/queue-<name>.md` (renamed, or the folder moved), stop and ask rather than guess.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber. **Rows are in run order** (`next-session` takes the first runnable one), so insert or move a row to where it runs; ids may end up out of sequence.
- **Status:** `TODO`, `TODO (placement not decided)` (held by the user; doesn't run until placed), `TODO (after X)` / `TODO (last)`, `TODO (folded into X, pending)` (workflow 2, step 4), `IN PROGRESS <date> (<stage>; <session>)`, `PAUSED <date> (<why>; <where the partial work is>)` (workflow 3, Stopping early), `DROPPED <date> (<why>)` (workflow 2), or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit (a parallel session's: in its merge commit), then add `committed <hash>;` right away and commit just that line as `Record <id>'s commit hash`. The session's approval covers this follow-up commit, so the session ends with nothing left uncommitted.
- **IN PROGRESS is a claim.** A session sets its row to `IN PROGRESS <date> (<stage>; <session>)` when it starts. Stages: `scope` while it waits for the go-ahead (`discussion` if it starts with one), then `building` once the user says go, then `waiting for approval` once the commit is proposed. `<session>` is the name other conversations message it by (see **Messages between sessions**); it stays through every stage, and is left out if the host has no messaging. The row is how other conversations know it's taken, at what stage, and whom to tell. Treat any `IN PROGRESS` row as running. A crashed or abandoned session leaves a stale claim: only the user clears it (back to `TODO`, or `PAUSED` if it left partial work), so ask rather than take a claimed row over. If its named session isn't in `ListAgents`, say so when asking.
- **Model:** to switch, tell the user (`/model`) and **wait**. Never switch yourself, including by starting an agent on another model.

## Principles
1. **Ask only real questions:** ones whose answer changes what gets built and that the topic file, the code, or a sensible default can't settle. Give options only when a reasonable user might pick each of at least two (no strawman to make a pair), each with a risk line, the recommended one ★. Spell out each option as a reply the user can give (not "that"), never as a command such as `next-session` or `parallel-session <id>`: a command starts a workflow and doesn't answer the question. State your own choices plainly ("I'll compute it in the existing route"), not as options, with a risk line only when the risk isn't low.
2. **Never commit, push, merge, or publish without the user's approval,** except the commits and merges the **Commits** setting allows. Propose a commit message instead. Where the plugin's hooks module runs, it enforces this while a queue is open: a commit or merge brings up a permission dialog unless **Commits** is `auto` or the user's latest message was a short approval (such as "commit", or "yes" to a commit proposal), a push always does, and a subagent's commit, merge, or push is refused. The dialog is a backstop: still wait for the user's approval in the conversation before running the command.
3. **Every session waits for a go-ahead** after presenting its scope, even with nothing to decide (say "Nothing to decide"), unless the **Go-ahead** setting is `auto`. Sessions that "start with their discussion" present their questions (Principle 1), and the go-ahead carries the decisions.
4. **Spike before queueing** a feasibility claim you can't verify. Split long plans into several sessions.
5. **Don't re-derive or re-litigate** what a topic file records as decided.
6. **Targeted edits only** to the queue file, never a full rewrite. Another session may be editing it.
7. **Document as you go:** remarks in code, decisions and notes in the topic file, and a one-line handoff in memory that replaces the last one (or, if the host has none, in the topic file's session notes). A parallel session writes its handoff in its session notes instead, so it can't overwrite another's.
8. **Name sessions, not just ids.** The user doesn't have the table open. Everywhere outside the queue file (replies, questions, commit proposals, notifications, and messages), follow each session id with a short name of two to four words from its Session cell, every time it appears, not just the first: "R22 (CSV export) waits for R19 (date parser)", never "R22 waits for R19".

## Branching
The user picks one of three modes when the queue starts. Always use the full mode names. Read `references/branching.md` only to explain the options, at queue start or when the user asks to change modes. Missing means **work on main**.

"Main" means the repo's default branch (often `main` or `master`). Find it with `git symbolic-ref refs/remotes/origin/HEAD`, or by which one exists. If both exist and there's no remote, ask.
- **work on main**: commit each session on main.
- **branch per session**: work on `q/<id>-<slug>` from an up-to-date main. After approval: commit, merge main in first if it moved on, rerun the Checks, merge into main (`--no-ff`), delete the branch.
- **branch for risky sessions**: main, except rows marked **Branch** (judged risky by the user or a topic file). Those follow branch per session.

An abandoned branch session leaves main untouched. Ask before deleting an unmerged branch.

**Merge conflicts:** stop. Show the conflicting files and a proposed resolution, with a risk line, and resolve only after the user says go. Then rerun the Checks before going on.

## Notifications
The queue's **Notify** line is `on` or `off`; missing means **off**. When it's on, read `references/notifications.md` at the start of the session. A notification never counts as approval.

## Parallels
The queue's **Parallels** line is `off`, `ask`, or `auto`; missing means **ask**. It sets how much runs in parallel (workflow 4). Keep the line's form, `**Parallels.** <setting> (chosen <date>; ...)`: the plugin shows it under the prompt. An older queue's **Pace** line means the same: `economy` is `off`, `balanced` is `ask`, and `speed` is `auto`. Parallel sessions don't use fewer tokens than running the same rows one after another. They finish sooner but use up limits faster. Each one usually needs main merged in and the Checks rerun, may conflict with another session, and needs its own Worktree setup. A background agent also adds its report to the conversation that launched it.
- **off:** one session at a time. Don't offer parallel sessions or splits. Run one only when the user types `parallel-session <id>`. Slowest overall, cheapest.
- **ask:** offer the best one or two eligible rows outright, each as a yes-or-no with a risk line; don't say you're "not offering" when a row is eligible, or list rows you don't offer. With none eligible, say why in one line. Each starts only after a yes.
- **auto:** the setting is the user's standing yes. Where `ask` would offer, start every eligible row instead, with no cap, each as a background agent, and say in one line which ones started and which were held back, and why. List eligible rows that start with their discussion or need another model for the user to open in new conversations. Offer splits for any independent part, not only big ones. Commits and merges still wait for approval (unless **Commits** is `auto`). A usage limit can stop every running session at once; when the user is back, check the `IN PROGRESS` rows.

**When:** only in `next-session`'s scope message (workflow 3, step 2). Never unasked anywhere else: not at the end of a session, and not when a task is added.

The user can change the Parallels setting any time: a targeted edit of the line (an older **Pace** line becomes a **Parallels** line), with the date. It applies to offers from then on and doesn't stop running sessions.

## Go-ahead, Commits, and Clear
Three more queue lines, kept in the form `**<Name>.** <setting> (chosen <date>; ...)` because the plugin reads them. The user can change one any time: a targeted edit, with the date.

Where the plugin's hooks module runs, the user can also change any settings line with a slash command (`/queue-parallels`, `/queue-go-ahead`, `/queue-autocommit`, `/queue-autoclear`, or `/queue-notify`, then the value and, with two active queues, the queue's name) and see the queue with `/queue` (workflow 6). These edit or read the queue file with no model turn: don't redo a change one reports.

**Go-ahead:** `ask` or `auto`; missing means **ask**. With `auto`, the plugin shows `auto go-ahead` under the prompt, and a session whose scope message has nothing for the user to answer goes straight on to building (workflow 3, step 4), without waiting or notifying. It still waits when there's anything to answer: a question (Principle 1), a model switch, a parallel or split offer, a `PAUSED` row's blocker, another running session or stale claim, or a session that starts with its discussion.

**Commits:** `approve` or `auto`; missing means **approve**. With `auto`, the plugin shows `auto-commit` under the prompt. When the end-of-session list (workflow 3, step 6) is complete, the session commits without waiting, merges where the branching mode or a parallel session calls for one, and then tells the user the commit message and hash. It still stops for approval when a Check fails beyond the recorded baseline, the code review couldn't run or left a finding unresolved, the end-of-session re-read found new items or changed decisions, or a merge conflicts. A work-in-progress commit when pausing still asks (**Stopping early**), in the conversation, since with `auto` the plugin brings up no dialog for it. Pushing and publishing always need approval.

**Clear:** `auto` or `off`; missing means **auto**. With `auto`, the plugin's hooks module runs `/clear` when the user types `next-session` in a conversation that already has messages, and then runs `next-session` in the fresh conversation. It skips the clear while a background agent of that conversation is still running. A session never runs `/clear` itself. On a host without hooks modules, `auto` does nothing.

## Messages between sessions
Some hosts let one conversation message another on the same machine (for example, `ListAgents` to find sessions and `SendMessage` to send). A session learns its own name from `ListAgents` and writes it in its claim. Without messaging, the user is the only messenger.

When a conversation changes something a running session needs (a task folded in; a decision, correction, or question added to its topic file; a change to its row's scope or placement), it messages the session named in that row's claim. **Read `references/messaging.md`** before sending or answering a message, folding a task into an `IN PROGRESS` row in another conversation, or settling a `TODO (folded into X, pending)` row.

## Workflows

### 1. Start a queue
**Read `references/start-queue.md` before asking the user anything.** It covers an existing open queue, the goal and name, git, branching, Parallels, Notify, Checks, Worktree setup, and roll-overs from workflow 5.

### 2. Add a task
1. **Pick the queue:** the one the user named, else the active queue; with two active queues, ask.
   - **Place it yourself.** Never ask where it goes, or to confirm your choice. The user's placement wins; otherwise pick the best from the topic files and the code: its own row, ordered by dependencies and shared files, or folded into another session (step 4) when that's clearly better (e.g. a small task in the same files). Tell the user in one line where it went and why, with a risk line if the risk isn't low.
   - **Several tasks at once:** place each one separately, by the rule above. New tasks that belong together can share a session: give the first its own row and fold the others into it. Tell the user where each went, one line per task.
   - If it's folded, go to step 4 instead of steps 2–3. Otherwise, write a topic file from `templates/topic.md`: the user's words with the date, the placement and why, what's known, and open questions (Principle 1; none is fine).
2. Add a row at the chosen place with a targeted edit (`TODO`, or `TODO (after X)` / `TODO (last)`). Use `TODO (placement not decided)` only if the user asks to hold it. Update the ordering notes if needed.
   - **Reordering** means moving the row's line to its new place, then updating any Status constraints and ordering notes it contradicts. `DONE` and `DROPPED` rows stay put.
   - **Moving** a task to another queue, on the user's word: give it a row there (placed as in step 1) and move its topic file into that queue's folder. Set the old row to `DROPPED <date> (moved to queue-<name>.md as <id>)`, its Topic file cell pointing at the new path. An `IN PROGRESS` row isn't moved from outside its session.
   - **Dropping** a task, only on the user's word: set its row to `DROPPED <date> (<why>)` and keep the row and topic file as a record. For a task folded into a `TODO` or `PAUSED` row, take `+ <short title>` out of that row's Session cell and mark its `## Folded in` section dropped. If the row has partial work on a branch, ask before deleting the branch (see **Branching**). Never drop an `IN PROGRESS` row from outside its session; message it (see **Messages between sessions**), or let the user tell it.
3. **No parallel offer.** Adding a task never offers or starts a parallel session, whatever the Parallels setting (see Parallels, **When**).
4. **Folding a task into another session X** (instead of giving it its own). On your own (step 1), fold only into the session running in this conversation or a `TODO` row; into a `PAUSED` row only when the user asks, since it widens work already under way. Never fold into, or suggest folding into, a session running in another conversation (an `IN PROGRESS` row this conversation doesn't own) unless the user asks. Write the task into X's topic file, not a topic file of its own. Add a `## Folded in` section there with the user's words and the date, what's known, and open questions (Principle 1).
   - into the session running in this conversation: no row of its own and no message. Tell the user it's added to this session's scope. Risk: low.
   - into a `TODO` or `PAUSED` row: no row of its own. Add `+ <short title>` to X's Session cell, so the table still shows it. Safe, because X reads its topic file when it starts or resumes. Risk: low.
   - into an `IN PROGRESS` row in another conversation: a placeholder row and a message (`references/messaging.md`). Risk: medium, because X may already be past building.

### 3. `next-session`
1. **Pick the queue:** the one the user named (`next-session docs` runs `queue-docs.md`), else the active queue (see **Files**), without asking. Only with two active queues, ask. Read the queue file, the topic file of the first runnable `TODO` or `PAUSED` row, and the project memory. Where the plugin's hooks module runs, the prompt arrives with the queue file and the first `TODO` or `PAUSED` row's topic file attached: don't read them again, except to check for changes or before editing one. If only unplaced rows are left, ask the user to place them. Skip `IN PROGRESS` and `DROPPED` rows, and rows folded into another. A `PAUSED` row resumes from its session notes and partial work, in its worktree or on its branch, and finishes by the branch-per-session steps in every mode. If it paused on a blocker, ask whether it's cleared. If the main checkout has uncommitted changes (other than an untracked `.claude/worktrees/`), ask whether another conversation is running a session before starting here.
   - **Another session running:** if an `IN PROGRESS` row isn't this conversation's, name it to the user (it may be stale; see Status). Check the picked row could run beside each one (as in workflow 4: not ordered after it, no overlapping files), saying how sure you are; if not, say why and ask whether to wait. A running session with no worktree in `git worktree list` holds the main checkout: with a yes, run this one as a parallel session (`references/parallel-sessions.md`), never beside it there.
   - **Missing hash:** if the last DONE row has no commit hash (its session stopped before recording it), find its commit with `git log` and add `committed <hash>;` to it. Do this first, even if the session then stops to ask something.
2. **Claim the row** (`IN PROGRESS`, see Status), re-reading it first: if another conversation claimed it since step 1, go back to step 1. **Present the scope in one message:** the work, with your own choices stated plainly; the questions for the user, or "Nothing to decide" (Principle 1); the model; and the branch (if any). In the same message, handle parallel sessions as the **Parallels** setting says (workflow 4), one line each with a risk line. Then **wait for the user's go-ahead before building** (notify if on), unless **Go-ahead** is `auto` and nothing needs an answer. Their reply also answers any parallel offers.
3. If the session starts with its discussion, the go-ahead waits for the user's decisions. Record them in the topic file.
   - **Split before building.** In the scope message (step 2), check whether any parts touch different files and don't depend on each other's design. If so, offer to split them off, with a risk line that says how sure you are they're independent. Offer it only for parts big enough to repay a cold start, another Checks run, and a merge (with Parallels `auto`, any independent part; with `off`, don't offer it). With a yes, give each part its own placed `TODO` row (not ordered after this one) and a topic file holding the decisions it needs, so it doesn't start with a discussion. Keep one part in this session, and offer the new rows per workflow 4. A session that starts with its discussion offers no splits unless the user asks.
4. After the go-ahead, re-read the topic file and the row, and raise any change made since step 2 with the user before building. Then set the stage to `building`, and create the session branch if the mode calls for one.
5. Do the work, keeping the **Checks** clean. If they're quick, run them first for a baseline. A Check that fails without this session's changes (in the baseline run, or on the starting commit): say so, record it in the session notes, and leave it unless the user says to fix it. If a message says this session's topic file or row changed, re-read it, and tell the user about any new task before building it (see **Messages between sessions**).
6. **End of session:**
   - re-read the topic file and the queue row for changes since the go-ahead (such as a `## Folded in` section or a hand edit). Do new items or ask the user to carry them over, and raise changed decisions with the user, before the rest of this list;
   - the Checks pass, or fail only as the recorded baseline did (give the counts);
   - the code review named in the Checks (e.g. `/code-review`) has run on the diff, with findings applied or explained. Reading the diff yourself doesn't count. If it can't run here, say so in the commit proposal and ask whether to commit without it;
   - session notes are in the topic file;
   - the one-line handoff, saying DONE, is written (Principle 7);
   - the row says `IN PROGRESS <date> (waiting for approval; <session>)`, and a commit message is proposed (notify if on). With **Commits** `auto` and nothing to stop for, skip both and commit now.

   After approval (or with **Commits** `auto`): commit, and merge if on a branch. Mark the row DONE and settle any pending rows folded into it (`references/messaging.md`), then record the hash (see Status). Name the next session and its model. Unless **Clear** is `auto`, suggest `/clear` before typing `next-session`, so the next session starts from the queue files rather than this conversation; if the model differs, also tell the user to switch (`/model`) first.

**Stopping early.** On a blocker, when the user stops it, or when it can't finish before the conversation is summarized, pause instead of pushing on (notify if on):
- **Partial work:** ask where it goes. ★ A work-in-progress commit on the session's branch (`q/<id>-<slug>`, created now if the mode had none, then switch back to main), so main stays clean. Leave the queue folder out of that commit, so the `PAUSED` row stays on main. Risk: low. Or leave it uncommitted in place. Risk: medium, because the next session in this checkout starts on top of it. A parallel session's work stays in its worktree.
- **Session notes:** what's done, what's left, why it stopped, and where the partial work is. Write the one-line handoff (Principle 7).
- **Row:** `PAUSED <date> (<why>; <where the partial work is>)`. Pending rows folded into it stay pending; it settles them when it commits after resuming.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row (not folded into another) that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. The same goes for a row whose Model differs from this conversation's: a background agent runs on this conversation's model, so never give it another, and in the new conversation the user switches with `/model`. For other rows, the user's yes to the offer (or, with Parallels `auto`, the setting) is the agent's go-ahead; in a new conversation, present the scope and wait as in workflow 3, step 2. How many to offer or start is set by the **Parallels** setting.

**Running one** (`parallel-session <id>`, `next-session` beside a session in the main checkout, a yes to an offer, or Parallels `auto`): read `references/parallel-sessions.md` first.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed: a line `Closed <date>, a record only.` under the title;
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).

A queue waiting for the closed one: on a roll-over, point its `Waits for` line at the successor, so it keeps waiting. Otherwise it becomes active: tell the user it's next, and point the memory at it.

### 6. Show the queue
For "where's the queue?" or similar. Read only the queue file, `git worktree list`, and `ListAgents` (if the host has it); change nothing. Show each open row (id, title, status), what `next-session` would run next and on which model, any `PAUSED` reasons, and any `IN PROGRESS` claim whose named session isn't in `ListAgents` (possibly stale; without messaging, say you can't tell). With two open queues, show the one the user named, else each active one, then any waiting one (what it waits for).
