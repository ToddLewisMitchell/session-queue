---
name: session-queue
description: Run a project as a Markdown queue of sessions (queue file + topic files, a go-ahead before building, discussion first, risk lines, approval before commits, a pace setting for parallel worktrees, and optional notifications). Use for `next-session`, `parallel-session <id>`, or starting, showing, adding to, reordering, dropping from, pausing, setting the pace of, or closing a queue (`prompts/prompt*.md`).
---

# Session queue

Long projects are split into **sessions**, each sized to fit one conversation. A short **queue file** says what's next. A **topic file** per session holds its discussion, plan, and notes. Every session starts from those files, so nothing depends on an earlier conversation.

## Files

```
<queue-dir>/                      default: prompts/
  prompt<Name>.md                 queue file: goal, project rules, session table
  <name>/<topic>.md               one topic file per session or to-do
```

- **Queue file: short** (≤ about 500 lines), because every session reads it all. Only what `templates/queue.md` holds.
- **Topic files: everything else.** The user's words, quoted and dated. Decisions, open questions, plans, and `## Session notes` appended by each session.
- **Git.** The queue file records whether its folder is committed (many users ignore `prompts/` because notes are private). Never stage an ignored queue folder.
- **Templates:** `templates/queue.md`, `templates/topic.md`.

**Session table:** `| # | Session | Topic file | Status | Model |`
- **#**: a short id (`1`, `2b`, `R3`). Never renumber; insert rows in order with a new id.
- **Status:** `TODO`, `TODO (placement not decided)` (the user must place it before it runs), `TODO (after X)` / `TODO (last)`, `TODO (folded into X, pending)` (workflow 2, step 4), `IN PROGRESS <date> (<stage>; <session>)`, `PAUSED <date> (<why>; <where the partial work is>)` (workflow 3, Stopping early), `DROPPED <date> (<why>)` (workflow 2), or `**DONE <date>** (committed <hash>; outcome)`. In a committed queue folder, the hash isn't known until after the commit: write `DONE <date> (outcome)` in the session's commit, and the next session adds the hash.
- **IN PROGRESS is a claim.** A session sets its row to `IN PROGRESS <date> (<stage>; <session>)` when it starts. Stages: `scope` while it waits for the go-ahead (`discussion` if it starts with one), then `building` once the user says go, then `waiting for approval` once the commit is proposed. `<session>` is the name other conversations message it by (see **Messages between sessions**); it stays through every stage, and is left out if the host has no messaging. The row is how other conversations know it's taken, at what stage, and whom to tell. Treat any `IN PROGRESS` row as running. A crashed or abandoned session leaves a stale claim: only the user clears it (back to `TODO`, or `PAUSED` if it left partial work), so ask rather than take a claimed row over. If its named session isn't in `ListAgents`, say so when asking.
- **Model:** to switch, tell the user (`/model`) and **wait**. Never switch yourself, including by starting an agent on another model.

