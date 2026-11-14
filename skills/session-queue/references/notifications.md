# Notifications

Read this at the start of a session whose queue has **Notify** on. Workflow numbers refer to `SKILL.md`. The host must be able to push notifications (for example `PushNotification`, which reaches the phone when Remote Control is connected).

Send **one** notification each time a session stops and needs the user:
- a session waits for its go-ahead or its discussion's decisions;
- a commit or merge waits for approval;
- a parallel session is ready to merge;
- a model switch is needed;
- a blocker, or the session pauses (workflow 3, Stopping early).

Never notify for routine progress.
- **Format:** one line, under 200 characters, leading with the session id, its short name (`SKILL.md` Principle 8), and the action, e.g. `Queue 2b (sync fix): commit ready for approval (checks green)`.
- **No private content:** no code or topic-file quotes, since the message can show on a lock screen.
- **"Not sent" is normal** (the user is at the terminal, or notifications are off). Don't retry.
- **Never approval:** a notification doesn't count as an answer. Still wait for one.
