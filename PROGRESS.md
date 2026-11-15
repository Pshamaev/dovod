# PROGRESS.md: журнал сессий в репозитории Довода

Формат строки: дата; что сделано; чем проверено; что дальше. Новые записи сверху.

- 2026-11-15; DESKTOP_017_A_FIX: сборка установщика из dovod-017 (коммит
  b75d66a013, прогон 43687099120) упала на шаге tauri build, на компиляции
  Rust, одной ошибкой error[E0597] в packages/desktop-shell/src-tauri/src/
  main.rs, функция run_case_step: последним выражением блока шёл вызов
  bootstrap_workspace с lock(&state.last_workspace).clone() внутри, а
  временные значения последнего выражения блока уничтожаются позже локальных
  переменных блока - заимствованный state уже уничтожен, MutexGuard на его
  поле ещё жив. Исправлено (коммит e69811bbfc): last_workspace и
  persisted_workspace вынесены в локальные переменные, в последнем выражении
  блока остался вызов с владеющими значениями; блок сохранён, чтобы state не
  жил через await в spawn_blocking. Проверено: cargo и rustc в этой оболочке
  нет, компиляцию локально проверить нельзя, поэтому все 32 вызова lock(...)
  и все 15 обращений .state::<ApplicationState>() в main.rs, runtime.rs и
  desktop_state.rs просмотрены построчно - второго такого места нет (в
  open_case_folder и bootstrap_state тот же вызов безопасен: там state
  параметр функции, а не локальная переменная блока); rustc сообщил "due to
  1 previous error", borrow check проходит по всем телам функций крейта и
  выдаёт все ошибки сразу, значит других E0597 в крейте не было, а остальной
  код прошёл проверку типов. Перечень проверенных мест с номерами строк:
  docs/reports/2026-11-15_desktop_017_A.md, раздел про E0597. Push: origin
  HEAD:refs/heads/dovod-017 (push 3 из 3), main не трогался. Дальше: ещё один
  прогон Desktop Release из dovod-017 - компиляция Rust не проверена ничем,
  кроме чтения кода.
