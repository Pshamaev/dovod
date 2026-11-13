// Modified for DOVOD.
//
// Runtime entry used by the Dovod desktop shell instead of cli-entry.js.
// It seeds the per-user Dovod configuration on first launch and then loads
// the unmodified Qwen Code entry (`./cli-entry.js`) in-process, so the daemon
// behaves exactly like upstream once seeding is done.
//
// Seeding rules (all idempotent, nothing the user created is ever overwritten):
//   <QWEN_HOME>/commands/dovod/<name>.toml  <- dovod/commands/*.toml (missing files only)
//   <QWEN_HOME>/.env                        <- dovod/env.template (only when absent)
//   <QWEN_HOME>/settings.json               <- dovod/settings.template.json when absent;
//                                              otherwise only absent keys are merged:
//                                              security.auth.selectedType, model.name,
//                                              modelProviders, mcpServers.dovod;
//                                              permissions.allow rules are appended
// The token __DOVOD_TOOLS__ inside the command files and the MCP template is
// replaced with the path to the case pipeline package (dovod-tools). Since
// 0.1.6 the pipeline ships inside the installer, so the path is resolved from
// the install location and the user has no variable to fill in. While the path
// cannot be resolved at all the commands are still seeded verbatim and the MCP
// server is NOT registered, so a bare install never spawns a broken server.
// A template whose `command` is "PLACEHOLDER" is skipped too.
//
// Set DOVOD_SKIP_SEED=1 to skip seeding (used by the packaged smoke test).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveQwenHome(env = process.env, homeDir = os.homedir()) {
  const configured = env['QWEN_HOME'];
  const home = homeDir || os.tmpdir();
  if (!configured) return path.join(home, '.qwen');
  if (configured === '~') return home;
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return path.join(
      home,
      ...configured
        .slice(2)
        .split(/[/\\]+/)
        .filter(Boolean),
    );
  }
  return path.resolve(configured);
}

