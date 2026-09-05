#!/usr/bin/env node
// Modified for DOVOD: identity, bootstrap copy, updater and runtime
// assertions follow the DOVOD rebrand; adds the dovod-entry.js seed tests.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveLogRoot, sliceNewLog } from './resolve-log-root.js';
import {
  mergeDovodSettings,
  resolveDovodTools,
  resolveQwenHome,
  seedDovod,
} from '../dovod/dovod-entry.js';

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoRoot = path.resolve(packageDir, '../..');
const manifestScript = path.join(
  repoRoot,
  '.github',
  'scripts',
  'create-desktop-update-manifest.mjs',
);
const electronBridgeScript = path.join(
  repoRoot,
  '.github',
  'scripts',
  'create-electron-bridge-manifest.mjs',
);
const versionScript = path.join(packageDir, 'scripts', 'version.js');
const tauriConfig = JSON.parse(
  fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'tauri.conf.json'),
    'utf8',
  ),
);

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qwen-desktop-release-test-'),
);
try {
  testBootstrapBridgeConfiguration();
  await testBootstrapWorkspaceVisibility();
  testDovodApplicationIdentity();
  testElectronBridgeWorkflow();
  testDesktopReleaseSigningWorkflow();
  testDesktopReleaseHardening();
  testUpdaterMirrorConfiguration();
  testResolveLogRoot();
  testSliceNewLog();
  testUpdateManifest(path.join(root, 'manifest'));
  testElectronBridgeManifest(path.join(root, 'electron-bridge'));
  testVersionSynchronization(path.join(root, 'version'));
  testRuntimePreparation(path.join(root, 'runtime'));
  testDovodSeeding(path.join(root, 'dovod-seed'));
  console.log('Desktop release helper checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

async function testBootstrapWorkspaceVisibility() {
  const bootstrapHtml = fs.readFileSync(
    path.join(packageDir, 'bootstrap', 'index.html'),
    'utf8',
  );
  assert.match(bootstrapHtml, /class="mark" src="dovod-logo\.svg"/);
  assert.ok(
    fs.existsSync(path.join(packageDir, 'bootstrap', 'dovod-logo.svg')),
    'The bootstrap splash mark must ship with the frontendDist directory.',
  );
  assert.doesNotMatch(bootstrapHtml, /class="mark">Q</);
  assert.doesNotMatch(
    bootstrapHtml,
    /Qwen/,
    'The bootstrap page must not show the upstream product name.',
  );
  const reducedMotionBlock = bootstrapHtml.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)(?:@media|<\/style>)/,
  );
  assert.ok(
    reducedMotionBlock,
    'The bootstrap splash must keep a reduced-motion media block.',
  );
  for (const centeringRule of [
    /body\[data-state='starting'\] \.brand \{[^}]*justify-content: center;[^}]*\}/,
    /body\[data-state='starting'\] \.status \{[^}]*text-align: center;[^}]*\}/,
  ]) {
    assert.match(
      reducedMotionBlock[1],
      centeringRule,
      'The reduced-motion startup view must keep the logo and status text on the same horizontal center.',
    );
  }
  const runtimeSource = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'src', 'runtime.rs'),
    'utf8',
  );
  assert.match(
    runtimeSource,
    /let mut child = spawn_runtime_group\(&mut command\)/,
    'DesktopRuntime::start must spawn the runtime through the hidden-console helper.',
  );
  const primary = await createBootstrapHarness();
  const { body, commands, element, listeners, resolveBootstrapState } = primary;

  listeners['runtime-starting']({
    payload: '/Users/example/Projects/qwen-code',
  });
  assert.equal(body.dataset.state, 'starting');
  assert.equal(element('#workspace').hidden, true);

  listeners['runtime-failed']({ payload: 'runtime failed' });
  assert.equal(body.dataset.state, 'error');
  assert.equal(element('#workspace').hidden, false);
  assert.equal(
    element('#workspace').textContent,
    '/Users/example/Projects/qwen-code',
  );
  await element('#logs').listeners.click();
  assert.equal(element('#workspace').hidden, false);

  element('#retry').listeners.click();
  assert.equal(commands.at(-1), 'restart_runtime');
  assert.equal(body.dataset.state, 'starting');
  assert.equal(element('#workspace').hidden, true);

  resolveBootstrapState({
    desktopVersion: '0.2.0',
    status: 'starting',
    workspace: '/Users/example/Documents',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element('#title').textContent, 'Перезапуск Довода');
  assert.equal(
    element('#workspace').hidden,
    true,
    'A stale bootstrap snapshot must not overwrite a newer recovery action.',
  );

  const failed = await createBootstrapHarness();
  failed.listeners['runtime-failed']({ payload: 'runtime failed' });
  failed.resolveBootstrapState({
    desktopVersion: '0.2.0',
    status: 'idle',
    workspace: '/Users/example/Documents/Qwen',
    error: 'runtime failed',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed.element('#workspace').hidden, false);
  assert.equal(
    failed.element('#workspace').textContent,
    '/Users/example/Documents/Qwen',
  );

  const cancelled = await createBootstrapHarness();
  cancelled.listeners['runtime-starting']({
    payload: '/Users/example/Documents/Qwen',
  });
  cancelled.listeners['runtime-failed']({ payload: 'runtime failed' });
  await cancelled.element('#choose').listeners.click();
  assert.equal(cancelled.body.dataset.state, 'idle');
  assert.equal(cancelled.element('#workspace').hidden, false);
  assert.equal(
    cancelled.element('#workspace').textContent,
    '/Users/example/Documents/Qwen',
  );
}

async function createBootstrapHarness() {
  const elements = {};
  const element = (selector) => {
    elements[selector] ??= {
      addEventListener(event, listener) {
        this.listeners ??= {};
        this.listeners[event] = listener;
      },
      style: {},
    };
    return elements[selector];
  };
  const listeners = {};
  const commands = [];
  const body = { dataset: {} };
  let resolveBootstrapState;
  const tauri = {
    core: {
      invoke: async (command) => {
        commands.push(command);
        if (command === 'bootstrap_state') {
          return new Promise((resolve) => {
            resolveBootstrapState = resolve;
          });
        }
        if (command === 'open_logs') throw new Error('no file handler');
        if (command === 'choose_workspace') return null;
        if (command === 'restart_runtime') return new Promise(() => {});
        throw new Error(`Unexpected desktop command: ${command}`);
      },
    },
    event: {
      listen: async (event, listener) => {
        listeners[event] = listener;
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(packageDir, 'bootstrap', 'bootstrap.js'), 'utf8'),
    {
      document: { body, querySelector: element },
      window: { __TAURI__: tauri },
    },
    { timeout: 5000 },
  );
  await new Promise((resolve) => setImmediate(resolve));
  return {
    body,
    commands,
    element,
    listeners,
    resolveBootstrapState: (state) => resolveBootstrapState(state),
  };
}

function testDovodApplicationIdentity() {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(packageDir, 'src-tauri', 'tauri.conf.json'),
      'utf8',
    ),
  );
  assert.equal(config.productName, 'Довод');
  assert.equal(config.mainBinaryName, 'dovod');
  assert.equal(config.identifier, 'law.dovod.desktop');
  assert.equal(
    config.bundle.windows.nsis.installerHooks,
    undefined,
    'DOVOD has no legacy Electron installation to migrate.',
  );
  assert.deepEqual(config.bundle.windows.nsis.languages, [
    'Russian',
    'English',
  ]);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  for (const icon of config.bundle.icon) {
    assert.ok(
      fs.existsSync(path.join(packageDir, 'src-tauri', icon)),
      `Bundle icon must exist: ${icon}`,
    );
  }
  const main = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'src', 'main.rs'),
    'utf8',
  );
  assert.match(main, /\.title\("Довод"\)/);
  assert.match(main, /const DEFAULT_WORKSPACE_DIRECTORY: &str = "Довод";/);
  const runtime = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'src', 'runtime.rs'),
    'utf8',
  );
  assert.match(
    runtime,
    /root\.join\("lib"\)\.join\("dovod-entry\.js"\)/,
    'The desktop shell must launch the DOVOD seeding entry.',
  );
  const notice = fs.readFileSync(path.join(packageDir, 'NOTICE'), 'utf8');
  assert.match(
    notice,
    /This product includes software developed by the Qwen Code project \(Apache 2\.0\)/,
  );
}

