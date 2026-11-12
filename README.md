# session-queue

**Save tokens and stay organized while working on a project with Claude Code!**

## Why use it
- **Pick up exactly where you left off.** Type `next-session` in any new conversation and Claude knows what's next, what was decided, and why. No re-explaining, no "where were we?"
- **Spend fewer tokens.** Each session starts fresh and reads only a short queue file and its own topic file. A long project doesn't turn into one ever-growing, ever-costlier conversation. See [How it keeps token use down](#how-it-keeps-token-use-down).
- **Decide before Claude builds.** Big choices come up as options, each with a ★ recommendation and a risk line, and nothing gets built until you've chosen. Less rework, fewer surprises.
- **You stay in charge.** Claude never commits, merges or publishes without your approval, and suggests a commit message at the end of each session.
- **Quality doesn't slip.** Your tests, linters, and build checks must stay clean after every session, with a code review before each commit.
- **Go faster when you have room.** Claude points out which sessions can safely run in parallel git worktrees. You say yes or no depending on your workload and usage limits.
- **Nothing to run or host.** It's plain Markdown in your repo, readable and editable by you, and it works with Claude Code's own worktrees and memory.

## How it works
A Claude Code plugin for running a long project as a **queue of sessions**, kept in plain Markdown.

- A short **queue file** (`prompts/prompt<Name>.md`) holds the goal, the project's checks, how to set up a parallel worktree, and a table of sessions.
- One **topic file** per session holds its discussion, decisions, and notes.
- Type **`next-session`** and Claude reads both, presents the scope, does the work, keeps the checks green, and proposes a commit message. It never commits without your approval.
- Sessions can **start with a discussion**. Every option comes with a risk line and a ★ recommendation.
- **Your choice of branching**, made when the queue starts after Claude explains the trade-offs:
  - work on main;
  - a branch per session, merged into main when you approve;
  - main, with a branch only for sessions flagged as risky.
- When a session starts, or when you add a task while one is running, Claude **offers to run independent sessions in parallel git worktrees**. It's only an offer: you decide based on your workload and usage limits.
- **Optional notifications.** Turn them on when the queue starts, and Claude sends a push when a session stops for your decision or approval. With Remote Control connected, it reaches your phone. Off by default, and never for routine progress. A session that dies from a usage limit or crash can't send one, so silence doesn't mean it's still working.

## Install
```
/plugin marketplace add ToddLewisMitchell/session-queue
/plugin install session-queue@session-queue
```

To try a local copy instead, point Claude Code at the folder: `/plugin marketplace add /path/to/session-queue`.

## Use

| You type | Claude does |
|---|---|
| "Start a queue for <goal>" | Checks for an open queue first, suggests goals from the repo, asks about git, branching, and notifications in one go, then writes the queue file |
| "Add to the queue: <task>" | Writes a topic file and a row; offers to run it in parallel if that's safe |
| `next-session` | Runs the next placed TODO session (`next-session <Name>` if you keep two queues) |
| `parallel-session <id>` | Runs that session in a git worktree alongside the current one |
| "Close the queue" | Closes it as a record and starts a successor with the open rows |

## How it keeps token use down
Every token in a conversation's context is paid for again on every turn. A long project run as one long conversation gets more expensive with each step, and gets summarized and loses detail. This method keeps each session's context small and focused.

**Less to read at the start of each session**
- **Fresh session per queue item.** Each session starts with an empty context and reads only what it needs. Old conversations aren't carried forward.
- **A short queue file.** It holds only the goal, the project's checks, the worktree setup, and one line per session, at about 500 lines at most. Every session reads it, so it's kept small on purpose.
- **One topic file per session.** A session reads its own topic file, not every past discussion. Finished topics stay on disk but aren't loaded.
- **Closed queues are records.** When a queue is done or gets long, a successor carries over only the open rows. The old file isn't read again.
- **Short memory handoffs.** The next session learns where things stand from a few lines, not from re-reading the last conversation.

**Less work redone**
- **Decisions are written down.** A session doesn't re-derive or re-argue what a topic file records as decided.
- **Discussion first.** Sessions marked "starts with its discussion" settle the choices before building, so less work is built and then thrown away.
- **Spike before queueing.** A risky claim is checked in a small test first, before a whole session is planned around it.
- **Right-sized sessions.** Long plans are split so each session fits one conversation without being summarized midway.

**Less spent per step**
- **A model per session.** The Model column lets routine sessions run on a lighter model and saves the strongest one for the steps that need it.
- **Targeted edits.** The queue file is changed with small edits, never rewritten in full.
- **Parallel sessions only on offer.** At most one or two are suggested, each with a risk line, and you decide based on how close you are to your usage limits. Worktrees keep parallel sessions from clashing, which avoids redoing work after a conflict.

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
