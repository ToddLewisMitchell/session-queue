# session-queue

**Save tokens and stay organized while working on a project with Claude Code!**

## Install
```
/plugin marketplace add ToddLewisMitchell/session-queue
/plugin install session-queue@session-queue
```

To try a local copy instead, point Claude Code at the folder: `/plugin marketplace add /path/to/session-queue`.

The flags under the prompt, the automatic `/clear` before `next-session`, the queue files attached to `next-session`, the commit guard, and the `/queue` commands come from a small hooks module in `hooks/`, written against Claude Code 2.1.322 (the clear, the attached files, the guard, and the commands against 2.1.328). On a version without hooks modules, none of them happens; the rest of the plugin is unaffected.

## Use

| You type | Claude does |
|---|---|
| "Start a queue for <goal>" | Checks for an open queue first, suggests goals from the repo, asks about git, branching, pace, and notifications in one go, then writes the queue file |
| "Add to the queue: <task>" | Places it where it fits best (or folds it into a related session) without asking, and tells you where and why (a list is placed task by task); writes a topic file and a row, or adds it to that session's topic file |
| `next-session` | Runs the next placed TODO session (`next-session <name>` if you keep two queues) |
| `parallel-session <id>` | Runs that session in a git worktree alongside the current one |
| "Set the queue's pace to speed" | Switches between economy, balanced, and speed (see below) |
| "Turn on auto go-ahead" / "Turn on auto-commit" | Skips the wait when there's nothing to decide / commits without asking when the checks and review pass (see below) |
| "Where's the queue?" | Shows each open row, what runs next, and any paused or stale sessions, without changing anything |
| "Drop <task> from the queue" | Marks it dropped and keeps it on record |
| "Close the queue" | Closes it as a record and starts a successor with the open rows |

## Why use it
- **Pick up exactly where you left off.** Type `next-session` in any new conversation and Claude knows what's next, what was decided, and why. No re-explaining, no "where were we?"
- **Spend fewer tokens.** Each session starts fresh and reads only a short queue file and its own topic file. A long project doesn't turn into one ever-growing, ever-costlier conversation. See [How it keeps token use down](#how-it-keeps-token-use-down).
- **Decide before Claude builds.** Real choices come up as options, each with a ★ recommendation and a risk line (for example, "Risk: medium, because the next session starts on top of uncommitted work"), and nothing gets built until you've chosen. Choices Claude can settle itself are stated plainly, not dressed up as questions. Less rework, fewer surprises.
- **You stay in charge.** Claude never commits, merges, or publishes without your approval, and suggests a commit message at the end of each session, unless you turn on auto-commit. Pushing and publishing always ask.
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
- **A pace for parallel work**, chosen when the queue starts and changeable any time. It's shown under the prompt (`pace: economy`, `pace: balanced`, or `pace: ⚡ speed`; with two open queues on different paces, each queue's name and pace):
  - **economy:** one session at a time, and a parallel session only when you type `parallel-session <id>`. Slowest overall, cheapest;
  - **balanced** (the default): only when `next-session` presents a session's scope, Claude offers up to two independent sessions to run in parallel git worktrees, and splits of big independent parts. Nothing starts without your yes;
  - **speed:** every independent session starts in its own worktree at once, with no cap. Fastest, but it uses up limits soonest and leaves more merges to approve. Commits and merges still wait for you.
- **Running sessions are claimed.** A session marks its row `IN PROGRESS` with its stage (scope, discussion, building, or waiting for approval), so another conversation knows it's taken. Typing `next-session` in a second conversation names the running session, picks the next free row, and checks that the two can't clash. If the running one holds the main checkout, the new one runs in its own worktree, after your yes. Where the host lets sessions message each other, a conversation that changes a running session's topic file tells it right away. A task added to a running session keeps a placeholder row until it's done, and every session re-reads its topic file before proposing the commit, so a late addition isn't lost.
- **Sessions can stop early.** If a session hits a blocker, you stop it, or it's too big to finish in one conversation, Claude pauses it. Its notes say what's done and what's left, and the partial work goes on a branch or stays in place, as you choose, so the next `next-session` picks up from there. Checks that were already failing before a session started are recorded as a baseline, not blamed on it. Merge conflicts are shown to you and resolved only with your go-ahead.
- **Fewer stops, if you want them** (each off by default, and shown under the prompt when on):
  - **auto go-ahead:** a session with nothing to decide starts building right after showing its scope. Any question, model switch, or parallel offer still waits for you;
  - **auto-commit:** at the end of a session, Claude commits (and merges, in branch modes) without asking, but only when the checks pass and the code review is clean. A failing check, an unresolved finding, or a merge conflict still stops for you.
- **Commits that can't slip through.** While a queue is open, a git command that makes a commit or a merge (`commit`, `merge`, `pull`, `cherry-pick`, `revert`, `am`, or `rebase`) brings up a permission dialog unless auto-commit is on, and a `git push` always does. A subagent's commit, merge, or push is refused (a background session leaves committing to you), and so is force-staging a `queues/` folder that git ignores. Claude still asks you in the conversation first; the dialog is the backstop.
- **A fresh context for every session.** Typing `next-session` in a conversation that's already been used clears it first (`/clear`), then runs `next-session` in the empty one. It won't clear while a background session is still running there. Turn it off per queue with the Clear setting.
- **A quicker start.** `next-session` arrives with the queue file and the next session's topic file already attached, so Claude doesn't spend tool calls reading them.
- **Settings and status without a model turn.** `/queue` shows the open sessions, what `next-session` runs next, and the settings. `/queue-pace`, `/queue-go-ahead`, `/queue-commits`, `/queue-clear`, and `/queue-notify` change one setting in the queue file (for example `/queue-pace speed`; add the queue's name when two are open). `/queue-pane` opens the same list in a pane beside the chat that updates after every turn, with the next session marked. `next-session` works in any case (`Next-session` too).
- **Optional notifications.** Turn them on when the queue starts, and Claude sends a push when a session stops for your decision or approval. With Remote Control connected, it reaches your phone. Off by default, and never for routine progress. A session that dies from a usage limit or crash can't send one, so silence doesn't mean it's still working.

## How it keeps token use down
Every token in a conversation's context is paid for again on every turn. A long project run as one long conversation gets more expensive with each step, and gets summarized and loses detail. This method keeps each session's context small and focused.

**Less to read at the start of each session**
- **Fresh session per queue item.** Each session starts with an empty context (`next-session` clears the old one for you) and reads only what it needs. Old conversations aren't carried forward.
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

## Testing
`test/test_skill.py` is an end-to-end test of the skill. Each scenario builds a throwaway git repo, runs `claude -p` in it with this plugin loaded, and checks the queue, files, and git state it leaves behind. A small model grades the wording of replies.

```
python3 test/test_skill.py --list           # scenario names and descriptions
python3 test/test_skill.py --changed --dry  # scenarios your edits affect, with a cost estimate
python3 test/test_skill.py resume skip      # run scenarios by name
```

It needs the `claude` CLI on your PATH, and it runs on your own login: the full suite costs about $5. Sandboxes and transcripts go in `test/runs/`, which git ignores.

## License
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): free to share and adapt with credit, for non-commercial purposes only, under the same license. It may not be sold. See `LICENSE`.
