// Proves the CLI session transport (connect → pair → send → result) against a mock relay that speaks the same
// protocol as the real editor-server relay (whose own behavior is covered by editor-server's cliRelay.e2e).
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { connect } from '../src/session.js'

let failures = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) console.log(`  ok   ${name}`); else { console.log(`  FAIL ${name} ${extra}`); failures++ } }

// Mock relay: "GOOD" pairs and echoes commands; anything else is a bad code.
const server = http.createServer()
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, sock, head) => {
  if (new URL(req.url ?? '', 'http://x').pathname !== '/cli-relay') { sock.destroy(); return }
  wss.handleUpgrade(req, sock, head, (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw))
      if (m.type === 'hello-cli') ws.send(JSON.stringify(m.code === 'GOOD' ? { type: 'paired', sessionExpiresAt: Date.now() + 60_000 } : { type: 'error', error: 'bad_code' }))
      else if (m.type === 'cmd') ws.send(JSON.stringify({ type: 'result', id: m.id, lines: [{ kind: 'ok', text: '✓ mock: ' + m.line }] }))
    })
  })
})
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
const port = (server.address() as { port: number }).port
const url = `http://127.0.0.1:${port}`

try {
  // happy path: pair + two commands routed by id
  const s = await connect(url, 'GOOD')
  const a = await s.send('spawn box A')
  check('pairs + sends + gets a result', a.length === 1 && a[0]!.text === '✓ mock: spawn box A', JSON.stringify(a))
  const b = await s.send('move A 1 2 3')
  check('a second command routes independently (by id)', b[0]!.text === '✓ mock: move A 1 2 3')
  s.close()

  // bad code → connect rejects with a friendly message
  let rejected = ''
  try { await connect(url, 'NOPE') } catch (e) { rejected = e instanceof Error ? e.message : String(e) }
  check('a bad code rejects', rejected.length > 0 && /recognized|code/.test(rejected), rejected)

  // unreachable server → connect rejects (doesn't hang)
  let connErr = false
  try { await connect('http://127.0.0.1:1', 'GOOD') } catch { connErr = true }
  check('an unreachable server rejects', connErr)
} finally {
  server.close()
}

console.log(failures === 0 ? '\nPASS cli/session' : `\nFAIL cli/session (${failures})`)
process.exit(failures === 0 ? 0 : 1)
