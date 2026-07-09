# CLAUDE.md — sort-proto

«Сортуй!» — technical puzzle prototype: мобільна sorting-головоломка на
**Phaser 3 + TypeScript + Vite** (обгортка Capacitor). Мова спілкування з
розробником — українська. Коментарі в коді та commit messages — англійською.

## Обов'язково прочитати перед роботою

- `ARCHITECTURE.md` — шари, контракт модуля механіки, lifecycle рівня.
  Напрямок залежностей порушувати не можна: механіка спілкується назовні
  **тільки через EventBus**, ніколи не імпортує platform/browser API.
- `docs/STYLE_GUIDE.md` — візуальний style-гайд (стрижень «зошит у
  клітинку», палітра, sketch-рендер, матеріальні метафори механік,
  UI-кит, рецепт «додати візуал нової механіки в стилі»). Читати перед
  будь-якою візуальною/UX-роботою. Пов'язані: `docs/asset-spec.md`,
  `docs/mockup-spec.md`.
- `graphify-out/GRAPH_REPORT.md` (якщо існує) — карта кодової бази перед
  архітектурними питаннями. Після змін коду: `graphify update .` (без API-витрат).

## Команди

```bash
npm run dev              # dev-сервер (Vite)
npm test                 # vitest (наразі 106 тестів — усі мають бути зелені)
npm run lint             # eslint src tools
npm run build            # tsc --noEmit && vite build
npx vite build --config vite.standalone.config.ts && node tools/make-standalone.mjs
                         # standalone-білд одним HTML-файлом (для швидкого шарингу)
npm run levels:generate  # регенерація рівнів
npx tsx tools/analyze-levels.ts   # звіт розподілу механік по декадах
```

## Quality gates (перед кожним пушем)

1. `npx tsc --noEmit` — чисто
2. `npm test` — усі тести зелені
3. `npm run lint` — чисто
4. `npm run build` — успішний
5. Після змін у генераторі рівнів — прогнати аналізатор і перевірити
   розподіл механік по декадах

## Стан проекту (липень 2026)

**Зроблено (останнє — Puzzle Hub prep: реєстр механік + governance, липень 2026):**
- **Puzzle Hub — багатомеханічний скелет.** Проект стає колекцією механік на
  спільній базі; master-lobby ВІДКЛАДЕНО (робимо потім), але механіки вже
  самореєструються. `core/mechanics/MechanicModule.ts` (контракт) →
  `mechanics/sorting/sortingModule.ts` (дескриптор) → `app/mechanics.ts`
  (реєстр `MECHANICS`) → `bootstrap.ts` будує масив сцен із реєстру
  (поведінково-нейтрально). i18n-неймспейс `mechanics.<id>.name`. Governance:
  `.github/CODEOWNERS` (спільний шар — ревʼю стюарда; папки механік — власнику),
  `docs/MECHANIC_SDK.md` (контракт автора нової механіки: папка, події, UI-кіт,
  префікс ассетів, i18n/progress namespace, additive-only). ARCHITECTURE.md
  оновлено (реєстр, межа shared/mechanic, бакети ассетів, governance).
- **Split ассетів (інкремент 2).** `public/assets/images/` розкладено:
  `assets/shared/` (55 текстур дизайн-системи + manifest.json) і
  `assets/mechanics/sorting/` (31 текстура механіки + manifest.json).
  Ключі НЕ перейменовано (grandfathered — сортинг заморожений; нові механіки
  префіксують `<id>/`). `AssetLoader.loadExternalAssets(scene, urls)` зливає
  манифести; Preloader вантажить shared + усі `assetManifestUrl` з реєстру.
  Standalone-білд зливає обидва манифести. Тулзи оновлено
  (sample-block-tints, bake_tintable_frame, cut_generated_blocks →
  sorting-бакет; tex_pencil → tools/art/; generate_sketch_assets — legacy,
  вихід у tools/art/_generated). Верифіковано: гейти зелені + dev-сервер —
  обидва манифести і всі 86 image-URL віддають 200.