function testElectronBridgeWorkflow() {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'),
    'utf8',
  );
  assert.match(workflow, /^ {6}electron_bridge:$/m);
  assert.match(workflow, /create-electron-bridge-manifest\.mjs/);
  assert.match(workflow, /macos:latest-mac\.yml/);
  assert.match(workflow, /windows:latest\.yml/);
  assert.match(workflow, /linux:latest-linux\.yml/);
  assert.match(
    workflow,
    /windows_installers=\(release-assets\/\*-setup\.exe\)/,
  );
  assert.match(workflow, /linux_appimages=\(release-assets\/\*\.AppImage\)/);
  assert.match(workflow, /^\s+release-assets\/latest\.yml$/m);
  assert.match(workflow, /^\s+release-assets\/latest-linux\.yml$/m);
  assert.match(workflow, /^\s+"\$\{windows_installers\[0\]\}"$/m);
  assert.match(workflow, /^\s+"\$\{linux_appimages\[0\]\}"$/m);
  assert.match(
    workflow,
    /if \[ "\$ELECTRON_BRIDGE" = 'true' \]; then\s+echo "::error::Electron bridge \$RELEASE_VERSION cannot replace newer stable feed \$current\."\s+exit 1/,
  );
  for (const artifact of [
    'Qwen-Code-Desktop-arm64.zip',
    'Qwen-Code-Desktop-x64.zip',
    'Qwen-Code-Desktop-arm64.dmg',
    'Qwen-Code-Desktop-x64.dmg',
  ]) {
    assert.match(workflow, new RegExp(artifact.replaceAll('.', '\\.')));
  }
}

