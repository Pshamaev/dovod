#!/usr/bin/env node
// Modified for DOVOD: bundles the dovod/ resource folder, the dovod-entry.js
// runtime wrapper and the dovod-tools pipeline package next to the upstream CLI.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoRoot = path.resolve(packageDir, '../..');
const sourceRoot = process.env.QWEN_CODE_ROOT
  ? path.resolve(process.env.QWEN_CODE_ROOT)
  : repoRoot;
const runtimeDir = path.join(packageDir, 'runtime');
const finalPackageRoot = path.join(runtimeDir, 'qwen-code');
const refreshChecksums = process.argv.indexOf('--refresh-checksums');
if (refreshChecksums !== -1) {
  const root = process.argv[refreshChecksums + 1]
    ? path.resolve(process.argv[refreshChecksums + 1])
    : finalPackageRoot;
  writeChecksums(root);
  console.log(`Refreshed desktop runtime checksums at ${root}`);
  process.exit(0);
}
fs.mkdirSync(runtimeDir, { recursive: true });
recoverInterruptedRuntime();
const stagingRoot = fs.mkdtempSync(path.join(runtimeDir, '.prepare-'));
const packageRoot = path.join(stagingRoot, 'qwen-code');
const libDir = path.join(packageRoot, 'lib');
const nodeDir = path.join(packageRoot, 'node');
const qwenCodeVersion = JSON.parse(
  fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'),
).version;
const desktopVersion = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
).version;
const binDir = path.join(packageRoot, 'bin');
const dovodSourceDir = path.join(packageDir, 'dovod');
const dovodDir = path.join(packageRoot, 'dovod');
// DOVOD: the one place where the pipeline package version is pinned.
const dovodToolsConfig = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'dovod-tools.json'), 'utf8'),
);
const dovodToolsDir = path.join(packageRoot, 'dovod-tools');

const target = desktopTarget();
const skipBuild = process.env.QWEN_DESKTOP_SKIP_BUILD === '1';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('npm_execpath is unavailable. Run through npm.');

