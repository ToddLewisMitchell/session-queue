# Start a queue (workflow 1)

Read this when the user starts a queue, or when workflow 5 rolls one over. Section and workflow numbers refer to `SKILL.md`.

Where the host has a multiple-choice tool (e.g. `AskUserQuestion`), use it for each choice below: the ★ option first, labelled "(Recommended)", with its risk line in the description.

**On a roll-over,** ask only step 2, and carry over the rest (a `Waits for` line too) unless the user changes it.

**With a queue already open,** the new one copies the settings of the queue it waits for (else the one the user named, or the only open one; with two that differ, ask which) and asks only step 2 and how it runs beside it (step 1). The folder's git status, Branching, Parallels, Go-ahead, Commits, Clear, Notify, Checks, and Worktree setup carry over with today's date. List them in one line, and say the user can change any one now or later (`/queue-<setting>`, or by asking).

1. **An open queue already exists?** (Skip on a roll-over.) Name it and its open rows, and ask, unless the user already said (e.g. "a queue I'll start after this one"):
   - ★ **add to it** (workflow 2), when the goal matches. Risk: low.
   - **close it and roll over** (workflow 5). Risk: low.
   - **start one that runs after it:** the new queue gets the `Waits for` line (`SKILL.md`, **Files**), so `next-session` keeps running the open one until it closes. Risk: low.
   - **start a second queue alongside:** both active, so a bare `next-session` asks which. Risk: medium, because the overlap check (workflow 4) only compares rows within one queue.
   Rows the user wants in the new queue move there (workflow 2, **Moving**).
2. **Goal and name.** Wait for the answer. With the tool, offer up to three goals inferred from the repo (its name, README, recent commits, open issues), each with a queue name; the user can type their own. With nothing to infer from, ask in plain text. Names are lowercase and hyphenated (`bug-fixes`). Never overwrite an existing `queue-<name>.md`.
3. **Then, in two calls** (the tool takes four questions at most): first the queue folder, branching, Parallels, and Notify; then Go-ahead, Commits, and Clear.
   - whether the queue folder is committed;
   - the **branching mode**, using the comparison in `branching.md` (next to this file). Text written before the dialog may be hidden while it's open, so put each mode's column (how it works, pros, cons, risk) in that option's preview. Without the tool, show the table in the message;
   - **Parallels**: how much runs in parallel (see **Parallels** in `SKILL.md`). Options:
     - **off:** one session at a time, slowest overall but cheapest. Risk: low.
     - ★ **ask:** up to two parallel offers, each needing a yes. Risk: low.
     - **auto:** every eligible row starts at once, fastest but uses up limits soonest, with more merges to approve. Risk: medium.
   - **Go-ahead:** ★ **ask** (wait for a go-ahead every session; Risk: low), or **auto** (start building at once when there's nothing to decide; Risk: low, because any question still stops it).
   - **Commits:** ★ **approve** (Risk: low), or **auto** (commit and merge without waiting when the Checks and code review pass; Risk: medium, because a bad change can reach main unseen). Pushing always asks.
   - **Clear:** ★ **auto** (`next-session` clears a used conversation first; Risk: low), or **off** (keep the conversation; Risk: low, but costs more tokens).
   - **Notify**, only if the host can push notifications (default off). Tell the user its limit: a session that dies from a usage limit, crash, or closed terminal can't send anything, so silence doesn't mean it's still working.
4. **Checks and Worktree setup:** ask only what the answers and the repo leave unknown (`worktree-setup.md`, next to this file).
5. Write `queue-<name>.md` from `../templates/queue.md`.
6. If the host has memory, make a project memory naming the queue file (both, with two open queues, saying which waits) and `next-session`.
