#!/usr/bin/env node
// DOVOD DESKTOP_016_D4: разовый скрипт, не часть продакшн-набора тестов.
//
// scripts/test-release.js целиком локально не проходит: testRuntimePreparation
// и testDovodToolsInstallation вызывают `tar -czf`/`-cf` напрямую, а BSD tar на
// этой машине принимает путь вида "C:\Users\..." за "host:path" и пытается
// открыть удалённый архив вместо локального файла - особенность окружения, не
// связана с правками DESKTOP_016 (см. PROGRESS.md, записи D2 и D3; эталонный
// GNU tar в GitHub Actions этой ошибки не даёт).
//
// Этот скрипт запускает функции, которые в test-release.js идут в порядке
// вызова после testRuntimePreparation - testDovodToolsInstallation и
// testDovodSeeding - без единой правки боевых scripts/test-release.js и
// dovod/scripts/prepare-runtime.js. Делает это так:
//   1. читает test-release.js как текст;
//   2. убирает верхнеуровневый блок, который сам запускает все проверки при
//      импорте файла (иначе он тоже упадёт на tar раньше, чем мы доберёмся
//      до нужных функций);
//   3. добавляет флаг `--force-local` перед `-czf`/`-cf` в собственных вызовах
//      tar внутри test-release.js - это штатный флаг BSD tar, отключающий
//      догадку "host:path" только для архивов на диске; правка существует
//      только в этой временной копии, в файле из git её нет;
//   4. дописывает вызов двух нужных функций с перехватом ошибок каждой по
//      отдельности, чтобы падение одной не скрыло результат другой;
//   5. выполняет получившийся текст как отдельный временный файл рядом с
//      оригиналом (чтобы относительные импорты ./resolve-log-root.js и
//      ../dovod/dovod-entry.js остались верными), затем удаляет временный файл.
//
// testDovodToolsInstallation внутри себя запускает dovod-shell/scripts/
// prepare-runtime.js отдельным процессом, а тот сам вызывает `tar -xf` при
// распаковке (функция extractNodeArchive) - это боевой код, здесь он не
// тронут. Если то же BSD tar той машины сломает и этот шаг, testDovodToolsInstallation
// ожидаемо упадёт именно там, и это видно в выводе отдельно от testDovodSeeding.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(here, '..', 'scripts');
const originalPath = path.join(scriptsDir, 'test-release.js');

const original = fs.readFileSync(originalPath, 'utf8');

const runStartMarker = 'const root = fs.mkdtempSync(';
const runStart = original.indexOf(runStartMarker);
if (runStart === -1) {
  throw new Error(
    'DESKTOP_016_D4 harness: маркер верхнеуровневого блока не найден - test-release.js изменил форму, обновите этот скрипт',
  );
}
const runEndMarker = '\n}\n';
const runEnd = original.indexOf(runEndMarker, runStart);
if (runEnd === -1) {
  throw new Error('DESKTOP_016_D4 harness: конец верхнеуровневого блока не найден');
}
let patched =
  original.slice(0, runStart) + original.slice(runEnd + runEndMarker.length);

function patchTar(label, needle) {
  const before = patched;
  patched = patched.replace(needle, `'--force-local',\n    ${needle}`);
  if (patched === before) {
    throw new Error(`DESKTOP_016_D4 harness: не удалось подменить вызов tar (${label})`);
  }
}
patchTar('testRuntimePreparation -czf', "'-czf',");
patchTar('testDovodToolsInstallation -cf', "'-cf',");

patched += `
// --- DESKTOP_016_D4 harness: хвостовые вызовы для этого разового прогона ---
const harnessResults = [];
function harnessRun(name, fn) {
  try {
    fn();
    harnessResults.push([name, 'OK']);
    console.log(\`[\${name}] OK\`);
  } catch (error) {
    harnessResults.push([name, 'FAIL']);
    console.log(\`[\${name}] FAIL: \${error.stack || error.message}\`);
  }
}
const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dovod-tail-tests-'));
try {
  harnessRun('testDovodToolsInstallation', () =>
    testDovodToolsInstallation(path.join(harnessRoot, 'dovod-tools')),
  );
  harnessRun('testDovodSeeding', () =>
    testDovodSeeding(path.join(harnessRoot, 'dovod-seed')),
  );
} finally {
  fs.rmSync(harnessRoot, { recursive: true, force: true });
}
const failed = harnessResults.filter(([, status]) => status !== 'OK');
console.log(
  \`DESKTOP_016_D4 harness: \${harnessResults.length - failed.length}/\${harnessResults.length} passed\`,
);
process.exitCode = failed.length > 0 ? 1 : 0;
`;

const generatedPath = path.join(
  scriptsDir,
  '.desktop_016_d4_tail_harness.generated.mjs',
);
fs.writeFileSync(generatedPath, patched);
let result;
try {
  result = spawnSync(process.execPath, [generatedPath], { encoding: 'utf8' });
} finally {
  fs.rmSync(generatedPath, { force: true });
}

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exitCode = result.status ?? 1;
