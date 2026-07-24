// Exit-status contract for the galatrix CLI's one-shot mode.
//
// A one-shot invocation is a SCRIPTED call — `galatrix pair … "cmd" && next-step`, a CI step, a Makefile —
// so a failed command MUST exit non-zero. It used to always exit 0, which silently let chains continue past
// a failure. These tests drive the REAL built CLI (dist/cli.js) against a fake relay that speaks the actual
// wire protocol (hello-cli → paired, cmd → result), so they cover argument parsing, the transport and the
// exit path end to end rather than just the helper functions.
//
// Run: pnpm --filter @galatrix/cli test   (builds first — it tests dist/, not src/)
import { WebSocketServer, type WebSocket } from 'ws'
import { spawn } from 'node:child_process'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(cliRoot, 'dist', 'cli.js')
if (!existsSync(CLI)) { console.error(`missing ${CLI} — run "pnpm --filter @galatrix/cli build" first`); process.exit(1) }

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name, detail && `(${detail})`) }
  else { fail++; console.error('  ✗', name, detail) }
}

/** A stand-in for the editor-server relay. `BADCODE` is rejected like an expired/unknown code; any command
 *  containing "boom" comes back as an `err` line, anything else as `ok` — enough to exercise both outcomes. */
function startFakeRelay(port: number): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ port, path: '/cli-relay' })
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (raw) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(raw)) as Record<string, unknown> } catch { return }
      if (m.type === 'hello-cli') {
        if (m.code === 'BADCODE') ws.send(JSON.stringify({ type: 'error', error: 'bad_code' }))
        else ws.send(JSON.stringify({ type: 'paired' }))
      } else if (m.type === 'cmd') {
        const line = String(m.line ?? '')
        const lines = line.includes('boom')
          ? [{ kind: 'err', text: `unknown command: ${line}` }]
          : [{ kind: 'ok', text: `did: ${line}` }]
        ws.send(JSON.stringify({ type: 'result', id: m.id, lines }))
      }
    })
  })
  return new Promise((res) => wss.on('listening', () => res(wss)))
}

/** Run the built CLI to completion; resolve its exit code (+ output, for eyeballing failures). */
function runCli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd: cliRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => res({ code: code ?? -1, out, err }))
  })
}

const PORT = 47311
const SERVER = `http://127.0.0.1:${PORT}`
const wss = await startFakeRelay(PORT)

// ── 1. a command that SUCCEEDS exits 0 ────────────────────────────────────────────────────────────────
{
  const r = await runCli(['pair', 'GOODCODE', '--server', SERVER, 'spawn box Wall 0 1 0'])
  ok('success → exit 0', r.code === 0, `code=${r.code}`)
  ok('success → the editor output is printed', /did: spawn box Wall 0 1 0/.test(r.out), r.out.trim().slice(0, 60))
}

// ── 2. THE BUG: a command the editor rejects must exit NON-ZERO (used to be 0) ────────────────────────
{
  const r = await runCli(['pair', 'GOODCODE', '--server', SERVER, 'boom not-a-command'])
  ok('editor `err` line → exit 1', r.code === 1, `code=${r.code}`)
  ok('editor `err` line → the error is still shown', /unknown command/.test(r.out + r.err), (r.out + r.err).trim().slice(0, 60))
}

// ── 3. a `;`-chain whose LAST step fails also fails the run (the relay sees the whole line) ───────────
{
  const r = await runCli(['pair', 'GOODCODE', '--server', SERVER, 'spawn box A 0 1 0 ; boom'])
  ok('failing step in a `;` chain → exit 1', r.code === 1, `code=${r.code}`)
}

// ── 4. a client-side expandImport failure (unknown extension) exits non-zero too ──────────────────────
{
  const tmp = path.join(cliRoot, '.tmp-exitcode-test.xyz')
  writeFileSync(tmp, 'x')
  try {
    const r = await runCli(['pair', 'GOODCODE', '--server', SERVER, 'import ./.tmp-exitcode-test.xyz'])
    ok('unimportable local file → exit 1', r.code === 1, `code=${r.code}`)
    ok('unimportable local file → says why', /can't infer the asset type/.test(r.err + r.out), (r.err + r.out).trim().slice(0, 70))
  } finally { rmSync(tmp, { force: true }) }
}

// ── 5. pre-existing failure paths still exit non-zero (no regression) ─────────────────────────────────
{
  const bad = await runCli(['pair', 'BADCODE', '--server', SERVER, 'spawn box A 0 1 0'])
  ok('rejected pairing code → exit 1', bad.code === 1, `code=${bad.code}`)
  const usage = await runCli([])
  ok('no args (usage) → exit 1', usage.code === 1, `code=${usage.code}`)
}

wss.close()
console.log(`\ncliExitCodes: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
