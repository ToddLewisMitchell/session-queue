---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, a go-ahead before building, discussion first, risk lines, approval before commits, a pace setting for parallel worktrees, and optional notifications). Use for `next-session`, `parallel-session <id>`, or starting, showing, adding to, reordering, dropping from, pausing, setting the pace of, or closing a queue (`prompts/prompt*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan, and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
<queue-dir>/                      default: queues/
  queue-<name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Queue file: short** (≤ about 500 lines), because every session reads it all. Only what `templates/queue.md` holds.
- **Topic files: everything else.** The user's words, quoted and dated. Decisions, open questions, plans, and `## Session notes` appended by each session.
- **Git.** The queue file records whether its folder is committed (many users ignore `queues/` because notes are private). Never stage an ignored queue folder. In a committed one, stage only this session's own edits (`git add -p`), never another session's claim or notes.
- **Templates:** `templates/queue.md`, `templates/topic.md`.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber; insert rows in order with a new id.
- **Status:** `TODO`, `TODO (placement not decided)` (the user must place it before it runs), `TODO (after X)` / `TODO (last)`, `TODO (folded into X, pending)` (workflow 2, step 4), `IN PROGRESS <date> (<stage>; <session>)`, `PAUSED <date> (<why>; <where the partial work is>)` (workflow 3, Stopping early), `DROPPED <date> (<why>)` (workflow 2), or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit (a parallel session's: in its merge commit), and the next session adds the hash.
- **IN PROGRESS is a claim.** A session sets its row to `IN PROGRESS <date> (<stage>; <session>)` when it starts. Stages: `scope` while it waits for the go-ahead (`discussion` if it starts with one), then `building` once the user says go, then `waiting for approval` once the commit is proposed. `<session>` is the name other conversations message it by (see **Messages between sessions**); it stays through every stage, and is left out if the host has no messaging. The row is how other conversations know it's taken, at what stage, and whom to tell. Treat any `IN PROGRESS` row as running. A crashed or abandoned session leaves a stale claim: only the user clears it (back to `TODO`, or `PAUSED` if it left partial work), so ask rather than take a claimed row over. If its named session isn't in `ListAgents`, say so when asking.
- **Model:** to switch, tell the user (`/model`) and **wait**. Never switch yourself, including by starting an agent on another model.

## Principles
1. **Ask only real questions:** ones whose answer changes what gets built and that the topic file, the code, or a sensible default can't settle. Give options only when a reasonable user might pick each of at least two (no strawman to make a pair), each with a risk line, the recommended one ★. State your own choices plainly ("I'll compute it in the existing route"), not as options, with a risk line only when the risk isn't low.
2. **Never commit, push, merge, or publish without the user's approval.** Propose a commit message instead.
3. **Every session waits for a go-ahead** after presenting its scope, even with nothing to decide (say "Nothing to decide"). Sessions that "start with their discussion" present their questions (Principle 1), and the go-ahead carries the decisions.
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

## Pace
The queue's **Pace** line is `economy`, `balanced`, or `speed`; missing means **balanced**. It sets how much runs in parallel (workflow 4). Keep the line's form, `**Pace.** <setting> (chosen <date>; ...)`: the plugin shows it under the prompt. Parallel sessions don't use fewer tokens than running the same rows one after another. They finish sooner but use up limits faster. Each one usually needs main merged in and the Checks rerun, may conflict with another session, and needs its own Worktree setup. A background agent also adds its report to the conversation that launched it.
- **economy:** one session at a time. Don't offer parallel sessions or splits. Run one only when the user types `parallel-session <id>`. Slowest overall, cheapest.
- **balanced:** offer up to two parallel sessions, each with a risk line, wherever an offer comes up (the scope message, the end of a session, or a newly added task). Each starts only after a yes.
- **speed:** the setting is the user's standing yes. Wherever an offer would come up, start every eligible row instead, with no cap, each as a background agent, and say in one line which ones started and which were held back, and why. List eligible rows that start with their discussion or need another model for the user to open in new conversations. Offer splits for any independent part, not only big ones. Commits and merges still wait for approval. A usage limit can stop every running session at once; when the user is back, check the `IN PROGRESS` rows.

The user can change the Pace any time: a targeted edit of the line, with the date. It applies to offers from then on and doesn't stop running sessions.

## Messages between sessions
Some hosts let one conversation message another on the same machine (for example, `ListAgents` to find sessions and `SendMessage` to send). A session learns its own name from `ListAgents` and writes it in its claim. Without messaging, the user is the only messenger.

When a conversation changes something a running session needs (a task folded in; a decision, correction, or question added to its topic file; a change to its row's scope or placement), it messages the session named in that row's claim. **Read `references/messaging.md`** before sending or answering a message, folding a task into an `IN PROGRESS` row in another conversation, or settling a `TODO (folded into X, pending)` row.

## Workflows

### 1. Start a queue
**Read `references/start-queue.md` before asking the user anything.** It covers an existing open queue, the goal and name, git, branching, Pace, Notify, Checks, Worktree setup, and roll-overs from workflow 5.

### 2. Add a task
1. **Pick the queue:** with more than one open queue, the one the user named, or ask. If the user chose to fold the task into another session, go to step 4 instead of steps 2–3. Otherwise, write a topic file from `templates/topic.md`: the user's words with the date, the placement (never list folding into a session running in another conversation as an option; see step 4), what's known, and open questions (Principle 1; none is fine).
2. Add a row with a targeted edit. Use `TODO (placement not decided)` unless the user gave a placement. Update the ordering notes if needed.
   - **Reordering** means editing Status constraints and the ordering notes. Never renumber.
   - **Dropping** a task, only on the user's word: set its row to `DROPPED <date> (<why>)` and keep the row and topic file as a record. For a task folded into a `TODO` or `PAUSED` row, take `+ <short title>` out of that row's Session cell and mark its `## Folded in` section dropped. If the row has partial work on a branch, ask before deleting the branch (see **Branching**). Never drop an `IN PROGRESS` row from outside its session; message it (see **Messages between sessions**), or let the user tell it.
3. **Parallel check.** A session is running if it runs in this conversation, has a worktree in `git worktree list`, or has an `IN PROGRESS` row. Uncommitted changes in the main checkout that this conversation didn't make (other than an untracked `.claude/worktrees/`) may mean a session is running in another conversation: ask the user, don't infer. If this task could run alongside a running session (workflow 4), offer a worktree with a risk line, or start it, as the **Pace** says. Otherwise say why in one line. Never start one without a yes (in speed, the Pace is the yes).
   - A session in another conversation is reachable only by message (see **Messages between sessions**); without messaging, tell the user they're the messenger.
4. **Folding a task into another session X** (instead of giving it its own). This is the user's choice: Claude may suggest it, with ★ and a risk line, next to giving the task its own row, but only into the session running in this conversation or a `TODO` or `PAUSED` row. Never suggest folding into a session running in another conversation (an `IN PROGRESS` row this conversation doesn't own), not even as an alternative; the user can still ask for it. Write the task into X's topic file, not a topic file of its own. Add a `## Folded in` section there with the user's words and the date, what's known, and open questions (Principle 1).
   - into the session running in this conversation: no row of its own and no message. Tell the user it's added to this session's scope. Risk: low.
   - into a `TODO` or `PAUSED` row: no row of its own. Add `+ <short title>` to X's Session cell, so the table still shows it. Safe, because X reads its topic file when it starts or resumes. Risk: low.
   - into an `IN PROGRESS` row in another conversation: a placeholder row and a message (`references/messaging.md`). Risk: medium, because X may already be past building.

### 3. `next-session`
1. **Pick the queue.** With more than one open queue, use the one the user named (`next-session docs` runs `queue-docs.md`), or ask. Read the queue file, the topic file of the first runnable `TODO` or `PAUSED` row, and the project memory. If only unplaced rows are left, ask the user to place them. Skip `IN PROGRESS` and `DROPPED` rows, and rows folded into another. A `PAUSED` row resumes from its session notes and partial work, in its worktree or on its branch, and finishes by the branch-per-session steps in every mode. If it paused on a blocker, ask whether it's cleared. If the main checkout has uncommitted changes (other than an untracked `.claude/worktrees/`), ask whether another conversation is running a session before starting here.
   - **Another session running:** if an `IN PROGRESS` row isn't this conversation's, name it to the user (it may be stale; see Status). Check the picked row could run beside each one (as in workflow 4: not ordered after it, no overlapping files), saying how sure you are; if not, say why and ask whether to wait. A running session with no worktree in `git worktree list` holds the main checkout: with a yes, run this one as a parallel session (`references/parallel-sessions.md`), never beside it there.
   - **Missing hash:** if the last DONE row has no commit hash, find its commit with `git log` and add `committed <hash>;` to it. Do this first, even if the session then stops to ask something.
2. **Claim the row** (`IN PROGRESS`, see Status), re-reading it first: if another conversation claimed it since step 1, go back to step 1. **Present the scope in one message:** the work, with your own choices stated plainly; the questions for the user, or "Nothing to decide" (Principle 1); the model; and the branch (if any). In the same message, handle parallel sessions as the **Pace** says (workflow 4), one line each with a risk line. Then **wait for the user's go-ahead before building** (notify if on). Their reply also answers any parallel offers.
3. If the session starts with its discussion, the go-ahead waits for the user's decisions. Record them in the topic file.
   - **Split before building.** Once the plan is set (here, or at step 2 if there's no discussion), check whether any parts touch different files and don't depend on each other's design. If so, offer to split them off, with a risk line that says how sure you are they're independent. Offer it only for parts big enough to repay a cold start, another Checks run, and a merge (in speed, any independent part; in economy, don't offer it). With a yes, give each part its own placed `TODO` row (not ordered after this one) and a topic file holding the decisions it needs, so it doesn't start with a discussion. Keep one part in this session, and offer the new rows per workflow 4.
4. After the go-ahead, set the stage to `building`, and create the session branch if the mode calls for one.
5. Do the work, keeping the **Checks** clean. If they're quick, run them first for a baseline. A Check that fails without this session's changes (in the baseline run, or on the starting commit): say so, record it in the session notes, and leave it unless the user says to fix it. If a message says this session's topic file or row changed, re-read it, and tell the user about any new task before building it (see **Messages between sessions**).
6. **End of session:**
   - re-read the topic file and the queue row for items added since the session started (such as a `## Folded in` section). Do them, or ask the user to carry them over, before the rest of this list;
   - the Checks pass, or fail only as the recorded baseline did (give the counts);
   - the code review named in the Checks (e.g. `/code-review`) has run on the diff, with findings applied or explained. Reading the diff yourself doesn't count. If it can't run here, say so in the commit proposal and ask whether to commit without it;
   - session notes are in the topic file;
   - the one-line handoff, saying DONE, is written (Principle 7);
   - the row says `IN PROGRESS <date> (waiting for approval; <session>)`;
   - a commit message is proposed (notify if on).

   After approval: commit, and merge if on a branch. Mark the row DONE (see Status), and settle any pending rows folded into it (`references/messaging.md`). Name the next session and its model; if the model differs, tell the user to switch (`/model`) before typing `next-session`.

**Stopping early.** On a blocker, when the user stops it, or when it can't finish before the conversation is summarized, pause instead of pushing on (notify if on):
- **Partial work:** ask where it goes. ★ A work-in-progress commit on the session's branch (`q/<id>-<slug>`, created now if the mode had none, then switch back to main), so main stays clean. Leave the queue folder out of that commit, so the `PAUSED` row stays on main. Risk: low. Or leave it uncommitted in place. Risk: medium, because the next session in this checkout starts on top of it. A parallel session's work stays in its worktree.
- **Session notes:** what's done, what's left, why it stopped, and where the partial work is. Write the one-line handoff (Principle 7).
- **Row:** `PAUSED <date> (<why>; <where the partial work is>)`. Pending rows folded into it stay pending; it settles them when it commits after resuming.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row (not folded into another) that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. The same goes for a row whose Model differs from this conversation's: a background agent runs on this conversation's model, so never give it another, and in the new conversation the user switches with `/model`. For other rows, the user's yes to the offer (or, in speed, the Pace) is the agent's go-ahead; in a new conversation, present the scope and wait as in workflow 3, step 2. How many to offer or start is set by the **Pace**.

**Running one** (`parallel-session <id>`, `next-session` beside a session in the main checkout, a yes to an offer, or the speed Pace): read `references/parallel-sessions.md` first.

### 5. Close or roll over
When the goal is met, the work moves to another goal, or the queue file passes about 500 lines:
1. mark it closed: a line `Closed <date>, a record only.` under the title;
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).

### 6. Show the queue
For "where's the queue?" or similar. Read only the queue file, `git worktree list`, and `ListAgents` (if the host has it); change nothing. Show each open row (id, title, status), what `next-session` would run next and on which model, any `PAUSED` reasons, and any `IN PROGRESS` claim whose named session isn't in `ListAgents` (possibly stale; without messaging, say you can't tell). With two open queues, show both, or the one the user named.
