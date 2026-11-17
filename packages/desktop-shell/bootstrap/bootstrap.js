// Modified for DOVOD: экраны приветствия, открытия дела и хода дела с
// автопилотом. Логика конвейера здесь не дублируется: шаги, которые оболочка
// проходит сама, вызывают те же подкоманды, что и команды Довода в переписке.
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
const status = document.querySelector('#status');
const welcome = document.querySelector('#welcome');
const welcomeOpen = document.querySelector('#welcome-open');
const welcomeDemo = document.querySelector('#welcome-demo');
const openCard = document.querySelector('#open');
const openChoose = document.querySelector('#open-choose');
const caseCard = document.querySelector('#case');
const caseName = document.querySelector('#case-name');
const autopilot = document.querySelector('#autopilot');
const autopilotState = document.querySelector('#autopilot-state');
const chat = document.querySelector('#chat');
const another = document.querySelector('#another');
const sign = document.querySelector('#sign');
const signTitle = document.querySelector('#sign-title');
const signDetail = document.querySelector('#sign-detail');
const signShow = document.querySelector('#sign-show');
const signConfirm = document.querySelector('#sign-confirm');
const report = document.querySelector('#report');
const result = document.querySelector('#result');
const openFolder = document.querySelector('#open-folder');
const accessCard = document.querySelector('#access');
const accessCode = document.querySelector('#access-code');
const accessSubmit = document.querySelector('#access-submit');
const accessError = document.querySelector('#access-error');

// Отправляется командой open_chat вместо падения с нечитаемой ошибкой агента,
// когда модель не настроена ни кодом доступа, ни вручную в ~/.qwen/.env -
// не текст экрана, признак для показа showAccessCode(). Должна совпадать с
// ACCESS_CODE_REQUIRED в src-tauri/src/main.rs.
const ACCESS_CODE_REQUIRED = 'access-code-required';

// Один шаг экрана - один шаг дела. kind: 'сам' - шаг, который оболочка
// проходит без переписки; 'переписка' - шаг, который Довод делает в переписке.
const STEPS = [
  {
    id: 'prepare',
    title: 'Подготовить материалы',
    kind: 'сам',
    minutes: 'примерно 10 минут',
  },
  {
    id: 'inventory',
    title: 'Опись',
    kind: 'переписка',
    minutes: 'примерно 2 минуты',
  },
  {
    id: 'position',
    title: 'Позиция',
    kind: 'переписка',
    minutes: 'примерно 3 минуты',
  },
  {
    id: 'draft',
    title: 'Проект документа',
    kind: 'переписка',
    minutes: 'примерно 5 минут',
  },
  {
    id: 'reconcile',
    title: 'Сверка',
    kind: 'переписка',
    minutes: 'примерно 3 минуты',
  },
  {
    id: 'restore',
    title: 'Собрать результат',
    kind: 'сам',
    minutes: 'примерно минута',
  },
];

// Остановки, на которых Довод ждёт подписи юриста и дальше сам не идёт.
const SIGNATURES = {
  inventory: {
    heading: 'Проверьте, что уходит из дела',
    detail:
      'Материалы готовы. Посмотрите, какие файлы Довод будет читать и как заменены имена и роли. После вашего подтверждения он пойдёт дальше сам.',
    show: 'Показать, что уходит из дела',
  },
  restore: {
    heading: 'Подпишите итоговый проект',
    detail:
      'Проект документа готов. Прочитайте его. Если он вас устраивает, подтвердите: Довод вернёт настоящие имена и соберёт документы в папку дела.',
    show: '',
  },
};

const stepState = {};
const signed = {};
let currentCase = '';
let snapshotOverrideStatus;
let autopilotRunning = false;

function stepElement(id) {
  return document.querySelector(`#step-${id}`);
}

function stateElement(id) {
  return document.querySelector(`#state-${id}`);
}

function setCase(name) {
  currentCase = name || '';
  workspace.hidden = !currentCase;
  workspace.textContent = currentCase ? `Дело: ${currentCase}` : '';
  caseName.textContent = currentCase ? `Дело: ${currentCase}` : 'Дело';
}

