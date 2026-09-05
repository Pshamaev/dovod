// Modified for DOVOD: user-facing copy translated to Russian.
const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

const title = document.querySelector('#title');
const detail = document.querySelector('#detail');
const pulse = document.querySelector('#pulse');
const workspace = document.querySelector('#workspace');
const error = document.querySelector('#error');
const choose = document.querySelector('#choose');
const retry = document.querySelector('#retry');
const logs = document.querySelector('#logs');
const update = document.querySelector('#update');
const version = document.querySelector('#version');

let currentWorkspace = '';
let snapshotOverrideStatus;
let updateVersion;

function setWorkspace(path) {
  workspace.hidden = !path;
  workspace.textContent = path || '';
}

function setStatus(kind, heading, message, failure = '') {
  document.body.dataset.state = kind;
  title.textContent = heading;
  detail.textContent = message;
  pulse.className = `pulse ${kind === 'starting' ? '' : kind}`;
  error.style.display = failure ? 'block' : 'none';
  error.textContent = failure;
  retry.hidden = kind !== 'error';
  choose.hidden = kind === 'starting';
  choose.disabled = kind === 'starting';
  setWorkspace(kind === 'starting' ? '' : currentWorkspace);
}

async function chooseWorkspace() {
  if (!invoke) return;
  snapshotOverrideStatus = 'starting';
  setStatus(
    'starting',
    'Открытие рабочей папки',
    'Запуск встроенной среды Довода…',
  );
  try {
    const path = await invoke('choose_workspace');
    if (path) currentWorkspace = path;
    else setStatus('idle', 'Выберите другую папку', 'Папка не выбрана.');
  } catch (failure) {
    setStatus(
      'error',
      'Не удалось открыть рабочую папку',
      'Посмотрите подробности или откройте журнал.',
      String(failure),
    );
  }
}

async function retryRuntime() {
  if (!invoke) return;
  snapshotOverrideStatus = 'starting';
  setStatus(
    'starting',
    'Перезапуск Довода',
    'Проверка встроенной среды и рабочей папки…',
  );
  try {
    await invoke('restart_runtime');
  } catch (failure) {
    setStatus(
      'error',
      'Не удалось перезапустить Довод',
      'Посмотрите подробности или выберите другую папку.',
      String(failure),
    );
  }
}

async function installUpdate() {
  if (!invoke) return;
  update.disabled = true;
  update.textContent = `Установка ${updateVersion || 'обновления'}…`;
  try {
    await invoke('install_update');
  } catch (failure) {
    setStatus(
      'error',
      'Обновление не удалось',
      'Довод продолжает работать. Повторите попытку или обновите вручную.',
      String(failure),
    );
  } finally {
    update.disabled = false;
    update.textContent = 'Установить обновление';
  }
}

async function openLogs() {
  if (!invoke) return;
  try {
    await invoke('open_logs');
  } catch (failure) {
    setStatus(
      'error',
      'Не удалось открыть журнал',
      'Посмотрите подробности или повторите попытку.',
      String(failure),
    );
  }
}

choose.addEventListener('click', chooseWorkspace);
retry.addEventListener('click', retryRuntime);
logs.addEventListener('click', openLogs);
update.addEventListener('click', installUpdate);

async function initialize() {
  if (!invoke || !listen) {
    setStatus(
      'error',
      'Мост приложения недоступен',
      'Встроенный мост приложения не инициализировался.',
      'Перезапустите Довод.',
    );
    return;
  }

  await Promise.all([
    listen('runtime-starting', ({ payload }) => {
      snapshotOverrideStatus = 'starting';
      currentWorkspace = String(payload || '');
      setStatus(
        'starting',
        'Запуск Довода',
        'Запуск встроенной среды и проверка её состояния…',
      );
    }),
    listen('runtime-failed', ({ payload }) => {
      snapshotOverrideStatus = 'failed';
      setStatus(
        'error',
        'Не удалось запустить Довод',
        'Посмотрите подробности, откройте журнал или выберите другую папку.',
        String(payload),
      );
    }),
    listen('update-available', ({ payload }) => {
      updateVersion = String(payload);
      update.hidden = false;
      update.textContent = `Установить ${updateVersion}`;
    }),
  ]);

  const state = await invoke('bootstrap_state');
  version.textContent = `Довод ${state.desktopVersion}`;
  currentWorkspace ||= String(state.workspace || '');
  if (snapshotOverrideStatus) {
    if (snapshotOverrideStatus === 'failed') setWorkspace(currentWorkspace);
    return;
  }
  if (state.status === 'starting') {
    setStatus(
      'starting',
      'Запуск Довода',
      'Запуск встроенной среды и проверка её состояния…',
    );
  } else if (state.status === 'ready') {
    setStatus(
      'starting',
      'Загрузка Довода',
      'Подключение к локальному интерфейсу…',
    );
  } else if (state.error) {
    setStatus(
      'error',
      'Не удалось запустить Довод',
      'Посмотрите подробности, откройте журнал или выберите другую папку.',
      state.error,
    );
  } else {
    setStatus(
      'idle',
      'Выберите другую папку',
      'Рабочая папка по умолчанию не запустилась.',
    );
  }
}

initialize().catch((failure) => {
  setStatus(
    'error',
    'Ошибка инициализации приложения',
    'Перезапустите Довод или посмотрите журнал.',
    String(failure),
  );
});