**Зроблено (печатки Phase 2, локалізація, ребрендинг, липень 2026):**
- **Печатки (Phase 2) — до 2 запечатаних колонок на рівень.** Модель:
  `sealsByCol: Map<col, chains[]>` (`sealedColumns`, `isSealed`, `chainsLeft`),
  зняття печатки в `move()` сканує колонки за зростанням індексу. Наскрізь:
  Types (`sealedColumns?: {chains;blocks}[]`, `chainRemoved.column`) → Parser
  (`parseSealed`, `checkVaultBlocks`, 1..2 колонки) → Solver (`chainCols`,
  `chainSeals`, кредит найнижчій колонці) → ViewContract (`animateFlapOpen`) →
  View (per-column ghost/rattle/break) → StubView → Controller. Генератор
  ставить 2 печатки лише в master/peak; 150 рівнів перебейкано (4 мають 2).
- **Фікс зависання** при завершенні кольору: твін розкрутки стрічки писав
  `.height` у nine-slice, який знищувався ребілдом → крах game loop. Тепер
  твін іде через proxy-обʼєкт + guard `if (ribbon.active)` (див.
  `animateChainBreak` у `SortingView.ts`).
- **Скотч → паперовий клапан.** Механіку «скотчу» замінено на клапан:
  анімація відкриття `animateFlapOpen(col)` (asset `tape_flap_open` =
  «клапан 2», під колонкою через `sendToBack`, geometry-mask вище краю
  колонки). Мертвий `deco_tape` («правильно») прибрано з ігрового поля
  (лишився лише як декор note-стікера в `Popup.ts`).
- **Локалізація (UK/EN).** Типізований словник без залежностей у
  `src/config/uiTexts.ts`: `const uk`, `type Messages = typeof uk`,
  `const en: Messages`, live-binding `export let UI_TEXTS`, `getLocale/setLocale`
  (persist через storage util, `STORAGE_KEYS.locale`). Вибір мови —
  випадаюче меню в налаштуваннях лоббі. Весь ігровий текст двомовний; нові
  рядки додавати В ОБИДВА словники (типи це форсять).
- **Ребрендинг:** гра → «Scribble Sort: Color Puzzle» / укр. «Scribble Sort:
  Сортування кольорів». Заголовок лоббі — однокомпонентний (лише перша
  частина назви).
- **Нова панель вікон:** `ui_panel` (asset 05_30_52, nine-slice inset 40) —
  спільна база для попапів/налаштувань (`Popup.ts`). URL панелі та клапана
  cache-busted через `?v=2` у manifest (HMR/F5 НЕ перезавантажує текстури
  Phaser — потрібен hard-reload).
- **Туторіали** переписано: тексти актуалізовано (hidden без стрілки-руху,
  target перефразовано, taped → «паперовий клапан», keyblock без згадки
  бустера), ілюстрації будуються з ігрових ассетів (міні-колонки форсять
  `setDisplaySize`, бо `col_frame` — високий nine-slice).
- **Арт блоків** повністю замінено на новий набір (8 текстур, однаковий
  розмір); коричневий → сірий; `BLOCK_TINTS` пересемпльовано
  (`sample-block-tints.mjs` має fallback для сірого — середнє по mid-tone).
  Дудли-написи збільшено (`doodles.ts`).
- **Крива «C» (плетена + плавна)** — генератор переписано: замість макро-мапи
  «одна механіка на діапазон» тепер ДВА незалежні розклади в
  `SortingLevelGenerator.ts`:
  - `stageFor(level)` — локальна хвиля (build/use/plan/master/relief/peak) під
    **стелею тиску за прогресом**, тож ранні хвилі мʼякі, піки відкриваються
    поступово (без ранніх стрибків);
  - `MECH_INTRO` — кожна механіка дебютує **рано** (blot L8, target L14,
    tape L20, key L26, chainN L32, multilock L38, chainC L44) на нульовій
    вазі; комбінації входять із ~L56 через `CROSS_PAIRS`.
  Базова складність дошки росте з РІВНЕМ, не зі зміною механіки → зникла
  «пилка». Ефект: рівнів без механік 41→20, перша механіка L26→L8, усі до L44.
  **Це v1 — чекає плейтесту для v2-тюнінгу.**
- Trap-density відбір збережено (`selectHardest`, `trapTargetFor`): safeRatio
  спадає ~80%→60% до фіналу. Звіт «trap density per decade» — у бейкері.
- Necessity-гейт бейкера тепер **стадійно-свідомий** (`necessityFor` —
  спільне джерело): інтро/relief не гейтяться (нульова ціль за дизайном),
  тож старі «3 FAILURES» були хибні. Зараз показує ~21 реальний shortfall
  (master/peak із key/multilock/blot necessity 2<3) — **свідомо прийнято**
  (Варіант А: рівні грабельні, підняти до 3 впирається в інваріант «≥1
  порожня колонка»).