if (!skipBuild) {
  execFileSync(process.execPath, [npm, 'run', 'build', '--', '--cli-only'], {
    cwd: sourceRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [npm, 'run', 'bundle'], {
    cwd: sourceRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [npm, 'run', 'prepare:package'], {
    cwd: sourceRoot,
    stdio: 'inherit',
  });
}

const distDir = path.join(sourceRoot, 'dist');
for (const required of [
  'cli.js',
  'cli-entry.js',
  'web-shell/index.html',
  'web-shell/assets',
]) {
  const candidate = path.join(distDir, required);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Missing bundled runtime asset: ${candidate}`);
  }
}

try {
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, '.gitkeep'), '');
  fs.mkdirSync(binDir, { recursive: true });
  copyDirectory(distDir, libDir);
  bundleDovodResources();
  await installDovodTools(dovodToolsDir, target);
  await installNodeRuntime(nodeDir, target);
  writeLaunchers(target);
  copyRequiredFile(
    path.join(sourceRoot, 'LICENSE'),
    path.join(packageRoot, 'LICENSE'),
  );
  copyRequiredFile(
    path.join(packageDir, 'NOTICE'),
    path.join(packageRoot, 'NOTICE'),
  );
  const nodeLicense = path.join(nodeDir, 'LICENSE');
  if (!fs.existsSync(nodeLicense)) {
    throw new Error(`Bundled Node.js license is missing: ${nodeLicense}`);
  }
  fs.writeFileSync(
    path.join(packageRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        name: '@qwen-code/qwen-code',
        product: 'dovod',
        desktopVersion,
        qwenCodeVersion,
        qwenCodeCommit: process.env.QWEN_CODE_COMMIT || gitCommit(sourceRoot),
        target,
        node: `v${process.versions.node}`,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  writeChecksums();
  replaceRuntime();
} finally {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}
console.log(
  `Prepared desktop runtime at ${path.relative(repoRoot, finalPackageRoot)}`,
);

async function installNodeRuntime(destination, desktopTarget) {
  const nvmrc = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  const nodeVersion = process.versions.node;
  if (!nodeVersion.startsWith(`${nvmrc}.`)) {
    throw new Error(
      `Node ${nodeVersion} does not match .nvmrc major version ${nvmrc}. ` +
        'Run the correct Node or update .nvmrc.',
    );
  }
  const archiveName = nodeArchiveName(nodeVersion, desktopTarget);
  const downloadRoot = `https://nodejs.org/dist/v${nodeVersion}`;
  const cacheRoot = process.env.QWEN_DESKTOP_NODE_CACHE_DIR
    ? path.resolve(process.env.QWEN_DESKTOP_NODE_CACHE_DIR)
    : path.join(os.tmpdir(), 'qwen-desktop-node-cache');
  const cacheDir = path.join(cacheRoot, `v${nodeVersion}`);
  const cachedArchivePath = path.join(cacheDir, archiveName);
  fs.rmSync(path.join(cacheDir, 'SHASUMS256.txt'), { force: true });
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qwen-desktop-node-'),
  );
  try {
    const checksumsPath = path.join(temporaryRoot, 'SHASUMS256.txt');
    const archivePath = path.join(temporaryRoot, archiveName);
    await download(`${downloadRoot}/SHASUMS256.txt`, checksumsPath);
    const checksums = fs.readFileSync(checksumsPath, 'utf8');
    if (
      copyValidCachedArchive(
        cachedArchivePath,
        archivePath,
        archiveName,
        checksums,
      )
    ) {
      console.log(`Using cached Node.js runtime ${archiveName}`);
    } else {
      await download(`${downloadRoot}/${archiveName}`, archivePath);
      verifyChecksum(archivePath, archiveName, checksums);
      fs.mkdirSync(cacheDir, { recursive: true });
      const temporaryCachePath = `${cachedArchivePath}.${process.pid}.tmp`;
      try {
        fs.copyFileSync(archivePath, temporaryCachePath);
        fs.renameSync(temporaryCachePath, cachedArchivePath);
      } finally {
        fs.rmSync(temporaryCachePath, { force: true });
      }
    }
    extractNodeArchive(archivePath, temporaryRoot);
    const extractedRoot = path.join(
      temporaryRoot,
      archiveName.replace(/\.(tar\.gz|tar\.xz|zip)$/, ''),
    );
    if (!fs.existsSync(extractedRoot)) {
      throw new Error(`Extracted Node runtime is missing: ${extractedRoot}`);
    }
    copyDirectory(extractedRoot, destination);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function copyValidCachedArchive(
  cachedArchivePath,
  archivePath,
  archiveName,
  checksums,
) {
  if (!fs.existsSync(cachedArchivePath)) return false;
  try {
    fs.copyFileSync(cachedArchivePath, archivePath);
    verifyChecksum(archivePath, archiveName, checksums);
    return true;
  } catch {
    fs.rmSync(cachedArchivePath, { force: true });
    fs.rmSync(archivePath, { force: true });
    return false;
  }
}

function desktopTarget() {
  const target =
    process.env.QWEN_DESKTOP_TARGET || `${process.platform}-${process.arch}`;
  const aliases = {
    'aarch64-apple-darwin': 'darwin-arm64',
    'x86_64-apple-darwin': 'darwin-x64',
    'aarch64-unknown-linux-gnu': 'linux-arm64',
    'x86_64-unknown-linux-gnu': 'linux-x64',
    'x86_64-pc-windows-msvc': 'win32-x64',
  };
  const resolved = aliases[target] || target;
  if (
    ![
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-x64',
    ].includes(resolved)
  ) {
    throw new Error(`Unsupported desktop target: ${target}`);
  }
  return resolved;
}

function nodeArchiveName(version, desktopTarget) {
  const nodeTarget = desktopTarget === 'win32-x64' ? 'win-x64' : desktopTarget;
  const extension = desktopTarget.startsWith('darwin-')
    ? 'tar.gz'
    : desktopTarget.startsWith('linux-')
      ? 'tar.xz'
      : 'zip';
  return `node-v${version}-${nodeTarget}.${extension}`;
}

async function download(url, destination, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, fs.createWriteStream(destination));
}

function verifyChecksum(archivePath, archiveName, checksums) {
  const expected = checksums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find(([, fileName]) => fileName === archiveName)?.[0];
  if (!expected) {
    throw new Error(`Node checksums do not list ${archiveName}`);
  }
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(archivePath))
    .digest('hex');
  if (actual !== expected) {
    throw new Error(`Node runtime checksum mismatch for ${archiveName}`);
  }
}

function extractNodeArchive(archivePath, destination) {
  execFileSync('tar', ['-xf', archivePath, '-C', destination]);
}

function writeLaunchers(desktopTarget) {
  if (desktopTarget.startsWith('win32-')) {
    fs.writeFileSync(
      path.join(binDir, 'qwen.cmd'),
      '@echo off\r\nsetlocal\r\nset "ROOT=%~dp0.."\r\n"%ROOT%\\node\\node.exe" "%ROOT%\\lib\\cli-entry.js" %*\r\nexit /b %ERRORLEVEL%\r\n',
    );
    return;
  }
  const launcher =
    '#!/usr/bin/env sh\nset -e\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec "$ROOT/node/bin/node" "$ROOT/lib/cli-entry.js" "$@"\n';
  const launcherPath = path.join(binDir, 'qwen');
  fs.writeFileSync(launcherPath, launcher);
  fs.chmodSync(launcherPath, 0o755);
}

// Copies the DOVOD resource folder (command templates, settings/env/MCP
// templates) into the runtime and installs the dovod-entry.js wrapper that
// the desktop shell launches instead of cli-entry.js.
function bundleDovodResources() {
  const entrySource = path.join(dovodSourceDir, 'dovod-entry.js');
  for (const required of [
    entrySource,
    path.join(dovodSourceDir, 'settings.template.json'),
    path.join(dovodSourceDir, 'env.template'),
    path.join(dovodSourceDir, 'mcp-server.template.json'),
    path.join(dovodSourceDir, 'commands'),
  ]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Missing DOVOD resource: ${required}`);
    }
  }
  fs.mkdirSync(dovodDir, { recursive: true });
  fs.cpSync(dovodSourceDir, dovodDir, {
    recursive: true,
    dereference: true,
    filter: (entry) => {
      const name = path.basename(entry);
      return name !== '.DS_Store' && name !== 'dovod-entry.js';
    },
  });
  copyRequiredFile(entrySource, path.join(libDir, 'dovod-entry.js'));
}

// DOVOD: installs the case pipeline package (dovod-tools) into the runtime.
//
// The package is built from another repository (PyInstaller onedir, Windows
// only) and published as a private GitHub release asset: one `*.zip` plus its
// `*.sha256`. It is installed INSIDE packageRoot so writeChecksums() covers it
// and `npm run smoke:runtime` verifies it together with the Node.js runtime.
//
// Sources, in order of precedence:
//   DOVOD_TOOLS_DIR      - an already unpacked package tree (local work, tests)
//   DOVOD_TOOLS_ARCHIVE  - an already downloaded zip; its sha256 comes from
//                          DOVOD_TOOLS_SHA256 or from <archive>.sha256
//   DOVOD_TOOLS_TOKEN    - read-only token for the release (this is what CI uses)
// Without any of them the build stops with an explicit error instead of
// quietly producing an installer without the pipeline.
async function installDovodTools(destination, desktopTarget) {
  const entry = dovodToolsConfig.entry;
  const tag = process.env.DOVOD_TOOLS_TAG || dovodToolsConfig.tag;
  const repository =
    process.env.DOVOD_TOOLS_REPOSITORY || dovodToolsConfig.repository;
  if (!desktopTarget.startsWith('win32-')) {
    console.log(
      `Пакет конвейера собран только под Windows: цель ${desktopTarget} остаётся без dovod-tools.`,
    );
    return;
  }
  const localDir = (process.env.DOVOD_TOOLS_DIR || '').trim();
  if (localDir) {
    installDovodToolsTree(path.resolve(localDir), destination, entry);
    console.log(`Пакет конвейера взят из папки ${localDir}`);
    return;
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dovod-tools-'));
  try {
    const localArchive = (process.env.DOVOD_TOOLS_ARCHIVE || '').trim();
    let archivePath;
    let expected;
    if (localArchive) {
      archivePath = path.resolve(localArchive);
      expected = readDovodToolsChecksum(
        process.env.DOVOD_TOOLS_SHA256 &&
          path.resolve(process.env.DOVOD_TOOLS_SHA256),
        `${archivePath}.sha256`,
      );
    } else {
      const token = (process.env.DOVOD_TOOLS_TOKEN || '').trim();
      if (!token) {
        throw new Error(
          [
            `Нет пакета конвейера (dovod-tools ${tag}), установщик без него не собирается.`,
            'Задайте один из вариантов:',
            `  DOVOD_TOOLS_TOKEN - токен чтения релизов ${repository} (так работает сборка в GitHub Actions);`,
            '  DOVOD_TOOLS_ARCHIVE - путь к уже скачанному zip рядом с файлом .sha256;',
            '  DOVOD_TOOLS_DIR - путь к уже распакованной папке пакета.',
          ].join('\n'),
        );
      }
      const assets = await findDovodToolsAssets(repository, tag, token);
      archivePath = path.join(temporaryRoot, assets.archive.name);
      const checksumPath = path.join(temporaryRoot, assets.checksum.name);
      await download(assets.archive.url, archivePath, releaseAssetHeaders(token));
      await download(
        assets.checksum.url,
        checksumPath,
        releaseAssetHeaders(token),
      );
      expected = readDovodToolsChecksum(checksumPath);
      console.log(
        `Пакет конвейера скачан: ${assets.archive.name} (релиз ${tag} в ${repository})`,
      );
    }
    const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(archivePath))
      .digest('hex');
    if (actual !== expected) {
      throw new Error(
        `Контрольная сумма пакета конвейера не совпала: ожидалось ${expected}, получено ${actual}`,
      );
    }
    const unpacked = path.join(temporaryRoot, 'unpacked');
    fs.mkdirSync(unpacked, { recursive: true });
    extractNodeArchive(archivePath, unpacked);
    installDovodToolsTree(dovodToolsRoot(unpacked, entry), destination, entry);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function releaseAssetHeaders(token) {
  return {
    Accept: 'application/octet-stream',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'dovod-desktop-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Resolves the release by tag and picks exactly one `*.zip` asset and exactly
// one `*.sha256` asset, so the exact asset name may change in the packaging
// repository without a change here.
async function findDovodToolsAssets(repository, tag, token) {
  const url = `https://api.github.com/repos/${repository}/releases/tags/${tag}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dovod-desktop-build',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `Релиз ${tag} в ${repository} не прочитан: HTTP ${response.status}. ` +
        'Проверьте тег и права токена DOVOD_TOOLS_TOKEN (Contents: read).',
    );
  }
  const release = await response.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const pick = (suffix) => {
    const found = assets.filter((asset) => asset.name?.endsWith(suffix));
    if (found.length !== 1) {
      throw new Error(
        `Релиз ${tag} в ${repository} должен содержать ровно один ассет ${suffix}, найдено ${found.length}.`,
      );
    }
    return { name: found[0].name, url: found[0].url };
  };
  const checksum = pick('.sha256');
  const archive = assets.filter(
    (asset) => asset.name?.endsWith('.zip') && asset.name !== checksum.name,
  );
  if (archive.length !== 1) {
    throw new Error(
      `Релиз ${tag} в ${repository} должен содержать ровно один ассет .zip, найдено ${archive.length}.`,
    );
  }
  return { archive: { name: archive[0].name, url: archive[0].url }, checksum };
}

