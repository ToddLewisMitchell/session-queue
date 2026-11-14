# Running a parallel session (workflow 4)

Read this before starting a parallel session: `parallel-session <id>`, `next-session` beside a session in the main checkout (workflow 3, step 1), a yes to an offer, or the speed Pace. Section and workflow numbers refer to `SKILL.md`; eligibility is in its workflow 4.

1. Make a worktree on branch `q/<id>-<slug>`:
   - **typed in a new conversation** (either command): `EnterWorktree` (this conversation becomes the parallel session);
   - **from the conversation already running a session:** a background agent with `isolation: "worktree"`. Never `EnterWorktree` here, because it would move the current session. The worktree's branch gets a generated name, so the agent's prompt starts with `git switch -c q/<id>-<slug>`. The agent leaves its work uncommitted in the worktree, since it can't ask for approval (see step 5).
2. Apply the queue's **Worktree setup**.
3. **Edit the queue and topic file in the main checkout by full path, touching only this session's row.** Claim it first (`IN PROGRESS`, see Status); for a background agent, the conversation that launched it does this, under its own name. This applies whether or not the queue folder is committed: an untracked one isn't in the worktree, and editing a committed one's copy in the worktree conflicts at merge. Leave memory alone: the handoff goes in the session notes (Principle 7).
4. Run the Checks in the worktree.
5. **A background agent's work:** when it finishes, this session sends the notify if it's on, shows the diff and the Checks results, proposes a commit message, and after approval commits in the worktree.
6. **Merge only with approval,** after the main session has committed, by the branch-per-session steps in every mode (`--no-ff`, rerun the Checks on the merged result, delete the branch). In a committed queue folder, this session's row and topic file edits are still uncommitted in the main checkout: merge with `--no-commit`, mark the row DONE, stage only this session's edits (`git add -p`), then commit. Then remove the worktree.
