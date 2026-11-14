# session-queue

**Save tokens and stay organized while working on a project with Claude Code!**

## Use

| You type | Claude does |
|---|---|
| "Start a queue for <goal>" | Checks for an open queue first, suggests goals from the repo, asks about git, branching, pace, and notifications in one go, then writes the queue file |
| "Add to the queue: <task>" | Writes a topic file and a row; offers to run it in parallel if that's safe |
| `next-session` | Runs the next placed TODO session (`next-session <name>` if you keep two queues) |
| `parallel-session <id>` | Runs that session in a git worktree alongside the current one |
| "Set the queue's pace to speed" | Switches between economy, balanced, and speed (see below) |
| "Where's the queue?" | Shows each open row, what runs next, and any paused or stale sessions, without changing anything |
| "Drop <task> from the queue" | Marks it dropped and keeps it on record |
| "Close the queue" | Closes it as a record and starts a successor with the open rows |

## Why use it
- **Pick up exactly where you left off.** Type `next-session` in any new conversation and Claude knows what's next, what was decided, and why. No re-explaining, no "where were we?"
- **Spend fewer tokens.** Each session starts fresh and reads only a short queue file and its own topic file. A long project doesn't turn into one ever-growing, ever-costlier conversation. See [How it keeps token use down](#how-it-keeps-token-use-down).
- **Decide before Claude builds.** Big choices come up as options, each with a ★ recommendation and a risk line, and nothing gets built until you've chosen. Less rework, fewer surprises.
- **You stay in charge.** Claude never commits, merges, or publishes without your approval, and suggests a commit message at the end of each session.
- **Quality doesn't slip.** Your tests, linters, and build checks must stay clean after every session, with a code review before each commit.
- **Pick your pace.** Economy runs one session at a time. Balanced offers up to two safe parallel sessions for your yes. Speed runs every safe session in parallel at once, and a ⚡ under the prompt reminds you it's on.
- **Nothing to run or host.** It's plain Markdown in your repo, readable and editable by you, and it works with Claude Code's own worktrees and memory.

## How it works
A Claude Code plugin for running a long project as a **queue of sessions**, kept in plain Markdown.

- A short **queue file** (`queues/queue-<name>.md`) holds the goal, the project's checks, how to set up a parallel worktree, and a table of sessions.
- One **topic file** per session holds its discussion, decisions, and notes.
- Type **`next-session`** and Claude reads both, presents the scope, waits for your go-ahead, does the work, keeps the checks green, and proposes a commit message. Sessions can **start with a discussion** to settle choices first.
- **Your choice of branching**, made when the queue starts after Claude explains the trade-offs:
  - work on main;
  - a branch per session, merged into main when you approve;
  - main, with a branch only for sessions flagged as risky.
- **A pace for parallel work**, chosen when the queue starts and changeable any time. It's shown under the prompt (`pace: economy`, `pace: balanced`, or `pace: ⚡ speed`):
  - **economy:** one session at a time, and a parallel session only when you type `parallel-session <id>`. Slowest overall, cheapest;
  - **balanced** (the default): when a session starts, or you add a task while one is running, Claude offers up to two independent sessions to run in parallel git worktrees, and splits of big independent parts. Nothing starts without your yes;
  - **speed:** every independent session starts in its own worktree at once, with no cap. Fastest, but it uses up limits soonest and leaves more merges to approve. Commits and merges still wait for you.
- **Running sessions are claimed.** A session marks its row `IN PROGRESS` with its stage (scope, discussion, building, or waiting for approval), so another conversation knows it's taken. Where the host lets sessions message each other, a conversation that changes a running session's topic file tells it right away. A task added to a running session keeps a placeholder row until it's done, and every session re-reads its topic file before proposing the commit, so a late addition isn't lost.
- **Sessions can stop early.** If a session hits a blocker, you stop it, or it's too big to finish in one conversation, Claude pauses it. Its notes say what's done and what's left, and the partial work goes on a branch or stays in place, as you choose, so the next `next-session` picks up from there. Checks that were already failing before a session started are recorded as a baseline, not blamed on it. Merge conflicts are shown to you and resolved only with your go-ahead.
- **Optional notifications.** Turn them on when the queue starts, and Claude sends a push when a session stops for your decision or approval. With Remote Control connected, it reaches your phone. Off by default, and never for routine progress. A session that dies from a usage limit or crash can't send one, so silence doesn't mean it's still working.

## Install
```
/plugin marketplace add ToddLewisMitchell/session-queue
/plugin install session-queue@session-queue
```

To try a local copy instead, point Claude Code at the folder: `/plugin marketplace add /path/to/session-queue`.

The pace flag under the prompt comes from a small hooks module in `hooks/`, written against Claude Code 2.1.322. On a version without hooks modules, the flag doesn't show; the rest of the plugin is unaffected.

## How it keeps token use down
Every token in a conversation's context is paid for again on every turn. A long project run as one long conversation gets more expensive with each step, and gets summarized and loses detail. This method keeps each session's context small and focused.

**Less to read at the start of each session**
- **Fresh session per queue item.** Each session starts with an empty context and reads only what it needs. Old conversations aren't carried forward.
- **A short queue file.** About 500 lines at most, with one line per session. Every session reads it, so it's kept small on purpose.
- **One topic file per session.** A session reads its own topic file, not every past discussion. Finished topics stay on disk but aren't loaded.
- **Closed queues are records.** When a queue is done or gets long, a successor carries over only the open rows. The old file isn't read again.
- **Short memory handoffs.** The next session learns where things stand from a few lines, not from re-reading the last conversation.

**Less work redone**
- **Decisions are written down.** A session doesn't re-derive or re-argue what a topic file records as decided.
- **Discussion first.** Every session shows its scope and waits for your go-ahead, and sessions marked "starts with its discussion" settle the choices first, so less work is built and then thrown away.
- **Spike before queueing.** A risky claim is checked in a small test first, before a whole session is planned around it.
- **Right-sized sessions.** Long plans are split so each session fits one conversation without being summarized midway.

**Less spent per step**
- **A model per session.** The Model column lets routine sessions run on a lighter model and saves the strongest one for the steps that need it.
- **Targeted edits.** The queue file is changed with small edits, never rewritten in full.
- **Parallel only as fast as you choose.** Parallel sessions don't use fewer tokens than running the same work one after another. Each one usually needs main merged in and the checks rerun, may conflict with another session, and needs its own worktree setup. A background agent also adds its report to the conversation that launched it. Economy runs none, balanced suggests at most two, and speed runs them all. Worktrees keep parallel sessions from clashing, which avoids redoing work after a conflict.

The savings depend on the project and haven't been measured. The biggest are usually the fresh session per item and the short queue file.

## Why not a kanban tool?
Boards like Vibe Kanban or Backlog.md handle the worktrees and the board, and do it well. This plugin is about the **method**:
- discussion first;
- risk lines;
- your approval before every commit and merge;
- a model for each session;
- handoffs that survive cleared context.

Use it with Claude Code's own worktree support.

## License
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): free to share and adapt with credit, for non-commercial purposes only, under the same license. It may not be sold. See `LICENSE`.