// Состояние шага словами, как его читает юрист.
function setStepState(step, state, note = '') {
  stepState[step.id] = state;
  const words =
    state === 'идёт'
      ? `идёт, ${step.minutes}`
      : state === 'переписка'
        ? `идёт в переписке, ${step.minutes}`
        : state === 'готово'
          ? 'готово'
          : state === 'подпись'
            ? 'нужна ваша подпись'
            : state === 'ошибка'
              ? note || 'не получилось, можно повторить'
              : `ещё не начато, ${step.minutes}`;
  stateElement(step.id).textContent = words;
}

function resetSteps() {
  for (const step of STEPS) setStepState(step, 'нет');
}

function showScreen(screen) {
  document.body.dataset.screen = screen;
  status.hidden = screen !== 'status';
  welcome.hidden = screen !== 'welcome';
  openCard.hidden = screen !== 'open';
  caseCard.hidden = screen !== 'case';
  accessCard.hidden = screen !== 'access';
}

// Экран «Введите код доступа»: открывается вместо падения переписки, когда
// модель не настроена. message - уже готовая русская фраза для #access-error
// (например, после неудачной проверки кода), а не техническая ошибка.
function showAccessCode(message = '') {
  accessCode.value = '';
  accessSubmit.disabled = false;
  accessError.textContent = message;
  accessError.style.display = message ? 'block' : 'none';
  showIdleScreen('access');
}

// Спокойный экран без ожидания и без ошибки.
function showIdleScreen(screen) {
  document.body.dataset.state = 'idle';
  pulse.className = 'pulse idle';
  error.style.display = 'none';
  error.textContent = '';
  retry.hidden = true;
  showScreen(screen);
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
  showScreen('status');
  workspace.hidden = !(kind !== 'starting' && currentCase);
}

// Ошибка человеческим языком: что случилось и что нажать дальше. Подробности
// остаются в сведениях для поддержки, а не на экране.
function setFailure(heading, message) {
  setStatus('error', heading, message);
}

function showCase(name) {
  if (name) setCase(name);
  choose.hidden = false;
  choose.disabled = false;
  workspace.hidden = !currentCase;
  showIdleScreen('case');
}

function setAutopilotNote(message) {
  autopilotState.textContent = message;
}

function showReport(text) {
  report.hidden = !text;
  report.textContent = text || '';
}

function showSignature(step) {
  const gate = SIGNATURES[step.id];
  if (!gate) return;
  sign.hidden = false;
  signTitle.textContent = gate.heading;
  signDetail.textContent = gate.detail;
  signShow.hidden = !gate.show;
  if (gate.show) signShow.textContent = gate.show;
  setStepState(step, 'подпись');
  setAutopilotNote(
    'Довод остановился и ждёт вас. Ничего не потеряно: после подтверждения он продолжит с этого же места.',
  );
}

function hideSignature() {
  sign.hidden = true;
}

// Шаг, с которого продолжает автопилот: первый не пройденный.
function nextStep() {
  return STEPS.find((step) => stepState[step.id] !== 'готово');
}

async function runStep(step) {
  if (!invoke) return false;
  setStepState(step, 'идёт');
  stepElement(step.id).disabled = true;
  try {
    const text = await invoke('run_case_step', { step: step.id });
    setStepState(step, 'готово');
    if (step.id === 'restore') {
      result.hidden = false;
      showReport('');
    } else if (step.id === 'prepare') {
      showReport('');
    } else showReport(String(text || ''));
    return true;
  } catch (failure) {
    setStepState(step, 'ошибка');
    setAutopilotNote(
      'Этот шаг не прошёл. Ничего не испорчено: нажмите шаг ещё раз или откройте другое дело.',
    );
    showReport(String(failure || ''));
    return false;
  } finally {
    stepElement(step.id).disabled = false;
  }
}