function log(message) {
  process.stderr.write(`[dovod-seed] ${message}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Resolves the path to the case pipeline package (dovod-tools), in this order:
//   1. DOVOD_TOOLS in the environment - the development override;
//   2. the package shipped with the installer, next to this resource folder
//      (<runtime root>/dovod-tools), which is what an installed Довод uses;
//   3. DOVOD_TOOLS in <QWEN_HOME>/.env - the 0.1.5 field, no longer offered in
//      env.template: a leftover value points at the Python sources, which the
//      packaged commands (dovod_prompts.exe) cannot use.
// Returns '' when nothing resolves.
export function resolveDovodTools(
  qwenHome,
  env = process.env,
  resourceDir = path.join(__dirname, '..', 'dovod'),
) {
  const fromEnv =
    typeof env['DOVOD_TOOLS'] === 'string' ? env['DOVOD_TOOLS'].trim() : '';
  if (fromEnv) return fromEnv;
  const bundled = path.resolve(resourceDir, '..', 'dovod-tools');
  if (fs.existsSync(bundled)) return bundled;
  const envFile = path.join(qwenHome, '.env');
  if (!fs.existsSync(envFile)) return '';
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?DOVOD_TOOLS\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    return match[1].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return '';
}

const TOOLS_PLACEHOLDER = '__DOVOD_TOOLS__';

function substituteTools(text, toolsPath) {
  if (!toolsPath) return text;
  return text.split(TOOLS_PLACEHOLDER).join(toolsPath);
}

function seedCommands(resourceDir, qwenHome, toolsPath) {
  const source = path.join(resourceDir, 'commands');
  if (!fs.existsSync(source)) return 0;
  const target = path.join(qwenHome, 'commands', 'dovod');
  let copied = 0;
  for (const entry of fs.readdirSync(source)) {
    if (!entry.endsWith('.toml')) continue;
    const destination = path.join(target, entry);
    if (fs.existsSync(destination)) continue;
    fs.mkdirSync(target, { recursive: true });
    const content = fs.readFileSync(path.join(source, entry), 'utf8');
    fs.writeFileSync(destination, substituteTools(content, toolsPath));
    copied += 1;
  }
  return copied;
}

function seedEnvFile(resourceDir, qwenHome) {
  const template = path.join(resourceDir, 'env.template');
  const destination = path.join(qwenHome, '.env');
  if (!fs.existsSync(template) || fs.existsSync(destination)) return false;
  fs.mkdirSync(qwenHome, { recursive: true });
  fs.copyFileSync(template, destination);
  return true;
}

function readMcpServerTemplate(resourceDir, toolsPath) {
  const file = path.join(resourceDir, 'mcp-server.template.json');
  if (!fs.existsSync(file)) return undefined;
  const raw = substituteTools(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
    toolsPath ? JSON.stringify(toolsPath).slice(1, -1) : '',
  );
  // Unresolved placeholder: DOVOD_TOOLS is not configured on this machine.
  if (raw.includes(TOOLS_PLACEHOLDER)) return undefined;
  const entry = JSON.parse(raw);
  if (!isPlainObject(entry)) return undefined;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if ((!command || command === 'PLACEHOLDER') && !url) return undefined;
  return entry;
}

// Merges the Dovod defaults into an existing settings object without
// touching anything the user already configured. Returns true when the
// object changed.
export function mergeDovodSettings(
  settings,
  template,
  mcpServer,
  toolsPath = '',
) {
  let changed = false;
  const selectedType = template?.security?.auth?.selectedType;
  if (selectedType && !settings.security?.auth?.selectedType) {
    settings.security = isPlainObject(settings.security)
      ? settings.security
      : {};
    settings.security.auth = isPlainObject(settings.security.auth)
      ? settings.security.auth
      : {};
    settings.security.auth.selectedType = selectedType;
    changed = true;
  }
  if (template?.model?.name && !settings.model?.name) {
    settings.model = isPlainObject(settings.model) ? settings.model : {};
    settings.model.name = template.model.name;
    changed = true;
  }
  if (template?.general?.language && !settings.general?.language) {
    settings.general = isPlainObject(settings.general) ? settings.general : {};
    settings.general.language = template.general.language;
    changed = true;
  }
  if (
    isPlainObject(template?.modelProviders) &&
    Object.keys(template.modelProviders).length > 0 &&
    !(
      isPlainObject(settings.modelProviders) &&
      Object.keys(settings.modelProviders).length > 0
    )
  ) {
    settings.modelProviders = template.modelProviders;
    changed = true;
  }
  // tools.disabled: removes the file tools and the agent's shell terminal
  // from the model's registry (not permissions.deny, which would also block
  // the /dovod:* commands - see the comment on permissions.allow below). Only
  // filled in when the user has no tools.disabled of their own yet, same rule
  // as model.name above, so a value the user already set (including an empty
  // list, meaning "nothing disabled") is never touched.
  if (
    Array.isArray(template?.tools?.disabled) &&
    template.tools.disabled.length > 0 &&
    !Array.isArray(settings.tools?.disabled)
  ) {
    settings.tools = isPlainObject(settings.tools) ? settings.tools : {};
    settings.tools.disabled = [...template.tools.disabled];
    changed = true;
  }
  // permissions.allow: the /dovod:* commands run the dovod_prompts.exe entry
  // of the bundled pipeline through a shell injection; the daemon cannot ask
  // for confirmation, so a literal rule for that executable (no wildcards:
  // AUTO approval mode strips wildcard interpreter rules as dangerous) is
  // appended to whatever the user already allows (never replaced, never
  // duplicated). The rule must repeat the command exactly as the command files
  // write it, quotes included: a rule without `*` matches by literal prefix
  // (matchesCommandPattern in core/permissions/rule-parser.ts), so
  // `Bash(C:\...\dovod_prompts.exe)` would NOT cover
  // `"C:\...\dovod_prompts.exe" inventory`. Rules still carrying the
  // __DOVOD_TOOLS__ token (nothing resolved) are not written.
  const templateAllow = Array.isArray(template?.permissions?.allow)
    ? template.permissions.allow
        .filter((rule) => typeof rule === 'string')
        .map((rule) => substituteTools(rule, toolsPath))
        .filter((rule) => !rule.includes(TOOLS_PLACEHOLDER))
    : [];
  if (templateAllow.length > 0) {
    if (!isPlainObject(settings.permissions)) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) {
      settings.permissions.allow = [];
    }
    for (const rule of templateAllow) {
      if (!settings.permissions.allow.includes(rule)) {
        settings.permissions.allow.push(rule);
        changed = true;
      }
    }
  }
  if (mcpServer) {
    settings.mcpServers = isPlainObject(settings.mcpServers)
      ? settings.mcpServers
      : {};
    if (!settings.mcpServers.dovod) {
      settings.mcpServers.dovod = mcpServer;
      changed = true;
    }
  }
  return changed;
}

export function seedDovod({
  resourceDir = path.join(__dirname, '..', 'dovod'),
  qwenHome = resolveQwenHome(),
} = {}) {
  const summary = { commands: 0, env: false, settings: 'unchanged' };
  if (!fs.existsSync(resourceDir)) {
    summary.settings = 'no-resources';
    return summary;
  }
  summary.env = seedEnvFile(resourceDir, qwenHome);
  const toolsPath = resolveDovodTools(qwenHome, process.env, resourceDir);
  summary.commands = seedCommands(resourceDir, qwenHome, toolsPath);

  const templateFile = path.join(resourceDir, 'settings.template.json');
  const template = fs.existsSync(templateFile) ? readJson(templateFile) : {};
  const mcpServer = readMcpServerTemplate(resourceDir, toolsPath);
  const settingsFile = path.join(qwenHome, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    const fresh = structuredClone(template);
    delete fresh.permissions;
    mergeDovodSettings(fresh, template, mcpServer, toolsPath);
    if (mcpServer) {
      fresh.mcpServers = isPlainObject(fresh.mcpServers)
        ? fresh.mcpServers
        : {};
      fresh.mcpServers.dovod = mcpServer;
    }
    fs.mkdirSync(qwenHome, { recursive: true });
    writeJsonAtomic(settingsFile, fresh);
    summary.settings = 'created';
    return summary;
  }
  let settings;
  try {
    settings = readJson(settingsFile);
  } catch {
    // Comments or a syntax error: leave the file to Qwen Code's own loader.
    summary.settings = 'unparseable';
    return summary;
  }
  if (!isPlainObject(settings)) {
    summary.settings = 'invalid';
    return summary;
  }
  if (mergeDovodSettings(settings, template, mcpServer, toolsPath)) {
    writeJsonAtomic(settingsFile, settings);
    summary.settings = 'merged';
  }
  return summary;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.env['DOVOD_SKIP_SEED'] !== '1') {
    try {
      const summary = seedDovod();
      log(
        `commands copied: ${summary.commands}, .env created: ${summary.env}, settings: ${summary.settings}`,
      );
    } catch (error) {
      log(`seeding failed, continuing without it: ${error?.message ?? error}`);
    }
  }
  await import(pathToFileURL(path.join(__dirname, 'cli-entry.js')).href);
}
