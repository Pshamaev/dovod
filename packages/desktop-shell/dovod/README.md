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
| `env.template`             | Seed for `~/.qwen/.env` (created only when absent): `DOVOD_API_BASE`, `DOVOD_API_KEY`, `DOVOD_MODEL`, `DOVOD_TOOLS`.                    |
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

Set `DOVOD_SKIP_SEED=1` to disable seeding for a launch.
