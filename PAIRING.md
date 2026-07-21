# Pairing the `galatrix` CLI with your editor

Drive your running editor from a terminal. One-time code, same machine, time-boxed window.

## 1. In the editor

**Settings → Expose to CLI → set Window (minutes) → Start.** Copy the code (e.g. `ABCDE-FGHIJ`).
The window now stays open for the whole duration you picked — backgrounding the editor tab is fine
(commands need the editor reachable, so if a command says the editor is not connected, focus its tab).

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

- **The code lasts the whole window.** One CLI at a time may attach, but the same code re-pairs after a
  drop — close the REPL, come back later, `galatrix pair` again with the same code until the window ends.
- **The window ends only when its duration elapses or you click Stop** in the editor panel. Reloading or
  backgrounding the editor tab does not end it — a returning editor reattaches automatically.
- **Same machine only.** The CLI must run from the same IP as the editor (`localhost` ↔ `localhost`).
  `your IP does not match the editor` → run it on the same box.
- **No AI over the bridge** — scene edits + reads, `save` (the local autosave) and `publish` work;
  `ai` stays in the editor by design.