// A .sha256 file is either a bare hash or the `sha256sum` format
// (`<hash>  <file>`); both are accepted.
function readDovodToolsChecksum(...candidates) {
  const file = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
  if (!file) {
    throw new Error(
      `Файл контрольной суммы пакета конвейера не найден: ${candidates.filter(Boolean).join(', ')}`,
    );
  }
  const match = /\b[0-9a-f]{64}\b/.exec(fs.readFileSync(file, 'utf8'));
  if (!match) {
    throw new Error(`В файле ${file} нет суммы sha256`);
  }
  return match[0];
}

// The archive may hold the package tree at its root or inside a single
// top-level directory; both layouts resolve to the directory with the entry.
function dovodToolsRoot(directory, entry) {
  if (fs.existsSync(path.join(directory, entry))) return directory;
  const nested = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .map((candidate) => path.join(directory, candidate.name));
  const match = nested.find((candidate) =>
    fs.existsSync(path.join(candidate, entry)),
  );
  if (!match) {
    throw new Error(
      `В пакете конвейера нет ${entry}: ${directory} (проверьте сборку пакета)`,
    );
  }
  return match;
}

function installDovodToolsTree(source, destination, entry) {
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Папка пакета конвейера не найдена: ${source}`);
  }
  if (!fs.statSync(path.join(source, entry), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`В пакете конвейера нет ${entry}: ${source}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  copyDirectory(source, destination);
}

