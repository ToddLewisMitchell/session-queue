// The values session-queue keeps in `$.state`: what the queue pane and the
// settings display draw, and the commit guard's records.

// One open row of a queue's session table, as the pane lists it: `isRunning`
// for an IN PROGRESS row, `isNext` for the row next-session would run.
export type PaneRow = { id: string; session: string; status: string; isNext: boolean; isRunning: boolean }
// One active queue: its name and its open rows, in table order.
export type PaneQueue = { name: string; rows: PaneRow[] }

// One active queue's settings lines, as the footer and the pane show them.
export type QueueSettings = {
  name: string
  parallels: 'off' | 'ask' | 'auto'
  goAhead: 'ask' | 'auto'
  commits: 'approve' | 'auto'
  clear: 'auto' | 'off'
  notify: 'on' | 'off'
}

declare module 'claude-code' {
  interface PluginState {
    // `approved`: whether the user's latest message approved a commit (guard.ts).
    // `settings`: the active queues' settings (settings-state.ts).
    // `autoCommits`: the tool_use_ids of the Bash calls the guard let commit
    // or merge because Commits is `auto`, for the note on their rows.
    'session-queue': {
      queues: Shaped<PaneQueue[]>
      approved: Shaped<boolean>
      settings: Shaped<QueueSettings[]>
      autoCommits: Shaped<string[]>
    }
  }
}
