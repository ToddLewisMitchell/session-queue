// The values session-queue keeps in `$.state`: what the queue pane draws.

// One open row of a queue's session table, as the pane lists it: `isRunning`
// for an IN PROGRESS row, `isNext` for the row next-session would run.
export type PaneRow = { id: string; session: string; status: string; isNext: boolean; isRunning: boolean }
// One active queue: its name and its open rows, in table order.
export type PaneQueue = { name: string; rows: PaneRow[] }

declare module 'claude-code' {
  interface PluginState {
    'session-queue': { queues: Shaped<PaneQueue[]> }
  }
}