// Шаг, который Довод делает в переписке: оболочка открывает переписку и там
// он идёт теми же командами Довода.
async function runInChat(step) {
  if (!invoke) return;
  setStepState(step, 'переписка');
  setAutopilotNote('Довод продолжает в переписке. Она сейчас откроется.');
  try {
    await invoke('open_chat');
  } catch (failure) {
    if (String(failure) === ACCESS_CODE_REQUIRED) {
      setStepState(step, 'нет');
      showAccessCode();
      return;
    }
    setFailure(
      'Не удалось открыть переписку',
      'Нажмите «Повторить». Дело и материалы на месте.',
    );
  }
}

async function runAutopilot() {
  if (autopilotRunning) return;
  autopilotRunning = true;
  autopilot.disabled = true;
  try {
    for (;;) {
      const step = nextStep();
      if (!step) {
        setAutopilotNote('Дело пройдено. Документы готовы.');
        result.hidden = false;
        return;
      }
      if (SIGNATURES[step.id] && !signed[step.id]) {
        showSignature(step);
        return;
      }
      hideSignature();
      if (step.kind === 'переписка') {
        await runInChat(step);
        return;
      }
      setAutopilotNote(`Довод работает: ${step.title.toLowerCase()}.`);
      const done = await runStep(step);
      if (!done) return;
    }
  } finally {
    autopilotRunning = false;
    autopilot.disabled = false;
  }
}

async function chooseCase() {
  if (!invoke) return;
  snapshotOverrideStatus = 'starting';
  setStatus('starting', 'Открываем дело', 'Это занимает несколько секунд.');
  try {
    const name = await invoke('choose_workspace');
    if (name) {
      resetSteps();
      showCase(String(name));
    } else if (currentCase) showCase();
    else showIdleScreen('welcome');
  } catch {
    setFailure(
      'Не удалось открыть эту папку',
      'Выберите папку дела на этом компьютере и попробуйте снова.',
    );
  }
}

async function openDemoCase() {
  if (!invoke) return;
  snapshotOverrideStatus = 'starting';
  setStatus(
    'starting',
    'Готовим учебное дело',
    'Это занимает несколько секунд.',
  );
  try {
    const name = await invoke('open_demo_case');
    resetSteps();
    showCase(String(name || 'учебное дело'));
    setAutopilotNote(
      'Это учебное дело. Нажимайте что угодно: настоящие дела оно не затрагивает.',
    );
  } catch {
    setFailure(
      'Учебное дело не открылось',
      'Можно открыть своё дело кнопкой «Открыть другое дело».',
    );
  }
}

async function openCaseFolder() {
  if (!invoke) return;
  try {
    await invoke('open_case_folder');
  } catch {
    setAutopilotNote(
      'Папку не удалось открыть. Документы лежат в папке дела, её можно открыть обычным способом.',
    );
  }
}

async function openChat() {
  if (!invoke) return;
  try {
    await invoke('open_chat');
  } catch (failure) {
    if (String(failure) === ACCESS_CODE_REQUIRED) {
      showAccessCode();
      return;
    }
    setFailure(
      'Не удалось открыть переписку',
      'Нажмите «Повторить». Дело и материалы на месте.',
    );
  }
}

async function submitAccessCode() {
  if (!invoke) return;
  const code = accessCode.value.trim();
  if (!code) {
    accessError.textContent = 'Введите код доступа.';
    accessError.style.display = 'block';
    return;
  }
  accessSubmit.disabled = true;
  accessError.style.display = 'none';
  accessError.textContent = '';
  try {
    await invoke('submit_access_code', { code });
    snapshotOverrideStatus = 'starting';
    setStatus('starting', 'Проверяем код', 'Это занимает несколько секунд.');
  } catch (failure) {
    accessError.textContent = String(failure || 'Код не принят.');
    accessError.style.display = 'block';
    accessSubmit.disabled = false;
  }
}

async function showWhatLeaves() {
  if (!invoke) return;
  signShow.disabled = true;
  try {
    const text = await invoke('run_case_step', { step: 'eyecheck' });
    showReport(String(text || ''));
  } catch (failure) {
    showReport(String(failure || ''));
  } finally {
    signShow.disabled = false;
  }
}

function confirmSignature() {
  const step = nextStep();
  if (!step) return;
  signed[step.id] = true;
  hideSignature();
  setStepState(step, 'нет');
  runAutopilot();
}

