# <Project> <name> queue

<Successor to `queue-<previous>.md` (closed <date>, a record only).> `next-session` runs from this file.

**Goal.** <One sentence.>

**How the queue runs.** With the `session-queue` skill (workflows, principles, parallel sessions). Only this project's specifics are below. The queue folder is <committed | ignored by git: never stage it>.

**Memory.** The handoff is one line in the `<memory-name>` memory, replaced each session <or, if the host has none, in each topic file's session notes>.

**Branching.** <work on main | branch per session | branch for risky sessions> (chosen <date>; see the skill's Branching section).

**Pace.** <economy | balanced | speed> (chosen <date>; see the skill's Pace section).

**Go-ahead.** <ask | auto: start building without waiting when there's nothing to decide> (chosen <date>; see the skill's Go-ahead, Commits, and Clear section).

**Commits.** <approve | auto: commit and merge without waiting when the Checks and review pass> (chosen <date>; see the skill's Go-ahead, Commits, and Clear section).

**Clear.** <auto: clear the conversation when I type next-session | off> (chosen <date>; see the skill's Go-ahead, Commits, and Clear section).

**Notify.** <off | on: push a notification when a session stops for my decision or approval> (chosen <date>; see the skill's Notifications section).

## Checks
Keep at 0 / green after every session:
- <tests, e.g. `pytest`>
- <linters / type checks>
- <build warnings>
- A <medium> `/code-review` of each session's diff before its commit.

## Worktree setup
For a parallel session in a git worktree:
- <State: e.g. set `APP_DATA_DIR` to a folder of its own>
- <Ports: e.g. use ports other than 5173 / 5000>
- <Dependencies: e.g. the main checkout's `.venv` by full path; `npm ci` only if the frontend is touched>

## Sessions

| # | Session | Topic file | Status | Model |
|---|---|---|---|---|
| 1 | <What it does>. **Starts with its discussion** | `<name>/<topic>.md` | TODO | <model> |
| 2 | <What it does> | `<name>/<topic>.md` | TODO | <model> |
| 3 | <What it does>. **Branch** (risky: <why>) | `<name>/<topic>.md` | TODO (after 1) | <model> |

<Ordering notes, e.g. "2 and 4 don't depend on each other. 5 comes last.">