function testDesktopReleaseSigningWorkflow() {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'),
    'utf8',
  );
  const primaryIncomplete =
    '$primaryIncomplete = ([bool]$env:WINDOWS_CERTIFICATE) -ne ' +
    '([bool]$env:WINDOWS_CERTIFICATE_PASSWORD)';
  const legacyIncomplete =
    '$legacyIncomplete = ([bool]$env:LEGACY_WIN_CSC_LINK) -ne ' +
    '([bool]$env:LEGACY_WIN_CSC_KEY_PASSWORD)';
  assert.ok(
    workflow.includes(primaryIncomplete),
    'Windows signing must fail closed when the primary certificate pair is incomplete',
  );
  assert.ok(
    workflow.includes(legacyIncomplete),
    'Windows signing must fail closed when the legacy certificate pair is incomplete',
  );
  assert.ok(
    workflow.includes(
      'elif [ "$RUNNER_OS" = \'Windows\' ] && [ -n "$WINDOWS_CONFIG" ]; then',
    ),
    'Windows builds must only pass a Tauri config when signing config exists',
  );
  assert.ok(
    workflow.includes(
      "$signature.Status -eq 'NotSigned' -and -not $env:WINDOWS_CONFIG",
    ),
    'Unsigned Windows installers are only allowed when no signing config exists',
  );
  const ripgrepStart = workflow.indexOf('# ripgrep vendor binaries');
  const ripgrepEnd = workflow.indexOf('# Node.js runtime binary');
  assert.ok(
    ripgrepStart !== -1 && ripgrepEnd > ripgrepStart,
    'the vendor signing step must keep its ripgrep/Node section markers',
  );
  const ripgrepSigningBlock = workflow.slice(ripgrepStart, ripgrepEnd);
  assert.doesNotMatch(
    ripgrepSigningBlock,
    /--entitlements/,
    'ripgrep must not inherit the app entitlements',
  );
  assert.match(
    workflow,
    /--options runtime --timestamp \\\n\s+\{\} \+/,
    'ripgrep codesign failures must fail the signing step',
  );
  assert.ok(
    workflow.includes(
      '--entitlements src-tauri/NodeEntitlements.plist "$node_bin"',
    ),
    'Node.js must use its minimal helper entitlements',
  );
  const nodeEntitlements = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'NodeEntitlements.plist'),
    'utf8',
  );
  const appEntitlements = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'Entitlements.plist'),
    'utf8',
  );
  assert.match(
    appEntitlements,
    /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/,
    'the app bundle must keep microphone access for voice dictation',
  );
  const infoPlist = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'Info.plist'),
    'utf8',
  );
  assert.match(
    infoPlist,
    /NSMicrophoneUsageDescription<\/key>\s*<string>.+<\/string>/,
    'the app bundle must declare a non-empty microphone usage description',
  );
  assert.match(
    nodeEntitlements,
    /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/,
    'the bundled Node.js runtime must keep its JIT entitlement',
  );
  assert.doesNotMatch(
    nodeEntitlements,
    /com\.apple\.security\.device\.audio-input/,
    'Node.js must not receive microphone access',
  );
  assert.match(
    workflow,
    /Ripgrep vendor directory not found at \$rg_dir/,
    'missing ripgrep binaries must be visible in release logs',
  );
  assert.match(
    workflow,
    /Node\.js runtime binary not found at \$node_bin/,
    'missing Node.js runtime binary must be visible in release logs',
  );
  assert.match(
    workflow,
    /Print :com\.apple\.security\.device\.audio-input/,
    'the macOS signature check must keep verifying the audio-input entitlement',
  );
  assert.match(
    workflow,
    /Print :NSMicrophoneUsageDescription/,
    'the packaged smoke must keep verifying the microphone usage description',
  );
  assert.ok(
    workflow.indexOf("name: 'Prepare bundled runtime'") <
      workflow.indexOf("name: 'Sign bundled vendor binaries (macOS)'"),
    'vendor binaries must be signed after the runtime is prepared',
  );
  assert.ok(
    workflow.indexOf("name: 'Sign bundled vendor binaries (macOS)'") <
      workflow.indexOf("name: 'Build desktop installers'"),
    'vendor binaries must be signed before Tauri builds installers',
  );
}

function testDesktopReleaseHardening() {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /IS_PRERELEASE" = 'true' \] && \[\[ ! "\$version" =~ \^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+-/,
    'prerelease builds must not reuse a stable Desktop version',
  );
  assert.match(
    workflow,
    /\*-setup\.exe\) name="DOVOD-Setup-\$RELEASE_VERSION-x64\.exe" ;;\s*\n\s*\*-setup\.exe\.sig\) name="DOVOD-Setup-\$RELEASE_VERSION-x64\.exe\.sig" ;;/,
    'Windows release collection must allow only installer executables and publish them as DOVOD-Setup',
  );
  assert.doesNotMatch(
    workflow,
    /github\.repository == 'QwenLM\/qwen-code'/,
    'the DOVOD fork must upload and publish from its own repository',
  );
  assert.match(workflow, /^ {6}windows_only:$/m);
  assert.match(workflow, /fromJSON\(needs\.prepare\.outputs\.matrix\)/);
  assert.doesNotMatch(workflow, /sync-desktop-to-oss/);
  assert.doesNotMatch(
    workflow.slice(
      workflow.indexOf('elif [ "$RUNNER_OS" = \'Windows\' ]'),
      workflow.indexOf('elif [ "$RUNNER_OS" = \'Linux\' ]'),
    ),
    /\*\.exe\)/,
    'Windows release collection must not include embedded executables',
  );
  assert.match(
    workflow,
    /\*\.AppImage\|\*\.AppImage\.sig\|\*\.deb\|\*\.deb\.sig/,
    'Linux release collection must allow only installers and updater signatures',
  );

  const prepareRuntime = fs.readFileSync(
    path.join(packageDir, 'scripts', 'prepare-runtime.js'),
    'utf8',
  );
  assert.match(
    prepareRuntime,
    /QWEN_DESKTOP_NODE_CACHE_DIR/,
    'runtime preparation must cache verified Node.js archives',
  );
  assert.match(
    workflow,
    /desktop-node-v2-\$\{\{ matrix\.rust_target \}\}-\$\{\{ env\.NODE_VERSION \}\}-\$\{\{ inputs\.dry_run \}\}/,
    'release builds must persist the bundled Node.js archive cache',
  );
  assert.match(workflow, /actions\/cache\/restore@/);
  assert.match(workflow, /actions\/cache\/save@/);
  assert.equal(
    (
      workflow.match(
        /path: '\$\{\{ steps\.node-cache-path\.outputs\.path \}\}'/g,
      ) ?? []
    ).length,
    2,
    'cache restore and save must share the configured cache path',
  );
  assert.ok(
    prepareRuntime.indexOf('replaceRuntime();') >
      prepareRuntime.indexOf('writeChecksums();'),
    'runtime replacement must happen only after assembly and checksums finish',
  );
}