async function retryRuntime() {
  if (!invoke) return;
  snapshotOverrideStatus = 'starting';
  setStatus('starting', 'Пробуем снова', 'Это занимает несколько секунд.');
  try {
    await invoke('restart_runtime');
  } catch {
    setFailure(
      'Довод не запустился',
      'Откройте другое дело или перезапустите Довод.',
    );
  }
}

async function installUpdate() {
  if (!invoke) return;
  update.disabled = true;
  update.textContent = 'Устанавливаем обновление…';
  try {
    await invoke('install_update');
  } catch {
    setFailure(
      'Обновление не установилось',
      'Довод продолжает работать. Можно попробовать позже.',
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
  } catch {
    setFailure(
      'Сведения для поддержки не открылись',
      'Попробуйте ещё раз или перезапустите Довод.',
    );
  }
}

choose.addEventListener('click', chooseCase);
retry.addEventListener('click', retryRuntime);
logs.addEventListener('click', openLogs);
update.addEventListener('click', installUpdate);
welcomeOpen.addEventListener('click', chooseCase);
welcomeDemo.addEventListener('click', openDemoCase);
openChoose.addEventListener('click', chooseCase);
another.addEventListener('click', chooseCase);
autopilot.addEventListener('click', runAutopilot);
chat.addEventListener('click', openChat);
openFolder.addEventListener('click', openCaseFolder);
signShow.addEventListener('click', showWhatLeaves);
signConfirm.addEventListener('click', confirmSignature);
accessSubmit.addEventListener('click', submitAccessCode);
accessCode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitAccessCode();
});
for (const step of STEPS) {
  stepElement(step.id).addEventListener('click', () => {
    hideSignature();
    if (step.kind === 'переписка') runInChat(step);
    else runStep(step);
  });
}

async function initialize() {
  if (!invoke || !listen) {
    setFailure(
      'Довод не открылся до конца',
      'Закройте окно и запустите Довод снова.',
    );
    return;
  }

  resetSteps();

  await Promise.all([
    listen('runtime-starting', ({ payload }) => {
      snapshotOverrideStatus = 'starting';
      setCase(caseNameFromPath(String(payload || '')));
      setStatus('starting', 'Открываем дело', 'Это занимает несколько секунд.');
    }),
    listen('runtime-ready', ({ payload }) => {
      snapshotOverrideStatus = 'ready';
      showCase(caseNameFromPath(String(payload || '')));
    }),
    listen('runtime-failed', () => {
      snapshotOverrideStatus = 'failed';
      setFailure(
        'Довод не запустился',
        'Нажмите «Повторить» или откройте другое дело. Материалы дела не изменились.',
      );
    }),
    listen('update-available', () => {
      update.hidden = false;
      update.textContent = 'Установить обновление';
    }),
  ]);

  const state = await invoke('bootstrap_state');
  version.textContent = `Довод ${state.desktopVersion}`;
  if (!currentCase) setCase(state.caseName || '');
  welcomeDemo.hidden = state.demoAvailable === false;
  if (snapshotOverrideStatus) return;
  if (state.firstRun) {
    choose.hidden = true;
    showIdleScreen('welcome');
    return;
  }
  if (state.status === 'starting') {
    setStatus('starting', 'Открываем дело', 'Это занимает несколько секунд.');
  } else if (state.status === 'ready') {
    showCase(state.caseName || '');
  } else if (state.error) {
    setFailure(
      'Довод не запустился',
      'Нажмите «Повторить» или откройте другое дело. Материалы дела не изменились.',
    );
  } else {
    showIdleScreen('open');
  }
}

// Имя дела из пути рабочей папки: на экранах путей нет, только имя дела.
function caseNameFromPath(path) {
  const parts = String(path || '')
    .split(/[\\/]/)
    .filter(Boolean);
  const last = parts.pop();
  if (!last) return '';
  if (last === 'для_модели') return parts.pop() || '';
  return last;
}

initialize().catch(() => {
  setFailure(
    'Довод не открылся до конца',
    'Закройте окно и запустите Довод снова.',
  );
});
