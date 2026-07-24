#!/usr/bin/env node
/**
 * galatrix — drive a running Galatrix editor from your terminal (docs/CLI-BRIDGE-PLAN.md).
 *
 *   1. In the editor: Settings → "Expose to CLI" → Start → note the one-time code.
 *   2. Here:  galatrix pair <CODE> [--server <url>] ["one-shot command"]
 *
 * With a one-shot command it runs it and exits; otherwise it opens a REPL. The server defaults to
 * $GALATRIX_SERVER or http://localhost:4005. Commands are the same as the editor's Terminal (`help` lists them).
 */
import * as readline from 'node:readline'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { connect, type ResultLine } from './session.js'

const COLORS: Record<ResultLine['kind'], string> = { cmd: '\x1b[34m', out: '', err: '\x1b[31m', ok: '\x1b[32m', info: '\x1b[90m' }
const RESET = '\x1b[0m'
const print = (lines: ResultLine[]) => { for (const l of lines) process.stdout.write((COLORS[l.kind] || '') + l.text + (COLORS[l.kind] ? RESET : '') + '\n') }

// The relay caps a message at 1 MB (relay.ts). base64 inflates ~1.37×, so keep the raw file under ~700 KB —
// small assets only, by design (no chunking).
const MAX_IMPORT_BYTES = 700_000

// A data: URL needs the right MIME so the browser decodes it (image/audio/font). GLTFLoader sniffs models, so
// the model MIME is cosmetic. Unknown extension → octet-stream.
const MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

const IMPORT_TYPES = new Set(['model', 'texture', 'audio', 'font', 'script', 'data', 'shader'])
// Extension → asset type, for the generic `import <path>` form (type omitted). The one source of truth for
// auto-detection; .gltf → model (not data) even though it's JSON, so it's listed before the .json → data rule.
const EXT_TYPE: Record<string, string> = {
  '.glb': 'model', '.gltf': 'model',
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture',
  '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio', '.m4a': 'audio',
  '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font',
  '.js': 'script', '.ts': 'script', '.mjs': 'script', '.cjs': 'script',
  '.json': 'data',
  '.frag': 'shader', '.fs': 'shader', '.glsl': 'shader', '.vert': 'shader', '.vs': 'shader', '.glslv': 'shader', '.shader': 'shader',
}

/** `import [<type>] <path> [name]` → read the LOCAL file here (only Node can; the browser editor can't touch a
 *  disk path) and rewrite for the editor. The TYPE is OPTIONAL — omit it and it's inferred from the file
 *  extension (`import ./water.frag` ≡ `import shader ./water.frag`, `import ./tree.glb` ≡ `import model …`).
 *  Binary assets → `data:<mime>;base64,…`, text assets (script/data/shader) → raw base64 (the editor decodes to
 *  UTF-8). Any line that doesn't resolve to a local file passes through unchanged. */
export function expandImport(line: string): string {
  const m = line.match(/^\s*import\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i)
  if (!m) return line
  const [, a, b, c] = m
  // Explicit `import <type> <path> [name]` when the 1st token is a known type AND a path follows; otherwise the
  // 1st token IS the path (generic `import <path> [name]`, type inferred from the extension below).
  let type: string | undefined = IMPORT_TYPES.has(a!.toLowerCase()) && b ? a!.toLowerCase() : undefined
  const path = type ? b! : a!
  const givenName = type ? c : b
  if (!existsSync(path) || !statSync(path).isFile()) return line // not a local file → assume it's already `import <type> <name> <data>`
  if (!type) {
    type = EXT_TYPE[extname(path).toLowerCase()]
    if (!type) throw new Error(`can't infer the asset type of "${path}"${extname(path) ? ` (${extname(path)})` : ''} — pass it explicitly, e.g. \`import <model|texture|audio|font|script|data|shader> ${path}\``)
  }
  const size = statSync(path).size
  if (size > MAX_IMPORT_BYTES) throw new Error(`"${path}" is ${(size / 1024).toFixed(0)} KB — over the ~${Math.floor(MAX_IMPORT_BYTES / 1024)} KB limit (small assets only; the CLI relay caps messages at 1 MB)`)
  const name = givenName || basename(path, extname(path))
  const b64 = readFileSync(path).toString('base64')
  // script/data are TEXT — the editor decodes raw base64 to UTF-8; the others need the right MIME to decode.
  if (type === 'script' || type === 'data') return `import ${type} ${name} ${b64}`
  // A shader file is GLSL text (one stage). Extension picks the stage: .vert/.vs → vertex, else fragment.
  if (type === 'shader') {
    const ext = extname(path).toLowerCase()
    const stage = ext === '.vert' || ext === '.vs' || ext === '.glslv' ? 'vertex' : 'fragment'
    return `import shader ${name} ${b64} ${stage}`
  }
  return `import ${type} ${name} data:${MIME[extname(path).toLowerCase()] || 'application/octet-stream'};base64,${b64}`
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] !== 'pair' || !args[1]) {
    console.error('usage: galatrix pair <code> [--server <url>] ["command"]')
    console.error('  Get <code> from the editor: Settings → Expose to CLI → Start.')
    process.exit(1)
  }
  const code = args[1]
  let server = process.env.GALATRIX_SERVER || 'http://localhost:4005'
  const si = args.indexOf('--server')
  if (si >= 0 && args[si + 1]) server = args[si + 1]!
  // Anything after the code that isn't the --server flag/value is a one-shot command.
  const oneShot = args.slice(2).filter((a, i, arr) => a !== '--server' && arr[i - 1] !== '--server').join(' ').trim()

  let session
  try { session = await connect(server, code) } catch (e) { console.error('pairing failed:', e instanceof Error ? e.message : String(e)); process.exit(1) }

  if (oneShot) {
    // A one-shot is a SCRIPTED call, so its exit status has to mean something: without this a failed command
    // still exited 0, silently continuing `galatrix pair … "…" && next-step` and passing CI steps that had
    // actually failed. Two failure shapes count: expandImport throwing here (unreadable path / unknown type /
    // over the size cap) and the editor answering with `err` lines (unknown command, bad args, and the
    // "connection lost before a result arrived" line the transport synthesises on a dropped socket).
    let failed = false
    try {
      const lines = await session.send(expandImport(oneShot))
      print(lines)
      failed = lines.some((l) => l.kind === 'err')
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
      failed = true
    }
    // exitCode rather than exit() — let Node drain, so buffered stdout isn't truncated when piped.
    process.exitCode = failed ? 1 : 0
    session.close(); return
  }

  session.onClosed((reason) => { process.stdout.write(`\n${COLORS.info}session ended (${reason})${RESET}\n`); process.exit(0) })
  console.log(`${COLORS.ok}paired ✓${RESET}  — same commands as the editor Terminal ("help"). Ctrl-D to quit.`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'galatrix> ' })
  rl.prompt()
  rl.on('line', async (line) => {
    const t = line.trim()
    if (t) { try { print(await session.send(expandImport(t))) } catch (e) { console.error(e instanceof Error ? e.message : String(e)) } }
    rl.prompt()
  })
  rl.on('close', () => { session.close(); process.exit(0) })
}

// Run only when executed as the CLI entry point (not when imported for testing).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