function testRuntimePreparation(directory) {
  const testPackageDir = path.join(directory, 'packages', 'desktop-shell');
  const testScript = path.join(testPackageDir, 'scripts', 'prepare-runtime.js');
  const sourceRoot = path.join(directory, 'source');
  const runtimeDir = path.join(testPackageDir, 'runtime');
  const cacheRoot = path.join(directory, 'cache');
  const nodeVersion = process.versions.node;
  const archiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
  const cacheDir = path.join(cacheRoot, `v${nodeVersion}`);
  const cachedArchivePath = path.join(cacheDir, archiveName);
  const archivePath = path.join(directory, archiveName);
  const checksumsPath = path.join(directory, 'SHASUMS256.txt');
  const fetchLog = path.join(directory, 'fetch.log');
  const fetchMock = path.join(directory, 'mock-fetch.mjs');
  const extractedRoot = path.join(
    directory,
    `node-v${nodeVersion}-darwin-arm64`,
  );

  fs.mkdirSync(path.join(sourceRoot, 'dist', 'web-shell', 'assets'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(sourceRoot, 'package.json'),
    JSON.stringify({ version: '0.0.0-test' }),
  );
  fs.mkdirSync(path.dirname(testScript), { recursive: true });
  fs.copyFileSync(
    path.join(packageDir, 'scripts', 'prepare-runtime.js'),
    testScript,
  );
  fs.cpSync(
    path.join(packageDir, 'dovod'),
    path.join(testPackageDir, 'dovod'),
    {
      recursive: true,
    },
  );
  fs.writeFileSync(
    path.join(directory, '.nvmrc'),
    `${process.versions.node.split('.')[0]}\n`,
  );
  fs.writeFileSync(
    path.join(testPackageDir, 'package.json'),
    JSON.stringify({ version: '0.0.0-test' }),
  );
  fs.writeFileSync(path.join(testPackageDir, 'NOTICE'), 'test notice');
  fs.writeFileSync(path.join(sourceRoot, 'LICENSE'), 'test license');
  for (const file of [
    'cli.js',
    'cli-entry.js',
    path.join('web-shell', 'index.html'),
    path.join('web-shell', 'assets', 'app.js'),
  ]) {
    fs.writeFileSync(path.join(sourceRoot, 'dist', file), 'test');
  }
  fs.mkdirSync(path.join(extractedRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(extractedRoot, 'bin', 'node'), 'node');
  fs.writeFileSync(path.join(extractedRoot, 'LICENSE'), 'node license');
  execFileSync('tar', [
    '-czf',
    archivePath,
    '-C',
    directory,
    path.basename(extractedRoot),
  ]);
  const archiveHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(archivePath))
    .digest('hex');
  fs.writeFileSync(checksumsPath, `${archiveHash}  ${archiveName}\n`);
  fs.writeFileSync(
    fetchMock,
    `import fs from 'node:fs';
globalThis.fetch = async (url) => {
  const value = String(url);
  const source = value.endsWith('/SHASUMS256.txt')
    ? process.env.QWEN_TEST_NODE_CHECKSUMS
    : process.env.QWEN_TEST_NODE_ARCHIVE;
  fs.appendFileSync(process.env.QWEN_TEST_FETCH_LOG, value + '\\n');
  return new Response(fs.readFileSync(source), { status: 200 });
};
`,
  );

  const env = {
    ...process.env,
    QWEN_CODE_COMMIT: 'test-commit',
    QWEN_CODE_ROOT: sourceRoot,
    QWEN_DESKTOP_NODE_CACHE_DIR: cacheRoot,
    QWEN_DESKTOP_SKIP_BUILD: '1',
    QWEN_DESKTOP_TARGET: 'darwin-arm64',
    QWEN_TEST_FETCH_LOG: fetchLog,
    QWEN_TEST_NODE_ARCHIVE: archivePath,
    QWEN_TEST_NODE_CHECKSUMS: checksumsPath,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import=${pathToFileURL(fetchMock).href}`,
    ]
      .filter(Boolean)
      .join(' '),
    npm_execpath: process.env.npm_execpath || process.argv[1],
  };
  const first = spawnSync(process.execPath, [testScript], {
    encoding: 'utf8',
    env,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout, /Using cached Node\.js runtime/);
  assert.ok(fs.existsSync(cachedArchivePath));
  assert.ok(
    fs.existsSync(path.join(runtimeDir, 'qwen-code', 'checksums.json')),
  );
  for (const bundled of [
    path.join('lib', 'dovod-entry.js'),
    path.join('lib', 'cli-entry.js'),
    path.join('dovod', 'settings.template.json'),
    path.join('dovod', 'env.template'),
    path.join('dovod', 'mcp-server.template.json'),
    path.join('dovod', 'commands', 'prepare.toml'),
    path.join('dovod', 'commands', 'restore.toml'),
  ]) {
    assert.ok(
      fs.existsSync(path.join(runtimeDir, 'qwen-code', bundled)),
      `DOVOD runtime must bundle ${bundled}`,
    );
  }
  assert.equal(
    fs.existsSync(
      path.join(runtimeDir, 'qwen-code', 'dovod', 'dovod-entry.js'),
    ),
    false,
    'dovod-entry.js is installed under lib/, not duplicated in dovod/',
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(runtimeDir, 'qwen-code', 'manifest.json'),
        'utf8',
      ),
    ).product,
    'dovod',
  );

  const second = spawnSync(process.execPath, [testScript], {
    encoding: 'utf8',
    env,
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Using cached Node\.js runtime/);

  fs.appendFileSync(cachedArchivePath, 'tampered');
  const poisonedHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(cachedArchivePath))
    .digest('hex');
  fs.writeFileSync(
    path.join(cacheDir, 'SHASUMS256.txt'),
    `${poisonedHash}  ${archiveName}\n`,
  );
  const recoveredCache = spawnSync(process.execPath, [testScript], {
    encoding: 'utf8',
    env,
  });
  assert.equal(recoveredCache.status, 0, recoveredCache.stderr);
  assert.doesNotMatch(recoveredCache.stdout, /Using cached Node\.js runtime/);
  const fetches = fs.readFileSync(fetchLog, 'utf8').trim().split('\n');
  assert.equal(fetches.filter((url) => url.endsWith(archiveName)).length, 2);
  assert.equal(
    fetches.filter((url) => url.endsWith('SHASUMS256.txt')).length,
    3,
  );
  assert.equal(fs.existsSync(path.join(cacheDir, 'SHASUMS256.txt')), false);

  const marker = path.join(runtimeDir, 'qwen-code', 'complete-marker');
  fs.writeFileSync(marker, 'preserve me');
  const strandedRoot = path.join(runtimeDir, '.prepare-stranded');
  fs.mkdirSync(strandedRoot);
  fs.renameSync(
    path.join(runtimeDir, 'qwen-code'),
    path.join(strandedRoot, 'previous'),
  );
  fs.rmSync(path.join(sourceRoot, 'LICENSE'));
  const failed = spawnSync(process.execPath, [testScript], {
    encoding: 'utf8',
    env,
  });
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve me');
  assert.deepEqual(
    fs.readdirSync(runtimeDir).filter((entry) => entry.startsWith('.prepare-')),
    [],
  );
}

function testUpdaterMirrorConfiguration() {
  const endpoints = tauriConfig.plugins?.updater?.endpoints ?? [];
  assert.ok(endpoints.length > 0, 'the updater plugin needs an endpoint list');
  for (const endpoint of endpoints) {
    assert.doesNotMatch(
      endpoint,
      /aliyuncs\.com|QwenLM/,
      'DOVOD must never poll the upstream Qwen update feeds',
    );
    assert.match(endpoint, /^https:\/\/updates\.dovod\.law\//);
  }
  const pubkeyText = Buffer.from(
    tauriConfig.plugins.updater.pubkey,
    'base64',
  ).toString('utf8');
  assert.match(
    pubkeyText,
    /DOVOD PLACEHOLDER/,
    'the placeholder updater key must be replaced deliberately, not inherited',
  );
  const main = fs.readFileSync(
    path.join(packageDir, 'src-tauri', 'src', 'main.rs'),
    'utf8',
  );
  assert.match(
    main,
    /const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs\(3\);/,
  );
  assert.match(
    main,
    /app\.updater_builder\(\)\s*\.timeout\(UPDATE_CHECK_TIMEOUT\)/,
  );
  assert.equal((main.match(/check_for_update\(&app\)/g) ?? []).length, 2);
}

function testBootstrapBridgeConfiguration() {
  assert.equal(
    tauriConfig.app?.withGlobalTauri,
    true,
    'The Bootstrap UI requires window.__TAURI__ for desktop commands.',
  );
  assert.deepEqual(
    tauriConfig.app?.security?.capabilities,
    ['bootstrap', 'web-shell-external-url'],
    'The local bootstrap and remote Web Shell capabilities must be enabled.',
  );
  const capability = JSON.parse(
    fs.readFileSync(
      path.join(packageDir, 'src-tauri', 'capabilities', 'bootstrap.json'),
      'utf8',
    ),
  );
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(
    capability.remote,
    undefined,
    'The bootstrap capability must not grant remote IPC access.',
  );
  assert.deepEqual(capability.permissions, [
    'core:event:allow-listen',
    'core:event:allow-unlisten',
  ]);

  const webShellCapability = JSON.parse(
    fs.readFileSync(
      path.join(
        packageDir,
        'src-tauri',
        'capabilities',
        'web-shell-external-url.json',
      ),
      'utf8',
    ),
  );
  assert.equal(webShellCapability.local, false);
  assert.deepEqual(webShellCapability.remote, {
    urls: ['http://127.0.0.1:*'],
  });
  assert.deepEqual(webShellCapability.windows, ['main']);
  assert.deepEqual(webShellCapability.permissions, [
    {
      identifier: 'opener:allow-open-url',
      allow: [{ url: 'http://*' }, { url: 'https://*' }, { url: 'mailto:*' }],
    },
  ]);
}

function testResolveLogRoot() {
  const paths = {
    isolatedHome: path.join('/', 'home'),
    isolatedState: path.join('/', 'state'),
    appId: tauriConfig.identifier,
  };

  assert.equal(
    resolveLogRoot('darwin', {}, paths),
    path.join('/', 'home', 'Library', 'Logs', tauriConfig.identifier),
  );
  assert.equal(
    resolveLogRoot('linux', {}, paths),
    path.join('/', 'state', tauriConfig.identifier, 'logs'),
  );
  assert.equal(
    resolveLogRoot('win32', { LOCALAPPDATA: path.join('C:', 'x') }, paths),
    path.join('C:', 'x', tauriConfig.identifier, 'logs'),
  );
  assert.throws(
    () => resolveLogRoot('win32', {}, paths),
    /LOCALAPPDATA is required/,
  );

  // Structural invariants that cannot be tested through the exported helper:
  // the smoke must not override LOCALAPPDATA in the child env, and the
  // pre-spawn snapshot must precede the spawn call.
  const smoke = fs.readFileSync(
    path.join(packageDir, 'scripts', 'smoke-packaged.js'),
    'utf8',
  );
  assert.doesNotMatch(smoke, /^\s*LOCALAPPDATA:/m);
  assert.match(
    smoke,
    /QWEN_DESKTOP_DISABLE_SETTINGS_PERSISTENCE: '1'/,
    'Windows packaged smoke must not persist its temporary desktop state',
  );
  assert.match(
    smoke,
    /const logRoot = resolveLogRoot\(process\.platform, process\.env, \{/,
    'smoke must resolve log root via resolveLogRoot',
  );
  assert.match(
    smoke,
    /const appId = JSON\.parse\(\s*fs\.readFileSync\(\s*path\.join\(packageDir, 'src-tauri', 'tauri\.conf\.json'\),\s*'utf8',\s*\),\s*\)\.identifier;/,
    'smoke appId must be derived from the tauri.conf.json identifier',
  );
  const previousLogIndex = smoke.indexOf(
    'let previousLog = fs.readFileSync(logPath',
  );
  const spawnIndex = smoke.indexOf('const child = spawn(executable');
  assert.notEqual(previousLogIndex, -1, 'smoke must capture previousLog');
  assert.notEqual(spawnIndex, -1, 'smoke must spawn the child');
  assert.ok(
    previousLogIndex < spawnIndex,
    'previousLog must be captured before the child is spawned',
  );
  const readNewLogCalls = smoke.match(/const contents = readNewLog\(\)/g);
  assert.ok(
    readNewLogCalls && readNewLogCalls.length === 1,
    'the polling loop must be the only incremental readNewLog() call site',
  );
  assert.match(
    smoke,
    /console\.warn\([\s\S]*?previousLog = contents;/,
    'a rewritten log must warn and rebase the slice baseline',
  );
  assert.match(
    smoke,
    /const contents = fs\.readFileSync\(logPath, \{\s*encoding: 'utf8',\s*flag: 'a\+',\s*\}\);\s*throw smokeError\('Timed out waiting for packaged desktop runtime\.', contents\);/,
    'the timeout error must embed the full log, not the incremental delta',
  );
  assert.match(
    smoke,
    /sliceNewLog\(/,
    'smoke must slice the log via the tested sliceNewLog helper',
  );
  assert.match(
    smoke,
    /function smokeError[\s\S]*?Log: \$\{logPath\}/,
    'smokeError must embed the log path like the timeout error does',
  );
}

function testSliceNewLog() {
  assert.deepEqual(sliceNewLog('hello', ''), {
    text: 'hello',
    baseline: '',
  });
  assert.deepEqual(sliceNewLog('hello world', 'hello'), {
    text: ' world',
    baseline: 'hello',
  });
  assert.deepEqual(sliceNewLog('new', 'old'), {
    text: 'new',
    baseline: '',
  });
}

function testUpdateManifest(directory) {
  const assets = path.join(directory, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const artifacts = [
    'Qwen-Code-aarch64-apple-darwin.app.tar.gz',
    'Qwen-Code-x86_64-apple-darwin.app.tar.gz',
    'Qwen-Code_0.1.0_x64-setup.exe',
    'Qwen-Code_0.1.0_amd64.AppImage',
  ];
  for (const artifact of artifacts) {
    assert.ok(
      !artifact.includes(' '),
      `Artifact name must not contain spaces: ${artifact}`,
    );
  }
  for (const artifact of artifacts) {
    fs.writeFileSync(path.join(assets, artifact), artifact);
    fs.writeFileSync(
      path.join(assets, `${artifact}.sig`),
      `signature:${artifact}\n`,
    );
  }
  const output = path.join(directory, 'desktop-latest.json');
  execFileSync(process.execPath, [
    manifestScript,
    '--assets',
    assets,
    '--repository',
    'QwenLM/qwen-code',
    '--tag',
    'desktop-v0.1.0',
    '--version',
    '0.1.0',
    '--output',
    output,
  ]);
  const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'darwin-aarch64',
    'darwin-x86_64',
    'linux-x86_64',
    'windows-x86_64',
  ]);
  for (const [platform, artifact] of [
    ['darwin-aarch64', artifacts[0]],
    ['darwin-x86_64', artifacts[1]],
    ['windows-x86_64', artifacts[2]],
    ['linux-x86_64', artifacts[3]],
  ]) {
    assert.equal(
      manifest.platforms[platform].signature,
      `signature:${artifact}`,
    );
    assert.equal(
      manifest.platforms[platform].url,
      `https://github.com/QwenLM/qwen-code/releases/download/desktop-v0.1.0/${encodeURIComponent(artifact)}`,
    );
  }

  execFileSync(process.execPath, [
    manifestScript,
    '--assets',
    assets,
    '--repository',
    'QwenLM/qwen-code',
    '--tag',
    'desktop-v0.1.0',
    '--version',
    '0.1.0',
    '--base-url',
    'https://mirror.example/desktop/v0.1.0/',
    '--output',
    output,
  ]);
  const mirrorManifest = JSON.parse(fs.readFileSync(output, 'utf8'));
  for (const [platform, artifact] of [
    ['darwin-aarch64', artifacts[0]],
    ['darwin-x86_64', artifacts[1]],
    ['windows-x86_64', artifacts[2]],
    ['linux-x86_64', artifacts[3]],
  ]) {
    assert.equal(
      mirrorManifest.platforms[platform].url,
      `https://mirror.example/desktop/v0.1.0/${encodeURIComponent(artifact)}`,
    );
  }

  fs.rmSync(path.join(assets, `${artifacts[3]}.sig`));
  const failure = spawnSync(
    process.execPath,
    [
      manifestScript,
      '--assets',
      assets,
      '--repository',
      'QwenLM/qwen-code',
      '--tag',
      'desktop-v0.1.0',
      '--version',
      '0.1.0',
      '--output',
      output,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /Missing updater signature/);
}

function testElectronBridgeManifest(directory) {
  const assets = path.join(directory, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const artifacts = [
    'Qwen-Code-Desktop-arm64.zip',
    'Qwen-Code-Desktop-x64.zip',
    'Qwen-Code-Desktop-arm64.dmg',
    'Qwen-Code-Desktop-x64.dmg',
  ];
  for (const artifact of artifacts) {
    fs.writeFileSync(path.join(assets, artifact), `contents:${artifact}`);
  }
  artifacts.push(
    'Qwen-Code-Desktop_0.1.0_x64-setup.exe',
    'Qwen-Code-Desktop_0.1.0_amd64.AppImage',
  );
  for (const artifact of artifacts.slice(4)) {
    fs.writeFileSync(path.join(assets, artifact), `contents:${artifact}`);
  }
  const macOutput = path.join(directory, 'latest-mac.yml');
  for (const [platform, filename, selected] of [
    ['macos', 'latest-mac.yml', artifacts.slice(0, 4)],
    ['windows', 'latest.yml', artifacts.slice(4, 5)],
    ['linux', 'latest-linux.yml', artifacts.slice(5, 6)],
  ]) {
    const output = path.join(directory, filename);
    execFileSync(process.execPath, [
      electronBridgeScript,
      '--assets',
      assets,
      '--platform',
      platform,
      '--version',
      '0.1.0',
      '--output',
      output,
    ]);
    const manifest = fs.readFileSync(output, 'utf8');
    assert.match(manifest, /^version: 0\.1\.0$/m);
    assert.match(
      manifest,
      /^releaseDate: '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z'$/m,
    );
    for (const artifact of selected) {
      const contents = fs.readFileSync(path.join(assets, artifact));
      const sha512 = crypto
        .createHash('sha512')
        .update(contents)
        .digest('base64');
      assert.match(
        manifest,
        new RegExp(
          `^  - url: ${artifact.replaceAll('.', '\\.')}\\n    sha512: ${sha512.replaceAll('+', '\\+')}\\n    size: ${contents.length}$`,
          'm',
        ),
      );
      if (artifact === selected[0]) {
        assert.match(
          manifest,
          new RegExp(`^path: ${artifact.replaceAll('.', '\\.')}$`, 'm'),
        );
        assert.match(
          manifest,
          new RegExp(`^sha512: ${sha512.replaceAll('+', '\\+')}$`, 'm'),
        );
      }
    }
    assert.equal(
      (manifest.match(/^ {2}- url:/gm) ?? []).length,
      selected.length,
    );
  }
  const duplicateWindowsArtifact = path.join(
    assets,
    'Qwen-Code-Desktop_0.1.0_arm64-setup.exe',
  );
  fs.writeFileSync(duplicateWindowsArtifact, 'duplicate');
  const ambiguousWindows = spawnSync(
    process.execPath,
    [
      electronBridgeScript,
      '--assets',
      assets,
      '--platform',
      'windows',
      '--version',
      '0.1.0',
      '--output',
      path.join(directory, 'ambiguous-windows.yml'),
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(ambiguousWindows.status, 0);
  assert.match(ambiguousWindows.stderr, /found 2/);
  fs.rmSync(duplicateWindowsArtifact);

  fs.rmSync(path.join(assets, artifacts[1]));
  const failure = spawnSync(
    process.execPath,
    [
      electronBridgeScript,
      '--assets',
      assets,
      '--platform',
      'macos',
      '--version',
      '0.1.0',
      '--output',
      macOutput,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /Expected one Electron bridge artifact/);

  const invalidVersion = spawnSync(
    process.execPath,
    [
      electronBridgeScript,
      '--assets',
      assets,
      '--platform',
      'macos',
      '--version',
      '0.1',
      '--output',
      macOutput,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(invalidVersion.status, 0);
  assert.match(invalidVersion.stderr, /Invalid --version/);

  const missingOutput = spawnSync(
    process.execPath,
    [
      electronBridgeScript,
      '--assets',
      assets,
      '--platform',
      'macos',
      '--version',
      '0.1.0',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(missingOutput.status, 0);
  assert.match(missingOutput.stderr, /Missing --output/);
}

function testVersionSynchronization(directory) {
  fs.mkdirSync(path.join(directory, 'src-tauri'), { recursive: true });
  fs.copyFileSync(
    path.join(packageDir, 'package.json'),
    path.join(directory, 'package.json'),
  );
  fs.copyFileSync(
    path.join(packageDir, 'src-tauri', 'Cargo.toml'),
    path.join(directory, 'src-tauri', 'Cargo.toml'),
  );
  fs.copyFileSync(
    path.join(packageDir, 'src-tauri', 'tauri.conf.json'),
    path.join(directory, 'src-tauri', 'tauri.conf.json'),
  );
  execFileSync(process.execPath, [versionScript, '1.2.3'], {
    cwd: directory,
    env: { ...process.env, QWEN_DESKTOP_PACKAGE_DIR: directory },
  });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
      .version,
    '1.2.3',
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(directory, 'src-tauri', 'tauri.conf.json'),
        'utf8',
      ),
    ).version,
    '1.2.3',
  );
  assert.match(
    fs.readFileSync(path.join(directory, 'src-tauri', 'Cargo.toml'), 'utf8'),
    /^version = "1\.2\.3"$/m,
  );
}

function testDovodSeeding(directory) {
  const resourceDir = path.join(packageDir, 'dovod');
  const commandNames = [
    'prepare',
    'inventory',
    'position',
    'stage',
    'draft',
    'reconcile',
    'restore',
  ];
  assert.deepEqual(
    fs
      .readdirSync(path.join(resourceDir, 'commands'))
      .filter((name) => name.endsWith('.toml'))
      .map((name) => name.replace(/\.toml$/, ''))
      .sort(),
    [...commandNames].sort(),
    'the seven DOVOD commands must ship as TOML templates',
  );
  for (const name of commandNames) {
    const toml = fs.readFileSync(
      path.join(resourceDir, 'commands', `${name}.toml`),
      'utf8',
    );
    assert.match(toml, /^description = ".*[\u0400-\u04FF].*"$/m);
    assert.match(toml, /^prompt = ['"]/m);
  }
  const template = JSON.parse(
    fs.readFileSync(path.join(resourceDir, 'settings.template.json'), 'utf8'),
  );
  assert.equal(template.$version, 4);
  assert.equal(template.security.auth.selectedType, 'openai');
  assert.equal(template.model.name, '${DOVOD_MODEL}');
  const [route] = template.modelProviders.openai;
  assert.equal(route.id, '${DOVOD_MODEL}');
  assert.equal(route.envKey, 'DOVOD_API_KEY');
  assert.equal(route.baseUrl, '${DOVOD_API_BASE}');
  assert.equal(
    JSON.stringify(template).includes('sk-'),
    false,
    'no credential may be baked into the settings template',
  );
  const envTemplate = fs.readFileSync(
    path.join(resourceDir, 'env.template'),
    'utf8',
  );
  for (const key of ['DOVOD_API_BASE', 'DOVOD_API_KEY', 'DOVOD_MODEL']) {
    assert.match(envTemplate, new RegExp(`^${key}=$`, 'm'));
  }

  assert.equal(
    resolveQwenHome({}, path.join('/', 'home', 'user')),
    path.join('/', 'home', 'user', '.qwen'),
  );
  assert.equal(
    resolveQwenHome({ QWEN_HOME: '~/custom' }, path.join('/', 'home', 'user')),
    path.join('/', 'home', 'user', 'custom'),
  );

  // First launch: everything is created.
  const qwenHome = path.join(directory, 'home', '.qwen');
  const first = seedDovod({ resourceDir, qwenHome });
  assert.equal(first.commands, commandNames.length);
  assert.equal(first.env, true);
  assert.equal(first.settings, 'created');
  const created = JSON.parse(
    fs.readFileSync(path.join(qwenHome, 'settings.json'), 'utf8'),
  );
  assert.equal(created.security.auth.selectedType, 'openai');
  assert.equal(
    created.mcpServers.dovod,
    undefined,
    'the PLACEHOLDER MCP server must not be registered',
  );
  assert.ok(fs.existsSync(path.join(qwenHome, '.env')));

  // Second launch: nothing changes, user edits survive.
  const editedCommand = path.join(qwenHome, 'commands', 'dovod', 'draft.toml');
  fs.writeFileSync(editedCommand, 'prompt = "user edit"\n');
  fs.writeFileSync(path.join(qwenHome, '.env'), 'DOVOD_API_KEY=user\n');
  const second = seedDovod({ resourceDir, qwenHome });
  assert.deepEqual(second, { commands: 0, env: false, settings: 'unchanged' });
  assert.equal(
    fs.readFileSync(editedCommand, 'utf8'),
    'prompt = "user edit"\n',
  );
  assert.equal(
    fs.readFileSync(path.join(qwenHome, '.env'), 'utf8'),
    'DOVOD_API_KEY=user\n',
  );

  // Existing settings: only absent keys are merged.
  fs.writeFileSync(
    path.join(qwenHome, 'settings.json'),
    JSON.stringify({
      $version: 4,
      security: { auth: { selectedType: 'anthropic' } },
      mcpServers: { other: { command: 'x' } },
      ui: { theme: 'dark' },
    }),
  );
  const merged = seedDovod({ resourceDir, qwenHome });
  assert.equal(merged.settings, 'merged');
  const mergedSettings = JSON.parse(
    fs.readFileSync(path.join(qwenHome, 'settings.json'), 'utf8'),
  );
  assert.equal(mergedSettings.security.auth.selectedType, 'anthropic');
  assert.equal(mergedSettings.ui.theme, 'dark');
  assert.equal(mergedSettings.mcpServers.other.command, 'x');
  assert.equal(mergedSettings.model.name, '${DOVOD_MODEL}');
  assert.equal(mergedSettings.modelProviders.openai[0].envKey, 'DOVOD_API_KEY');

  // A real MCP template is added exactly once and never overwritten.
  const realResources = path.join(directory, 'resources');
  fs.cpSync(resourceDir, realResources, { recursive: true });
  fs.writeFileSync(
    path.join(realResources, 'mcp-server.template.json'),
    JSON.stringify({ command: 'dovod-mcp', args: ['--stdio'] }),
  );
  assert.equal(
    seedDovod({ resourceDir: realResources, qwenHome }).settings,
    'merged',
  );
  const withMcp = JSON.parse(
    fs.readFileSync(path.join(qwenHome, 'settings.json'), 'utf8'),
  );
  assert.deepEqual(withMcp.mcpServers.dovod, {
    command: 'dovod-mcp',
    args: ['--stdio'],
  });
  withMcp.mcpServers.dovod.args = ['--user-edited'];
  fs.writeFileSync(
    path.join(qwenHome, 'settings.json'),
    JSON.stringify(withMcp),
  );
  assert.equal(
    seedDovod({ resourceDir: realResources, qwenHome }).settings,
    'unchanged',
  );
  assert.equal(
    mergeDovodSettings(
      { modelProviders: { openai: [{ id: 'mine' }] } },
      template,
      undefined,
    ),
    true,
    'selectedType/model.name are still filled when only modelProviders exist',
  );

  // Settings with comments are left alone rather than clobbered.
  fs.writeFileSync(
    path.join(qwenHome, 'settings.json'),
    '{\n  // user comment\n  "ui": {}\n}\n',
  );
  assert.equal(seedDovod({ resourceDir, qwenHome }).settings, 'unparseable');
  assert.match(
    fs.readFileSync(path.join(qwenHome, 'settings.json'), 'utf8'),
    /user comment/,
  );

  // Without DOVOD_TOOLS the commands keep the __DOVOD_TOOLS__ token and no
  // MCP server is registered (checked above). With DOVOD_TOOLS in .env the
  // token is resolved in every command and in the MCP template.
  for (const name of commandNames) {
    assert.match(
      fs.readFileSync(path.join(resourceDir, 'commands', `${name}.toml`), 'utf8'),
      /__DOVOD_TOOLS__/,
      `${name}.toml must reference dovod-tools through the __DOVOD_TOOLS__ token`,
    );
  }
  const toolsPath = path.join('C:', 'tools', 'dovod-tools');
  const toolsHome = path.join(directory, 'tools-home', '.qwen');
  fs.mkdirSync(toolsHome, { recursive: true });
  fs.writeFileSync(path.join(toolsHome, '.env'), `DOVOD_TOOLS=${toolsPath}\n`);
  assert.equal(resolveDovodTools(toolsHome, {}), toolsPath);
  assert.equal(
    resolveDovodTools(toolsHome, { DOVOD_TOOLS: '/opt/dovod-tools' }),
    '/opt/dovod-tools',
    'the environment wins over .env',
  );
  const seededWithTools = seedDovod({ resourceDir, qwenHome: toolsHome });
  assert.equal(seededWithTools.commands, commandNames.length);
  assert.equal(seededWithTools.settings, 'created');
  for (const name of commandNames) {
    const seeded = fs.readFileSync(
      path.join(toolsHome, 'commands', 'dovod', `${name}.toml`),
      'utf8',
    );
    assert.equal(seeded.includes('__DOVOD_TOOLS__'), false);
    assert.ok(seeded.includes(toolsPath), `${name}.toml resolves DOVOD_TOOLS`);
  }
  const toolsSettings = JSON.parse(
    fs.readFileSync(path.join(toolsHome, 'settings.json'), 'utf8'),
  );
  assert.equal(toolsSettings.mcpServers.dovod.command, 'node');
  assert.equal(toolsSettings.mcpServers.dovod.args.length, 1);
  assert.ok(
    toolsSettings.mcpServers.dovod.args[0].startsWith(toolsPath),
    'the MCP server path is resolved from DOVOD_TOOLS',
  );
  assert.equal(
    toolsSettings.mcpServers.dovod.args[0].includes('__DOVOD_TOOLS__'),
    false,
  );
}
