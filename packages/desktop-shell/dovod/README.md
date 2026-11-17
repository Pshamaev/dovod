# DOVOD bundled resources

<!-- Modified for DOVOD -->

This folder is copied verbatim into the bundled runtime as
`runtime/qwen-code/dovod/` by `scripts/prepare-runtime.js`, and
`dovod-entry.js` is installed as `runtime/qwen-code/lib/dovod-entry.js` — the
entry the desktop shell launches (see `src-tauri/src/runtime.rs`). On every
launch `dovod-entry.js` seeds the user's `~/.qwen` (or `$QWEN_HOME`) and then
loads the unmodified `cli-entry.js`.

## Contents

| Path                       | Purpose                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `commands/*.toml`          | User slash commands `/dovod:<name>`. Copied to `~/.qwen/commands/dovod/` when the file is missing there (user edits are never touched). |
| `settings.template.json`   | Seed for `~/.qwen/settings.json` (created when absent; otherwise only absent keys are merged).                                          |
| `env.template`             | Seed for `~/.qwen/.env` (created only when absent): `DOVOD_API_BASE`, `DOVOD_API_KEY`, `DOVOD_MODEL`, `DOVOD_TOOLS`, `DOVOD_ACCESS_SERVER`. |
| `mcp-server.template.json` | The `mcpServers.dovod` entry. Added only once `__DOVOD_TOOLS__` resolves (and `command`/`url` is not `PLACEHOLDER`).                  |
| `dovod-entry.js`           | The seeding wrapper. Also exported as functions for `scripts/test-release.js`.                                                          |

## Where the real content comes from

The seven command files (`prepare`, `inventory`, `position`, `stage`, `draft`,
`reconcile`, `restore`) are copies of `garant-bot/dovod-tools/qwen/commands/dovod/*.toml`
(keep them byte-identical; that folder is the source of truth). They call
`dovod_prompts.py` through the token `__DOVOD_TOOLS__`, exactly like
`install_dovod.ps1` does, and `mcp-server.template.json` describes the
citation-check server (`garant-bot/dist/mcp/citationServer.js`) through the
same token.

On first launch `dovod-entry.js` resolves the token from `DOVOD_TOOLS` (the
environment, or `~/.qwen/.env`): the path to `dovod-tools` inside a checkout
of `garant-bot` on this machine. While `DOVOD_TOOLS` is unset the commands are
still seeded (with the token left in place, to be filled by the user or by
`install_dovod.ps1`) and the MCP server is not registered, so a bare install
never spawns a broken server.

## Model provider

Nothing model-specific is hard-coded. `settings.template.json` declares one
OpenAI-compatible route whose base URL, key and model id are `${DOVOD_*}`
placeholders resolved by Qwen Code from the environment or from
`~/.qwen/.env`. The user fills `~/.qwen/.env`:

```
DOVOD_API_BASE=https://api.example.com/v1
DOVOD_API_KEY=sk-...
DOVOD_MODEL=model-id
```

The standard `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` variables
keep working too, and the provider can also be edited from the Web Shell
settings ("Модель" / `/model`).

### Access-code path (DESKTOP_018)

Until the three `DOVOD_*` lines above are filled (by hand, or by an access
server), the desktop shell's `open_chat` command refuses to open a chat
session at all and returns a sentinel the bootstrap screen turns into
"Введите код доступа" instead of letting the broken session crash (the
`agent channel closed during initialize` failure DESKTOP_018 fixed). If
`DOVOD_ACCESS_SERVER` is set — as a process environment variable (dev
override) or as a line in this same `~/.qwen/.env` — the code the lawyer
types on that screen is sent as `?code=<code>` to
`GET <DOVOD_ACCESS_SERVER>` from the Rust side (`submit_access_code` /
`redeem_access_code` in `src-tauri/src/main.rs`), expecting a JSON body
`{"api_base": "...", "api_key": "...", "model": "..."}` (or `{"error": "..."}`
on rejection). The three values returned never touch disk: they live only in
`ApplicationState.access_credentials` for this run and are passed straight
into the bundled daemon's process environment when it (re)starts. No server
implementation ships in this repository; what one would need to provide is
described in the DESKTOP_018 session report.

Set `DOVOD_SKIP_SEED=1` to disable seeding for a launch.