## Principles
1. **A risk line on every option and recommendation.** Mark the recommended one ★.
2. **Never commit, push, merge, or publish without the user's approval.** Propose a commit message instead.
3. **Every session waits for a go-ahead** after presenting its scope, even with nothing to decide. Sessions that "start with their discussion" also present choices with risk lines, and the go-ahead carries the decisions.
4. **Spike before queueing** a feasibility claim you can't verify. Split long plans into several sessions.
5. **Don't re-derive or re-litigate** what a topic file records as decided.
6. **Targeted edits only** to the queue file, never a full rewrite. Another session may be editing it.
7. **Document as you go:** remarks in code, decisions and notes in the topic file, and a one-line handoff in memory that replaces the last one (or, if the host has none, in the topic file's session notes).

## Branching
The user picks one of three modes when the queue starts. Always use the full mode names. Read `references/branching.md` only to explain the options, at queue start or when the user asks to change modes. Missing means **work on main**.

"Main" means the repo's default branch (often `main` or `master`). Find it with `git symbolic-ref refs/remotes/origin/HEAD`, or by which one exists. If both exist and there's no remote, ask.
- **work on main**: commit each session on main.
- **branch per session**: work on `q/<id>-<slug>` from an up-to-date main. After approval: commit, merge main in first if it moved on, rerun the Checks, merge into main (`--no-ff`), delete the branch.
- **branch for risky sessions**: main, except rows marked **Branch** (judged risky by the user or a topic file). Those follow branch per session.

An abandoned branch session leaves main untouched. Ask before deleting an unmerged branch.

**Merge conflicts:** stop. Show the conflicting files and a proposed resolution, with a risk line, and resolve only after the user says go. Then rerun the Checks before going on.

## Notifications
The queue's **Notify** line is `on` or `off`; missing means **off**. Offer it only if the host can push notifications (for example `PushNotification`, which reaches the phone when Remote Control is connected).

When it's on, send **one** notification each time a session stops and needs the user:
- a session waits for its go-ahead or its discussion's decisions;
- a commit or merge waits for approval;
- a parallel session is ready to merge;
- a model switch is needed;
- a blocker.

Never notify for routine progress.
- **Format:** one line, under 200 characters, leading with the session id and the action, e.g. `Queue 2b: commit ready for approval (checks green)`.
- **No private content:** no code or topic-file quotes, since the message can show on a lock screen.
- **"Not sent" is normal** (the user is at the terminal, or notifications are off). Don't retry.
- **Never approval:** a notification doesn't count as an answer. Still wait for one.

## Pace
The queue's **Pace** line is `economy`, `balanced`, or `speed`; missing means **balanced**. It sets how much runs in parallel (workflow 4). Keep the line's form, `**Pace.** <setting> (chosen <date>; ...)`: the plugin shows it under the prompt. Parallel sessions don't use fewer tokens than running the same rows one after another. They finish sooner, but use up limits faster, and each adds a cold start, its own Checks run, and a merge.
- **economy:** one session at a time. Don't offer parallel sessions or splits. Run one only when the user types `parallel-session <id>`. Slowest overall, cheapest.
- **balanced:** offer up to two parallel sessions, each with a risk line, wherever an offer comes up (the scope message, the end of a session, or a newly added task). Each starts only after a yes.
- **speed:** the setting is the user's standing yes. Wherever an offer would come up, start every eligible row instead, with no cap, each as a background agent, and say in one line which ones started and which were held back, and why. List eligible rows that start with their discussion or need another model for the user to open in new conversations. Offer splits for any independent part, not only big ones. Commits and merges still wait for approval. A usage limit can stop every running session at once; when the user is back, check the `IN PROGRESS` rows.

The user can change the Pace any time: a targeted edit of the line, with the date. It applies to offers from then on and doesn't stop running sessions.

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
**Read `references/start-queue.md` before asking the user anything.** It covers an existing open queue, the goal and name, git, branching, Pace, Notify, Checks, Worktree setup, and roll-overs from workflow 5.

### 2. Add a task
1. **Pick the queue** as in workflow 3, step 1. If the user chose to fold the task into another session, go to step 4 instead of steps 2–3. Otherwise, write a topic file from `templates/topic.md`: the user's words with the date, the placement, what's known, and open questions with ★ and risk lines.
2. Add a row with a targeted edit. Use `TODO (placement not decided)` unless the user gave a placement. Update the ordering notes if needed.
   - **Reordering** means editing Status constraints and the ordering notes. Never renumber.
   - **Dropping** a task, only on the user's word: set its row to `DROPPED <date> (<why>)` and keep the row and topic file as a record. For a task folded into a `TODO` or `PAUSED` row, take `+ <short title>` out of that row's Session cell and mark its `## Folded in` section dropped. If the row has partial work on a branch, ask before deleting the branch (see **Branching**). Never drop an `IN PROGRESS` row from outside its session; message it (see **Messages between sessions**), or let the user tell it.
3. **Parallel check.** A session is running if it runs in this conversation, has a worktree in `git worktree list`, or has an `IN PROGRESS` row. Uncommitted changes in the main checkout that this conversation didn't make may mean a session is running in another conversation: ask the user, don't infer. If this task could run alongside a running session (workflow 4), offer a worktree with a risk line, or start it, as the **Pace** says. Otherwise say why in one line. Never start one without a yes (in speed, the Pace is the yes).
   - A session in another conversation is reachable only by message (see **Messages between sessions**); without messaging, tell the user they're the messenger.
4. **Folding a task into another session X** (instead of giving it its own). This is the user's choice: Claude may suggest it, with ★ and a risk line, next to giving the task its own row, but only into the session running in this conversation or a `TODO` or `PAUSED` row. Never suggest folding into a session running in another conversation (an `IN PROGRESS` row this conversation doesn't own); the user can still ask for it. Write the task into X's topic file, not a topic file of its own. Add a `## Folded in` section there with the user's words and the date, what's known, and open questions with ★ and risk lines.
   - into the session running in this conversation: no row of its own and no message. Tell the user it's added to this session's scope. Risk: low.
   - into a `TODO` or `PAUSED` row: no row of its own. Add `+ <short title>` to X's Session cell, so the table still shows it. Safe, because X reads its topic file when it starts or resumes. Risk: low.
   - into an `IN PROGRESS` row in another conversation: leave X's row as it is (its session owns it). Add a placeholder row `TODO (folded into X, pending)` whose topic file is X's, and message X (see **Messages between sessions**). If there's no messaging, the claim names no session, or that session isn't in `ListAgents`, write nothing until the user confirms they'll pass it on to that conversation. Say in the risk line that X may already be past building; the placeholder keeps the task from being lost if so. Risk: medium.
   - X settles a pending row when it commits: DONE if it did the task, or back to `TODO` with the section moved into a topic file of its own. The only other change allowed is the sender returning it to `TODO` when X replies "too late" (see **Messages between sessions**). Never mark it done from outside X.

