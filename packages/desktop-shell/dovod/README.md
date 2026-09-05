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
| `env.template`             | Seed for `~/.qwen/.env` (created only when absent): `DOVOD_API_BASE`, `DOVOD_API_KEY`, `DOVOD_MODEL`.                                   |
| `mcp-server.template.json` | The `mcpServers.dovod` entry. Added only when `command` (or `url`) is not the `PLACEHOLDER`.                                            |
| `dovod-entry.js`           | The seeding wrapper. Also exported as functions for `scripts/test-release.js`.                                                          |

## Where the real content comes from

The seven command files (`prepare`, `inventory`, `position`, `stage`, `draft`,
`reconcile`, `restore`) and the MCP server definition are maintained in the
`garant-bot` repository:

- `garant-bot/dovod-tools/qwen/commands/*.toml` → replace the placeholder
  TOML files here before running the desktop release (the placeholders carry
  the Russian description and the prompt `PLACEHOLDER: replaced at packaging time`).
- `garant-bot/dovod-tools/install_dovod.ps1` → the MCP server command/args it
  registers go into `mcp-server.template.json`.

A build made with the placeholders still works: the commands exist but only
return the placeholder text, and no MCP server is registered.

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
