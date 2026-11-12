# <Project> <name> queue

<Successor to `prompt<Previous>.md` (closed <date>, a record only).> `next-session` runs from this file.

**Goal.** <One sentence.>

**How the queue runs.** With the `session-queue` skill (workflows, principles, parallel sessions). Only this project's specifics are below. The queue folder is <committed | ignored by git: never stage it>.

**Memory.** Handoffs go in the `<memory-name>` memory.

**Branching.** <work on main | branch per session | branch for risky sessions> (chosen <date>; see the skill's Branching section).

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
| 2 | <What it does> | `<name>/<topic>.md` | TODO (placement not decided) | <model> |
| 3 | <What it does>. **Branch** (risky: <why>) | `<name>/<topic>.md` | TODO (after 1) | <model> |

<Ordering notes, e.g. "The order of 2–4 is for the user to set. 5 comes last.">
