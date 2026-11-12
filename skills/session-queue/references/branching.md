# Choosing a branching mode

Read this only when starting a queue, or when the user asks to change the mode. Present the table, recommend one option ★ for the user's situation, always by its full name, and give a risk line for each. Record the choice in the queue file's **Branching** line.

| | **Work on main** | **Branch per session**, merged when done | **Branch for risky sessions** (main otherwise) |
|---|---|---|---|
| **How it works** | Each session commits on main after approval | Each session works on `q/<id>-<slug>`; after approval it's merged into main and deleted | Main by default; a row marked **Branch** gets its own branch |
| **Pros** | Simplest. No merge step. The next session always starts from the latest code | Main always works. An abandoned session is just a deleted branch. Clean diffs to review. Fits pull requests and CI | Simple most of the time, with a safety net where it matters |
| **Cons** | A half-done session leaves main half-done. Undoing means reverting commits | A merge step per session. Conflicts if main moved on. Leftover branches if one isn't finished | Someone has to judge which sessions are risky. Two habits to follow |
| **Fits** | Solo work, small sessions, frequent checkpoints | Teams, CI or PR review, large or uncertain sessions | Solo work with an occasional big refactor, migration, or experiment |
| **Risk** | Medium if sessions get large; low otherwise | Low. The extra steps are mechanical | Low, if risky sessions are flagged when they're queued |

**How to recommend:**
- Solo, small sessions, no CI: ★ work on main, or ★ branch for risky sessions if some queued work is large or experimental.
- A team, pull requests, or CI: ★ branch per session.
- Unsure: ★ branch for risky sessions. It costs nothing until a session is flagged.

"Main" in this table means the repo's default branch, whatever it's called (often `main` or `master`). Use its real name when talking to the user.

**Either way:**
- Parallel sessions always get their own branch through their worktree, in every mode.
- Nothing is committed or merged without the user's approval.
