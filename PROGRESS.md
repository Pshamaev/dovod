# PROGRESS.md: журнал сессий в репозитории Довода

Формат строки: дата; что сделано; чем проверено; что дальше. Новые записи сверху.

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
