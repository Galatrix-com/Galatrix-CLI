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
    let ended = false // a relay 'closed' (with its reason) beats the raw socket close that follows it
    let nextId = 1
    const pending = new Map<number, (lines: ResultLine[]) => void>()
    const closedCbs: Array<(reason: string) => void> = []
    // Keepalive: a little traffic keeps NATs/proxies from idling the socket out, and a send failure
    // surfaces a dead connection promptly instead of on the user's next command.
    const hb = setInterval(() => { if (ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify({ type: 'ping' })) } catch { /* close handler reports */ } } }, 25_000)
    const end = (reason: string) => {
      if (ended) return
      ended = true
      clearInterval(hb)
      // Flush in-flight sends so an awaited command never hangs on a dead socket.
      for (const [, res] of pending) res([{ kind: 'err', text: `connection lost before a result arrived (${reason})` }])
      pending.clear()
      for (const cb of closedCbs) cb(reason)
    }

    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello-cli', code })))
    ws.on('message', (raw) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(raw)) as Record<string, unknown> } catch { return }
      switch (m.type) {
        case 'paired':
          paired = true
          resolve({
            send: (line) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ type: 'cmd', id, line })) }),
            close: () => { ended = true; clearInterval(hb); ws.close() },
            onClosed: (cb) => closedCbs.push(cb),
          })
          break
        case 'result': {
          const cb = pending.get(m.id as number)
          if (cb) { pending.delete(m.id as number); cb((m.lines as ResultLine[]) ?? []) }
          break
        }
        case 'closed':
          end(String(m.reason ?? 'closed'))
          ws.close()
          break
        case 'error':
          if (!paired) reject(new Error(explain(String(m.error ?? 'error'))))
          break
      }
    })
    ws.on('error', (e) => { if (!paired) reject(e instanceof Error ? e : new Error(String(e))) })
    ws.on('close', () => {
      clearInterval(hb)
      if (!paired) { reject(new Error('connection closed before pairing')); return }
      // A raw drop (relay restart, network) — the WINDOW usually survives it, so say how to get back in.
      end('connection lost — your code stays valid for the window; re-run: galatrix pair ' + code)
    })
  })
}

function explain(code: string): string {
  switch (code) {
    case 'bad_code': return 'the code was not recognized (window closed, or wrong code)'
    case 'session_expired': return 'the window has ended — Start a new one in the editor (Settings → Expose to CLI)'
    case 'already_paired': return 'another CLI is already attached to this window — close it first (one at a time)'
    case 'ip_mismatch': return 'your IP does not match the editor — run the CLI on the same machine/network'
    case 'rate_limited': return 'too many attempts — wait a minute and try again'
    case 'cli_must_not_be_browser': return 'this endpoint refused a browser-style connection'
    default: return code
  }
}