### 3. `next-session`
1. **Pick the queue.** With more than one open queue, use the one named in `next-session <Name>`, or ask. Read the queue file, the topic file of the first runnable `TODO` or `PAUSED` row, and the project memory. If only unplaced rows are left, ask the user to place them. Skip `IN PROGRESS` and `DROPPED` rows, and rows folded into another. A `PAUSED` row resumes from its session notes and partial work, in its worktree or on its branch, and finishes by the branch-per-session steps in every mode. If it paused on a blocker, ask whether it's cleared. If the main checkout has uncommitted changes, ask whether another conversation is running a session before starting here.
   - **Missing hash:** if the last DONE row has no commit hash, find its commit with `git log` and add `committed <hash>;` to it. Do this first, even if the session then stops to ask something.
2. **Present the scope in one message:** the work, open questions, model, and branch (if any). In the same message, handle parallel sessions as the **Pace** says (workflow 4), one line each with a risk line. Claim the row (`IN PROGRESS`, see Status), then **wait for the user's go-ahead before building** (notify if on). Their reply also answers any parallel offers.
3. After the go-ahead, set the stage to `building`, and create the session branch if the mode calls for one.
4. If the session starts with its discussion, the go-ahead waits for the user's decisions. Record them in the topic file.
   - **Split before building.** Once the plan is set (here, or at step 2 if there's no discussion), check whether any parts touch different files and don't depend on each other's design. If so, offer to split them off, with a risk line that says how sure you are they're independent. Offer it only for parts big enough to repay a cold start, another Checks run, and a merge (in speed, any independent part; in economy, don't offer it). With a yes, give each part its own placed `TODO` row (not ordered after this one) and a topic file holding the decisions it needs, so it doesn't start with a discussion. Keep one part in this session, and offer the new rows per workflow 4.
5. Do the work, keeping the **Checks** clean. If they're quick, run them first for a baseline. A Check that fails without this session's changes (in the baseline run, or on the starting commit): say so, record it in the session notes, and leave it unless the user says to fix it. If a message says this session's topic file or row changed, re-read it, and tell the user about any new task before building it (see **Messages between sessions**).
6. **End of session:**
   - re-read the topic file and the queue row for items added since the session started (such as a `## Folded in` section). Do them, or ask the user to carry them over, before the rest of this list;
   - the Checks pass, or fail only as the recorded baseline did (give the counts);
   - the code review named in the Checks (e.g. `/code-review`) has run on the diff, with findings applied or explained. Reading the diff yourself doesn't count. If it can't run here, say so in the commit proposal and ask whether to commit without it;
   - session notes are in the topic file;
   - memory (or the session notes) has the one-line handoff, saying DONE;
   - the row says `IN PROGRESS <date> (waiting for approval; <session>)`;
   - a commit message is proposed (notify if on).

   After approval: commit, and merge if on a branch. Mark the row DONE (see Status), and settle any pending rows folded into it (workflow 2, step 4). Name the next session and its model; if the model differs, tell the user to switch (`/model`) before typing `next-session`.

**Stopping early.** On a blocker, when the user stops it, or when it can't finish before the conversation is summarized, pause instead of pushing on (notify if on):
- **Partial work:** ask where it goes. ★ A work-in-progress commit on the session's branch (`q/<id>-<slug>`, created now if the mode had none, then switch back to main), so main stays clean. Risk: low. Or leave it uncommitted in place. Risk: medium, because the next session in this checkout starts on top of it. A parallel session's work stays in its worktree.
- **Session notes:** what's done, what's left, why it stopped, and where the partial work is. Memory gets the one-line handoff.
- **Row:** `PAUSED <date> (<why>; <where the partial work is>)`. Pending rows folded into it stay pending; it settles them when it commits after resuming.

### 4. Parallel sessions in git worktrees
**Eligible:** a placed `TODO` row (not folded into another) that isn't ordered after the current session, and whose files don't overlap the current session's (judged from both topic files and `git status`). **Say how sure you are.** A row that starts with its discussion can't run as a background agent (it can't ask the user), so offer it only for a new conversation. The same goes for a row whose Model differs from this conversation's: a background agent runs on this conversation's model, so never give it another, and in the new conversation the user switches with `/model`. For other rows, the user's yes to the offer (or, in speed, the Pace) is the agent's go-ahead; in a new conversation, present the scope and wait as in workflow 3, step 2. How many to offer or start is set by the **Pace**.

**Running one** (`parallel-session <id>`, a yes to an offer, or the speed Pace):
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
1. mark it closed: a line `Closed <date>, a record only.` under the title;
2. start a successor with the open rows (workflow 1, as a roll-over);
3. point the memory at the new file (only this queue's entry, if there are two).

### 6. Show the queue
For "where's the queue?" or similar. Read only the queue file and `git worktree list`; change nothing. Show each open row (id, title, status), what `next-session` would run next and on which model, any `PAUSED` reasons, and any `IN PROGRESS` claim whose named session isn't in `ListAgents` (possibly stale; without messaging, say you can't tell). With two open queues, show both, or the one the user named.