- 2026-11-15; DESKTOP_017_A: первый шаг дружелюбного интерфейса 0.1.7 ("как
  Тесла с автопилотом", решения владельца 13-14.11). Шаги 1-6 (коммит
  5ac4c3f20f): приветствие с демо-делом (копия _demo/ДТП_демо из пакета
  конвейера в Документы), экран "Открыть дело" с фразой о приватности,
  экран "Ход дела" с шестью шагами кнопками и состоянием словами
  (ещё не начато / идёт / готово / нужна подпись), автопилот "Пройти дело"
  с остановками на подпись (после Описи - показать, что уходит из дела;
  после Собрать результат - подписать итоговый проект), ошибки человеческим
  языком без терминов и путей, экран результата с кнопкой "Открыть папку с
  документами". choose_workspace сужает выбор до <дело>\для_модели - агенту
  не открывается корень дела. Новые команды Tauri: open_demo_case,
  open_case_folder, open_chat (переписка открывается только по просьбе
  юриста), run_case_step (вызывает dovod_prompts.exe теми же подкомандами,
  что dovod/commands/*.toml - логика конвейера не дублируется). Новый тест
  testCaseScreensSpeakHumanRussian в test-release.js по пункту 5 задания -
  ищет слова модель/токен/OCR/терминал/консоль/лог/workspace и
  пути/команды в строковых литералах интерфейса. По ходу найдены и
  исправлены два бага: showCase() не восстанавливала workspace.hidden после
  skрытия на старте (дело оставалось спрятанным после отмены выбора папки);
  тест на запрещённые слова ложно падал на именах JS-переменных
  (workspace.textContent), сужен до содержимого строковых литералов.
  Шаг 7 (коммит da3be6812f): из 21 найденного упоминания Qwen в
  packages/cli/src/config/settingsSchema.ts переписано 16 (текст
  label/description, видимый на экране настроек без ru-перевода); 5
  оставлено намеренно - переименование требует переименования настоящих
  функциональных идентификаторов в других местах (тема Qwen Dark в
  ui/themes/qwen-dark.ts, файл-конвенция .qwenignore - ru-перевод уже
  закрыт сессией D, HTTP-заголовок X-Qwen-Client-Id демона, маркеры
  qwen-review в /review-скилле). Та же правка вручную продублирована в
  закоммитированном сгенерированном packages/vscode-ide-companion/schemas/
  settings.schema.json (перегенерировать нельзя - нет npm/tsx). Новый
  packages/desktop-shell/THIRD_PARTY_NOTICES.md: прямые Rust-зависимости
  оболочки (Tauri и плагины - MIT OR Apache-2.0; остальные крейты по
  памяти, не перепроверено cargo-license - нет cargo в этой оболочке),
  явный пропуск полного транзитивного дерева (5540 строк Cargo.lock) с
  инструкцией на будущее, ссылка на THIRD_PARTY_NOTICES.md пакета
  dovod-tools (другой репозиторий) с напоминанием об открытом вопросе
  PyMuPDF/AGPL из отчёта 016_D. Подробности, построчный список правок и
  оценка остатка версии 0.1.7 (9-18 часов видимых в этом репозитории
  доработок, плюс 12-24 часа на два серверных пункта из итогового задания -
  ключ модели с лимитами и проверка ссылок через сервер, которые только
  оценены, не делались): docs/reports/2026-11-15_desktop_017_A.md.
  Проверено: node packages/desktop-shell/scripts/test-release.js - все
  проверки до testRuntimePreparation включительно прошли (включая новые/
  переписанные testCaseScreensSpeakHumanRussian и
  testBootstrapWorkspaceVisibility), упал на tar -czf - тот же
  документированный предел BSD tar этой машины, что в сессиях D2-D4, не
  связан с правками; доп. прогон _archive/run-tail-tests.mjs -
  testDovodSeeding OK, testDovodToolsInstallation упал на том же пределе
  tar при распаковке - тоже документировано; node
  _bridge_reports/syntax-check.js подтвердил целостность settingsSchema.ts
  и settings.schema.json после ручных правок. Cargo/rustc недоступны в этой
  оболочке - Rust-правки (main.rs, runtime.rs) проверены только построчным
  чтением, не компиляцией; живой визуальный прогон собранного установщика
  не делался (нет доступа к сборке). Push: origin HEAD:refs/heads/dovod-017
  (push 1 из 3 - коммит 5ac4c3f20f сразу после обрыва прошлой сессии; push
  2 из 3 - оба коммита этой сессии, см. ниже после записи в отчёт); main не
  трогался. Дальше: сборку установщика делает архитектор отдельно (push в
  dovod-desktop-build), затем приёмка по чеклисту CLAUDE.md §8 на чистой
  Windows 11; владельцу - решение по 5 оставшимся Qwen-упоминаниям (особенно
  нужна ли отдельная тема Довода вместо Qwen Dark) и по экрану "Открыть
  дело", который почти не достижим текущей логикой main.rs.
- 2026-11-13; DESKTOP_016_D4: исправлен testDovodSeeding в
  packages/desktop-shell/scripts/test-release.js, упавший после DESKTOP_016_D3
  на прогоне 43467239547 (testRuntimePreparation теперь проходит, упала
  testDovodSeeding, строка 1700: AssertionError mcpServers {} !== undefined).
  Суть требования безопасности - отсутствие mcpServers.dovod и любой записи с
  command PLACEHOLDER, а не форма самого mcpServers; settings.template.json
  сеет mcpServers: {}, и это не нарушение. Проверка переписана так, чтобы
  принимать и undefined, и {}, но требовать явного отсутствия dovod и записей
  с PLACEHOLDER. Добавлен разовый скрипт packages/desktop-shell/_archive/
  run-tail-tests.mjs: обходит BSD tar этой машины (флаг локального архива
  только в своей временной копии test-release.js, без правки боевых
  test-release.js и prepare-runtime.js) и запускает testDovodToolsInstallation
  и testDovodSeeding. Подробности и результат прогона: docs/reports/
  2026-11-13_desktop_016_D.md (раздел DESKTOP_016_D4). Проверено: прогон
  run-tail-tests.mjs (лог logs/2026-11-13_desktop_016_D4_tail.log, не
  коммитится) - testDovodSeeding прошёл полностью; testDovodToolsInstallation
  упал на нетронутом вызове tar при распаковке внутри prepare-runtime.js, то
  же ограничение BSD tar, что в D2/D3, не связано с этой правкой; контрольный
  node packages/desktop-shell/scripts/test-release.js целиком падает в том же
  месте, что раньше (testRuntimePreparation, tar -czf) - правка ничего не
  сломала в проверках до неё. Коммит: 0bd9ce1b4a. Push: origin
  HEAD:refs/heads/dovod-016, main не трогался; дальше: владелец читает итог
  прогона 016 в CI.
- 2026-11-13; DESKTOP_016_D3: исправлен testRuntimePreparation в
  packages/desktop-shell/scripts/test-release.js, упавший после DESKTOP_016_D на
  прогоне 43429052832 (ENOENT .../runtime/packages/desktop-shell/dovod-tools.json).
  prepare-runtime.js безусловно читает dovod-tools.json при запуске, а testRuntimePreparation
  копировал во временную копию package.json, NOTICE, dovod/, но не сам
  dovod-tools.json; добавлена одна строка fs.copyFileSync тем же способом, каким
  этот файл уже копируется в соседней testDovodToolsInstallation. Остальные файлы
  DESKTOP_016_D (eyecheck.toml, settings.template.json, env.template,
  mcp-server.template.json) лежат внутри dovod/, который уже копируется целиком -
  правок не требуют. Подробности: docs/reports/2026-11-13_desktop_016_D.md (раздел
  DESKTOP_016_D3). Проверено: node packages/desktop-shell/scripts/test-release.js
  напрямую - прогон дошёл дальше прежней точки падения D2 и упал на том же месте
  (tar -czf, BSD tar принимает "C:" за имя хоста - окружение этой машины, не
  связано с правкой); сам факт устранения ENOENT в spawnSync дальше по функции не
  проверен локально (недостижим из-за tar), только по коду. Push: origin
  HEAD:refs/heads/dovod-016, main не трогался; дальше: владелец читает итог
  прогона 016 в CI (там tar другой, GNU) и решает, нужен ли отдельный фикс
  tar-шага test-release.js под BSD tar (вне рамок этого задания).
- 2026-11-13; DESKTOP_016_D2: исправлен test:release, упавший после DESKTOP_016_D.
  В packages/desktop-shell/scripts/test-release.js (testDesktopReleaseHardening,
  строка 480) регулярка ждала в ключе кэша Node буквально inputs.dry_run, а job
  build в desktop-release.yml с коммита 6f57a21113 читает env.DRY_RUN; строка
  переписана на env.DRY_RUN, проверка не ослаблена. Поиск по inputs\. и dry_run по
  всему файлу других таких мест не нашёл. Коммит в main-dovod: см. docs/reports/
  2026-11-13_desktop_016_D.md (раздел DESKTOP_016_D2). Проверено: node
  packages/desktop-shell/scripts/test-release.js напрямую - проверки до
  testDesktopReleaseHardening включительно прошли; скрипт упал позже в
  testRuntimePreparation на tar -czf (BSD tar на этой машине принимает "C:" в
  пути за имя хоста) - окружение, не связано с правкой. Push: origin
  HEAD:refs/heads/dovod-016, main не трогался; дальше: владелец читает прогон
  dovod-016 и решает, нужен ли отдельный фикс testRuntimePreparation под Windows
  BSD tar (вне рамок этого задания).
- 2026-11-13; DESKTOP_016_D: встраивание пакета конвейера в установщик 0.1.6 (без
  интерфейса, он в 0.1.7). Коммиты в main-dovod: 57fe89994f (докоммичен отчёт A),
  2cee9a00b8 (prepare-runtime.js скачивает dovod-tools по токену DOVOD_TOOLS_TOKEN,
  sha256, кладёт в runtime/qwen-code/dovod-tools), 6ad8175b31 (команды /dovod:* зовут
  dovod_prompts.exe вместо python, mcp-server.template.json явный PLACEHOLDER),
  72bad31f42 (tools.disabled: 24 файловых инструмента и терминал агента отключены,
  команды /dovod:* не задеты - они идут через !{...} в обход реестра инструментов),
  9641ad753d (i18n.tsx: русские строки без Qwen на экране настроек, ru-перевод
  fileFiltering.*, которого не было вовсе), 6f57a21113 (desktop-release.yml: push в
  dovod-016 собирает dry_run+windows_only, DOVOD_TOOLS_TOKEN в сборку, итог прогона
  коммитится в docs/reports/desktop_016/<run_id>.md). Push в отдельную ветку dovod-016
  (не main) - см. docs/reports/2026-11-13_desktop_016_D.md; проверено только чтением
  кода и построчным просмотром диффов (npm недоступен исполнителю, фактический CI-прогон
  не запускался в этой сессии); не сделано по прямому ограничению задания:
  THIRD_PARTY_NOTICES не создан, ~45 из 48 упоминаний Qwen в settingsSchema.ts не
  переведены, сужение choose_workspace до для_модели не трогалось (не входило в это
  задание); дальше: владелец читает итог прогона в ветке dovod-016 и решает, что в main.
- 2026-11-13; DESKTOP_016_A: разведка упаковки 0.1.6, отчёт docs/reports/2026-11-13_desktop_016_A.md (архитектура: PyInstaller onedir в garant-bot, в установщик через bundle.resources внутрь runtime/qwen-code/dovod-tools, конвейер в CI из приватного релиза garant-bot по токену, рабочие данные в AppData; ключ выключения инструментов tools.disabled, а не permissions.deny, иначе ломаются команды /dovod:*; список остатков бренда Qwen; оценка 32-61 час); в .gitignore добавлена _spike/; проверено чтением кода оболочки (tauri.conf.json, prepare-runtime.js, runtime.rs, dovod-entry.js, settingsSchema.ts, shellProcessor.ts, i18n.tsx), прогонов не было; не сделано: пробная сборка PyInstaller и прогон на ДТП_демо (папка garant-bot не открыта исполнителю на чтение, в оболочке нет pip и pyinstaller), версия Tesseract и состав моделей RapidOCR не определены, коммита нет (git падает на dubious ownership под NT AUTHORITY\SYSTEM); дальше: открыть garant-bot на чтение и повторить пункты 2-4, владельцу выполнить git config --global --add safe.directory C:/Users/User/dovod и закоммитить отчёт.
- 2026-09-16; заведён CLAUDE.md с правилами Довода (иерархия истины, наш контур против наследия, запреты, прогоны в файл, один шаг один коммит, чеклист релиза) и этот журнал; проверено чтением; дальше: релиз 0.1.6 после живых дел, страница dovod.law/maska.
