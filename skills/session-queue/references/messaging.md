# Messages between sessions

Read this before sending or answering a message to another session, folding a task into an `IN PROGRESS` row in another conversation, or settling a `TODO (folded into X, pending)` row. Section and workflow numbers refer to `SKILL.md`.

## Sending and receiving
- **The change goes in the files first.** The message only says what changed and where. Lead with the queue, the session id, and its short name (`SKILL.md` Principle 8), e.g. `Queue 2b (sync fix): a task was folded in; re-read "## Folded in" in queues/app/sync.md`. Write paths as plain text; `@` attaches nothing in a message.
- **Inform, never instruct.** Don't ask the other session to run, commit, approve, or delete anything; its user decides that.
- **Receiving:** if this session holds no such row (a reused name or a stale claim), reply saying so and ignore the message. Otherwise re-read the named section before going on. A new task or a change to a decision goes to the user in one line; if it has open questions, or changes what's already decided, wait for their answers before building it. If it's too late to act on (for example, the session is already past building), reply and say so (reply to the message's `from`), and raise it again at the end of the session.
- **Replies:** the sender passes any reply to its user in one line. On "too late", it also turns a pending placeholder row into the task's own `TODO` row, with the `## Folded in` section moved into a topic file of its own.
- **Sent isn't read.** The other session's user may have to approve the message first, or it may never arrive. If `ListAgents` doesn't show a session by that name, or the send fails, tell the user, who then becomes the messenger. The end-of-session re-read (workflow 3, step 6) is the backstop either way.
- **Background agents:** the conversation that launched one claims the row under its own name. It can't pass on open questions, since the agent can't ask the user: it gets the user's answers first, writes them into the topic file, and then tells the agent.

## Folding into a session running in another conversation
Workflow 2, step 4, for an `IN PROGRESS` row X this conversation doesn't own. Only on the user's word; never suggest it.
- If there's no messaging, the claim names no session, or that session isn't in `ListAgents`, write nothing until the user confirms they'll pass it on to that conversation.
- Write the `## Folded in` section into X's topic file as workflow 2, step 4 says. Leave X's row as it is (its session owns it).
- Add a placeholder row `TODO (folded into X, pending)` whose topic file is X's, and message X.
- Say in the risk line that X may already be past building; the placeholder keeps the task from being lost if so. Risk: medium.

## Settling a pending row
X settles a pending row when it commits: DONE if it did the task, or back to `TODO` with the section moved into a topic file of its own. The only other change allowed is the sender returning it to `TODO` when X replies "too late" (see **Replies**). Never mark it done from outside X.
