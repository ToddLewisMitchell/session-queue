# Worktree setup: what to ask for

Read this only when starting a queue, to fill in the queue file's **Worktree setup**. A parallel session in a git worktree needs its own copy of anything that can clash:

- **State:** the data folder or database the app writes to, and how to point a second copy elsewhere.
- **Ports:** the dev servers' ports, and how to change them.
- **Dependencies:** whether the virtualenv or `node_modules` can be shared by path, or must be installed per worktree (for example, native binaries for another OS).
- **Singletons:** anything that allows only one running copy per machine.