- Механіки: приховані блоки, чорнильна пляма, ключ-блок, замки (в т.ч.
  подвійний), скотч (паперовий клапан), target-колонка, set-unlock,
  ланцюги (нейтральний і кольоровий).
- **«Конструктивна необхідність»**: у замкнених/ланцюгових колонках лежать
  2–3 видимі, але недоторканні блоки — відкриття колонки потрібне за побудовою.
- Візуал/UX: клапан скотчу (asset `tapeFlap`, y=-10, ширина 0.9w−3px —
  підібрано вручну, не чіпати без запиту), скотч «Готово ✓» з анімацією
  «прилипання», завершена колонка інертна, підйом вибраної групи блоків на
  **12px**, затримка виграшного попапа.
- **Кольорова target-колонка** рендериться як вибрана: база `col_frame` +
  кольоровий контур-оверлей (не сам `col_frame_tint` — той давав блідий
  напівпрозорий піксельний фрейм). Стрілка/рамка беруть `BLOCK_TINTS`
  (насемпльований з арту колір блока).
- **Retina**: стеля DPR піднята 2.5→3 (`hidpi.ts`) — на iPhone Pro Max (DPR 3)
  прибрало «мило» від апскейлу Safari.
- **Тач-інпут**: поріг тап→драг 8→16px (`gameSettings.input.dragThresholdPx`) —
  тап із зсувом пальця більше не зривається у свайп.
- **Хостинг**: GitHub Pages через `.github/workflows/deploy.yml` (пуш у main →
  авто-деплой на `yemelianenko-d.github.io/sort-proto/`); `noindex` у index.html.
- **Dev**: `?level=N` — старт одразу на рівні N; `?debug=true` — оверлей
  переходу між рівнями; cheat-тумблер у налаштуваннях відкриває всі рівні.
- Анімацію відкривання клапана при взятті блока **видалено свідомо**
  (коміт `0a8b02b`) — не повертати.

**Наступні кроки:**
- **Нова механіка** — інший агент, за `docs/MECHANIC_SDK.md` (папка
  `mechanics/<id>/`, рядок у `app/mechanics.ts`, свій бакет ассетів з
  префіксом `<id>/`, i18n `mechanics.<id>`).
- **Puzzle Hub потім (з master-lobby)**: `MasterLobbyScene` (плитка/механіка з
  `MECHANICS`), generic `LevelSelect(module)`, namespace ProgressManager per id,
  path-filtered CI + vitest-проєкти по механіках (важкі solver/generator тести
  лише на сортинг/спільних PR).
- **Плейтест кривої C → v2**: підкрутити за відчуттям. Відомі кандидати з
  метрик: мало 4-типних дощок у мід-геймі (варіація), уступ у кривій
  101–110(29)→111–120(39), темп введення механік.
- 21 master/peak necessity-shortfall — прийнято (Варіант А). Якщо колись
  тягнути до 3 — потрібен fill/key-depth тюнінг + повна ревалідація + плейтест
  (не безпечний one-shot: впирається в інваріант «≥1 порожня колонка»).
- Борг підтримуваності: `SortingView.ts` ~1343 рядки / 40 методів — кандидат
  на розбивку (рамки/декор/анімації в хелпери), коли зʼявиться потреба.

## Конвенції

- Модель (`SortingModel`) — чиста логіка без Phaser, покривається юніт-тестами.
- View працює тільки через `SortingViewContract`; для тестів контролера є `StubView`.
- Нова фіча в механіці = зміни в Types → Parser → Model (+ тести) → ViewContract
  → View → StubView → Controller. Не пропускати StubView і контракт.
- Рівні — декларативні (`public/levels`, `sorting_levels.json` генерується тулзами).
- Піксель-точні візуальні правки робити мінімальними кроками (2–3px) і
  показувати білд розробнику після кожної.
- Commit messages: короткі, описові, англійською (див. `git log`).

## Робочий процес із розробником

- Дизайн-рішення обговорюються в чатах Claude (проект «Puzzle Hub»);
  цей файл — місток контексту. Після значних рішень оновлювати CLAUDE.md.
- Розробник любить перевіряти зміни у standalone-білді — після
  UX/візуальних правок збирати його і давати посилання/файл.