function copyRequiredFile(source, destination) {
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Required desktop runtime file is missing: ${source}`);
  }
  fs.copyFileSync(source, destination);
}

function gitCommit(directory) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: directory,
    encoding: 'utf8',
  }).trim();
}

function writeChecksums(root = packageRoot) {
  const checksums = {};
  for (const file of runtimeFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === 'checksums.json') continue;
    checksums[relative] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
  }
  fs.writeFileSync(
    path.join(root, 'checksums.json'),
    `${JSON.stringify(checksums, null, 2)}\n`,
  );
}

function runtimeFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? runtimeFiles(absolute) : [absolute];
    })
    .sort();
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (entry) => path.basename(entry) !== '.DS_Store',
  });
}

function recoverInterruptedRuntime() {
  for (const entry of fs.readdirSync(runtimeDir)) {
    if (!entry.startsWith('.prepare-')) continue;
    const staleRoot = path.join(runtimeDir, entry);
    const previousRoot = path.join(staleRoot, 'previous');
    if (!fs.existsSync(finalPackageRoot) && fs.existsSync(previousRoot)) {
      fs.renameSync(previousRoot, finalPackageRoot);
    }
    fs.rmSync(staleRoot, { recursive: true, force: true });
  }
}

function replaceRuntime() {
  const previousRoot = path.join(stagingRoot, 'previous');
  if (fs.existsSync(finalPackageRoot)) {
    fs.renameSync(finalPackageRoot, previousRoot);
  }
  try {
    fs.renameSync(packageRoot, finalPackageRoot);
  } catch (error) {
    if (fs.existsSync(previousRoot)) {
      fs.renameSync(previousRoot, finalPackageRoot);
    }
    throw error;
  }
}
