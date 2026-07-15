# Pairing the `galatrix` CLI with your editor

Drive your running editor from a terminal. One-time code, same machine, time-boxed window.

## 1. In the editor

**Settings → Expose to CLI → set Window (minutes) → Start.** Copy the one-time code (e.g. `ABCDE-FGHIJ`).
Keep the editor tab open.

## 2. In a terminal (same machine as the editor)

Build it once (`pnpm install && pnpm --filter @galatrix/cli build`), then from the CLI folder:

```
cd Project/packages/cli && node dist/cli.js pair ABCDE-FGHIJ
```

That opens a REPL — type commands (`scene`, `spawn box Wall 0 1 0`, `select all`, `help`), `Ctrl-D` to quit.
One-shot (runs a `;`-chain and exits):

```
node dist/cli.js pair ABCDE-FGHIJ "spawn box Wall 0 1 0 ; tag Wall goal"
```

If the package is installed globally, the same commands work as `galatrix pair …` from any folder.

Server defaults to `http://localhost:4005` (your local editor-server). Hosted editor: add `--server https://your-host`.

## Good to know

- **Single-use code.** Each Start makes ONE code for ONE pairing. Used it? Click **Start** again for a fresh one.
- **The window ends when the CLI disconnects** — closing the REPL, or a one-shot finishing. It also ends after
  15 min idle or at the Window (minutes) max. Then the editor panel returns to **Start**; re-Start to pair again.
- **Same machine only.** The CLI must run from the same IP as the editor (`localhost` ↔ `localhost`).
  `your IP does not match the editor` → run it on the same box.
- **Scene edits + reads only** over the bridge — `spawn`/`move`/`set`/`run <json>`/`scene`/… work; `ai`, `save`,
  and publish stay in the editor by design.
