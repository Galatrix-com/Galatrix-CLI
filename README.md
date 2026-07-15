# galatrix CLI

Drive a **running [Galatrix](https://play.galatrix.com) editor from your terminal** — the same commands as the
editor's built-in Terminal (`spawn`, `move`, `set`, `run <json>`, `scene`, …), typed at a prompt or scripted.

Useful for repeatable scene edits, batch spawning, importing assets straight off your disk, and building maps
from a script. Every command is deterministic (no AI) and every edit is **undoable** in the editor.

```console
$ node dist/cli.js pair ABCDE-FGHIJ
paired ✓  — same commands as the editor Terminal ("help"). Ctrl-D to quit.
galatrix> spawn box Wall 0 1 0
galatrix> tag Wall goal
galatrix> scene
```

## Build

Needs [Node](https://nodejs.org). From the repo root:

```bash
pnpm install
pnpm --filter @galatrix/cli build   # → dist/cli.js
```

The package has no workspace dependencies (only `ws`), so it builds on its own.

## Pair

**1. Get a code.** In the editor: **Settings → Expose to CLI → set the Window (minutes) → Start.** Copy the
one-time code (e.g. `ABCDE-FGHIJ`) and leave the editor tab open.

**2. Run one command** — in a terminal on the **same machine**, from this folder:

```bash
node dist/cli.js pair ABCDE-FGHIJ
```

You land at a `galatrix>` prompt. `Ctrl-D` to quit.

**One-shot** — run a `;`-chain and exit instead of opening the prompt:

```bash
node dist/cli.js pair ABCDE-FGHIJ "spawn box Wall 0 1 0 ; tag Wall goal"
```

**Server** — defaults to `$GALATRIX_SERVER`, or `http://localhost:4005` if that's unset. For a hosted editor:

```bash
node dist/cli.js pair ABCDE-FGHIJ --server https://editor-api.galatrix.com
```

Installed globally? The package exposes a `galatrix` bin — every example here works as `galatrix pair …` from
any folder.

## Commands

Type `help` for the full list. The essentials:

- **Read** — `scene` · `ls [entities|assets|scripts]` · `find <query|#tag>` · `inspect <name>` ·
  `get <path>` · `console [errors|warn]` · `actions` (the full `run <json>` op catalog)
- **Play & view** — `select <name>|#tag|all` · `play` / `stop` · `pause` / `resume` / `step` · `playstate` ·
  `focus [name]` · `view top|front|iso`
- **Edit** — `spawn <kind> [name] [x y z]` · `move` / `rotate` / `scale` · `rename` · `tag` · `duplicate` ·
  `delete` · `attach <script> <name>` · `parent` / `unparent` · `bake` (NavMesh) · `snap` ·
  `set <path> = <value>`
- **Project** — `map [list|new|switch|…]` (sub-maps) · `kit [list|import|export]` · `save` · `load` ·
  `import [<type>] <path> [name]` · `run <json>` (any AI editor op, verbatim)

```bash
spawn box Wall 0 1 0             # create an entity
set gameSettings.gravity = -60   # tweak a setting
set Wall.color = "#ff0000"
import ./tree.glb                # pull a local asset in — type inferred from the extension
play                             # enter Play mode…
console errors                   # …then read runtime script errors
```

`import` reads the file off **your** disk and sends the bytes (the browser editor can't read a path itself).
Models, textures, audio, fonts, scripts, data (`.json`) and shaders are recognised; keep files under ~700 KB
(the relay caps a message at 1 MB).

## How it works & limits

Pairing redeems a **short-lived, single-use code** over a WebSocket relay. The CLI:

- must run from the **same IP** as the editor (`localhost` ↔ `localhost`),
- holds **one** session at a time (a second CLI is refused with `already_paired`),
- expires after your chosen Window (or 15 min idle), on **Stop**, or when the editor tab closes,
- **stores nothing** — the ephemeral code lives only for this process.

Everything the editor Terminal does works over the bridge — scene edits, reads, `save` (the local IndexedDB
autosave) and `publish` (submits for review) — **except `ai`**, which stays in the editor so a bridge session
can't spend AI budget.

## Docs

Full command reference: **https://editor.galatrix.com/docs/guide/cli**
