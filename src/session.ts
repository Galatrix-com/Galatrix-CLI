/**
 * The pairing + command transport for the galatrix CLI (docs/CLI-BRIDGE-PLAN.md). Pure/testable: connects to
 * the editor-server relay, redeems a one-time code, then sends command lines and awaits their results. Stores
 * nothing — the ephemeral code is the only secret, and it lives only for this process.
 */
import { WebSocket } from 'ws'

export interface ResultLine { kind: 'cmd' | 'out' | 'err' | 'ok' | 'info'; text: string }

export interface CliSession {
  /** Send a command line to the editor; resolves with its output lines. */
  send(line: string): Promise<ResultLine[]>
  close(): void
  /** Fires when the relay ends the session (expiry / Stop / editor gone). */
  onClosed(cb: (reason: string) => void): void
}

/** Pair with a running editor via the relay. Rejects on a bad/expired code, IP mismatch, etc. */
export function connect(serverUrl: string, code: string): Promise<CliSession> {
  const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/cli-relay'
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try { ws = new WebSocket(wsUrl) } catch (e) { reject(e); return }
    let paired = false
    let nextId = 1
    const pending = new Map<number, (lines: ResultLine[]) => void>()
    const closedCbs: Array<(reason: string) => void> = []

    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello-cli', code })))
    ws.on('message', (raw) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(raw)) as Record<string, unknown> } catch { return }
      switch (m.type) {
        case 'paired':
          paired = true
          resolve({
            send: (line) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ type: 'cmd', id, line })) }),
            close: () => ws.close(),
            onClosed: (cb) => closedCbs.push(cb),
          })
          break
        case 'result': {
          const cb = pending.get(m.id as number)
          if (cb) { pending.delete(m.id as number); cb((m.lines as ResultLine[]) ?? []) }
          break
        }
        case 'closed':
          for (const cb of closedCbs) cb(String(m.reason ?? 'closed'))
          ws.close()
          break
        case 'error':
          if (!paired) reject(new Error(explain(String(m.error ?? 'error'))))
          break
      }
    })
    ws.on('error', (e) => { if (!paired) reject(e instanceof Error ? e : new Error(String(e))) })
    ws.on('close', () => { if (!paired) reject(new Error('connection closed before pairing')) })
  })
}

function explain(code: string): string {
  switch (code) {
    case 'bad_code': return 'the code was not recognized (already used, or wrong)'
    case 'code_expired': return 'the code has expired — generate a new one in the editor'
    case 'ip_mismatch': return 'your IP does not match the editor — run the CLI on the same machine/network'
    case 'rate_limited': return 'too many attempts — wait a minute and try again'
    case 'cli_must_not_be_browser': return 'this endpoint refused a browser-style connection'
    default: return code
  }
}
