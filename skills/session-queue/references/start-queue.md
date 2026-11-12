# Start a queue (workflow 1)

Read this when the user starts a queue, or when workflow 5 rolls one over. Section and workflow numbers refer to `SKILL.md`.

Where the host has a multiple-choice tool (e.g. `AskUserQuestion`), use it for each choice below: the ★ option first, labelled "(Recommended)", with its risk line in the description.
1. **An open queue already exists?** (Skip on a roll-over.) Name it and its open rows, and ask:
   - ★ **add to it** (workflow 2), when the goal matches. Risk: low.
   - **close it and roll over** (workflow 5). Risk: low.
   - **start a second queue alongside.** Risk: medium, because the overlap check (workflow 4) only compares rows within one queue.
2. **Goal and name.** Wait for the answer. With the tool, offer up to three goals inferred from the repo (its name, README, recent commits, open issues), each with a queue name; the user can type their own. With nothing to infer from, ask in plain text. Never overwrite an existing `prompt<Name>.md`.
3. **Then, in one call:**
   - whether the queue folder is committed;
   - the **branching mode** (first show the comparison from `branching.md`, next to this file, in a message);
   - **Notify**, only if the host can push notifications (default off). Tell the user its limit: a session that dies from a usage limit, crash or closed terminal can't send anything, so silence doesn't mean it's still working.
4. **Checks and Worktree setup:** ask only what the answers and the repo leave unknown (`worktree-setup.md`, next to this file).

   **On a roll-over,** ask only step 2, and carry over the rest unless the user changes it.
5. Write `prompt<Name>.md` from `../templates/queue.md`.
6. If the host has memory, make a project memory naming the queue file (both, with two open queues) and `next-session`.
