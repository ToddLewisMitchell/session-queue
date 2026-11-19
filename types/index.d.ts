// The values session-queue keeps in `$.state`: what the queue pane draws.

// One open row of a queue's session table, as the pane lists it.
export type PaneRow = { id: string; session: string; status: string; isNext: boolean }
// One open queue: its name and its open rows, in table order.
export type PaneQueue = { name: string; rows: PaneRow[] }

declare module 'claude-code' {
  interface PluginState {
    'session-queue': { queues: Shaped<PaneQueue[]> }
  }
}
