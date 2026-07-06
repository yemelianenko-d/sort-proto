# Сортуй! — technical puzzle prototype

Технічний прототип однієї puzzle-механіки (sorting) як основа для майбутнього puzzle hub.
Ціль — не геймплей, а перевірена технічна база: browser (desktop + mobile), responsive,
app-like fullscreen, модульна архітектура, готовність до Capacitor.

**Стек:** TypeScript · Phaser 3 · Vite · ESLint/Prettier · npm

## Запуск

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm run build      # typecheck + production build -> dist/
npm run preview    # локальний перегляд production build
npm run lint       # eslint
npm run test       # vitest: parser, model, controller, progress, event bus, layout
npm run format     # prettier
npm run levels:generate  # перегенерувати рівні (solver-verified)
```

Debug mode: додайте `?debug=true` до URL — з'явиться панель:
перемикання рівнів ◀/▶, restart, clear save, поточний FPS.
Аналітичні події логуються в console завжди.

## Архітектура

```
src/
  app/        bootstrap (composition root), gameConfig, debugOverlay
  config/     uiTexts (усі тексти), gameSettings (баланс/тюнінг без magic numbers)
  core/
    game/     GameController, GameState, LevelManager, ProgressManager
    events/   EventBus (типізований pub/sub)
    utils/    storage, device, layout (чиста математика розкладки)
  mechanics/
    sorting/  Scene · Controller · Model · View · LevelParser · Types
  platform/   PlatformService (інтерфейси) + Web/Mock реалізації
  ui/         Button, Popup, Preloader(scene), ResponsiveContainer, sketch
  scenes/     LobbyScene, ErrorScene
public/
  levels/sorting_levels.json   # зовнішній конфіг рівнів
  manifest.webmanifest, icons/ # PWA
tools/
  generate-levels.mjs          # генератор рівнів із DFS-солвером
```

Принципи:

- **Механіка = ізольований модуль.** `mechanics/sorting` не знає про
  аналітику, прогрес, платежі чи платформу — лише емітить події в `EventBus`
  (`level_started`, `move_made`, `undo_used`, ...). Нова механіка додається як
  `mechanics/<name>` з таким самим контрактом.
- **Model / View / Controller розділені.** `SortingModel` — чиста логіка без
  Phaser (легко тестувати), `SortingView` — тільки рендер, `SortingController`
  — input і оркестрація.
- **Platform layer.** Увесь platform-specific код за інтерфейсами
  `PlatformService` (analytics/ads/payments/storage/device). Зараз — web/mock
  реалізації; native-реалізації для Capacitor підключаються без зміни gameplay-коду.
- **Немає прив'язки до URL/router.** Стан сцен передається через Phaser scene data.

## Як додати нову механіку

Контракт модуля описаний в `ARCHITECTURE.md`: створіть
`src/mechanics/<name>/` з Model/View/Controller/Scene/Parser/Types +
`index.ts` (публічний API), додайте сцену в `bootstrap.ts` і конфіг рівнів у
`public/levels/`. Механіка спілкується зі світом лише через EventBus —
core-шар змінювати не потрібно.

## Формат рівнів (`public/levels/sorting_levels.json`)

```jsonc
{
  "version": 1,
  "mechanic": "sorting",
  "levels": [
    {
      "id": "level_001",     // унікальний id
      "cap": 3,               // висота колонки; повна колонка одного кольору зникає
      "par": 7,               // бюджет ходів для 3★
      "columns": [[1,0,1],[0,0,1],[],[]],  // кольори знизу вгору; [] — порожня
      "hiddenBelowTop": true, // опц.: блоки під верхнім приховані ("?")
      "lockedColumn": true    // опц.: додаткова колонка під замком (ключ-бустер)
    }
  ]
}
```

Валідація (`SortingLevelParser`): дублікати id, cap поза [2..8], колонок < 2,
колір з кількістю ≠ cap (не зникне ніколи), стартово зібрана колонка,
відсутність порожньої колонки — усе це дає зрозумілу помилку на error screen,
а не тихий crash. Новий рівень = новий об'єкт у JSON, код чіпати не треба.
`npm run levels:generate` перевіряє кожен згенерований рівень DFS-солвером
і калібрує `par` за знайденим рішенням.

## Loading flow

app start → шрифти (best-effort, 2.5s timeout) → level config (fetch + parse
+ валідація) → lobby. Будь-яка помилка → `ErrorScene` з поясненням і retry.

## Local progress

`ProgressManager` зберігає через `StorageService` (localStorage з in-memory
fallback): останній рівень, завершені рівні, спроби, best moves/stars,
тривалість. Структура версіонована (`version: 1`) і серіалізована — заміна на
backend/cloud save зводиться до нової реалізації `StorageService`.

## Responsive / app-like

- `Phaser.Scale.RESIZE` — канвас завжди дорівнює viewport, без letterbox;
  розкладка колонок перераховується (1–3 ряди) під будь-який екран/орієнтацію.
- Safe-area інсети iOS читаються з CSS `env()` через прихований probe-елемент
  і застосовуються до HUD.
- `touch-action:none`, `overscroll-behavior:none`, viewport-fit=cover — без
  скролу, зуму і pull-to-refresh.
- PWA: manifest (`display:fullscreen`), іконки 192/512, iOS meta-теги.
- Повернення з фону / зміна орієнтації → `scale.refresh()`.

## Input

Єдиний шар — Phaser pointer events (миша + тач без окремих гілок).
Модалки (`Popup`) кладуть interactive dim-layer, який блокує gameplay-input,
тому швидкі тапи під попапом не ламають стан. `SortingController.busy`
блокує input під час анімації зникнення колонки.

## Mock platform services

| Сервіс | Прототип |
|---|---|
| `AnalyticsService` | console.info з payload |
| `AdsService.showRewardedAd()` | миттєвий mock success |
| `PaymentsService.purchaseProduct()` | миттєвий mock success |
| `StorageService` | localStorage + in-memory fallback |
| `DeviceService` | mobile/orientation/screen/safe-area/standalone |
| `HapticsService` | navigator.vibrate з guard (no-op де не підтримується) |

## Analytics events

`app_started`, `assets_loaded`, `level_started`, `level_completed`,
`level_failed` (deadlock), `level_restarted`, `level_quit`, `move_made`,
`player_action_made` (узагальнена дія: move/undo/booster), `mechanic_loaded`,
`level_loaded`, `undo_used`, `restart_used`, `booster_used`,
`hint_used` (лупа), `reward_requested`/`ad_requested` (зарезервовано),
`error_occurred`. Базовий payload кожної події збагачується в GameController
полями `mechanic`, `device_type`, `app_version`; рівневі події додають
`level_id` і `difficulty`. Приклад:

```json
{ "mechanic": "sorting", "device_type": "mobile", "app_version": "0.1.0", "level_id": "level_004", "difficulty": 4, "moves_count": 18, "duration_sec": 92, "stars": 2, "result": "completed" }
```

## Capacitor (наступні кроки)

Проєкт уже сумісний: static build (`base:'./'`), без browser-only API в
gameplay (усе за platform layer), без router. Заготовка — `capacitor.config.json`.

```bash
npm run build
npm i @capacitor/core && npm i -D @capacitor/cli
npx cap add ios && npx cap add android
npx cap sync && npx cap open ios
```

Перед wrapper-збіркою: самозахостити шрифти Caveat/Neucha (зараз Google Fonts
CDN) і за потреби замінити mock-сервіси на native-реалізації `PlatformService`.

## Свідомі відхилення від ТЗ

- **Phaser 3, а не PixiJS** — сцени, scale manager, tweens і єдиний input
  layer закривають половину вимог ТЗ з коробки; ціна — більший vendor chunk
  (він винесений в окремий чанк і кешується).
- (Знято на вимогу замовника: лупа, туторіали, idle-підказка, вібрація і
  декор повернені; вібрація йде через platform HapticsService.)

## Художні ассети (skinning)

Гра рендерить процедурні заглушки, поки немає артів. Підключення артів —
config-driven: файли кладуться в `public/assets/`, реєструються в
`public/assets/manifest.json` (шаблон — `manifest.example.json`; ключі —
`src/core/assets/assetManifest.ts`). Підтримуються: картинки, texture-атласи
(TexturePacker JSON Hash), nine-slice для рамок/кнопок/панелей, покадрові
анімації (block clear, sparkle). Будь-який відсутній ключ = процедурний
fallback, тож часткові поставки безпечні. Повне ТЗ художнику —
`docs/asset-spec.md`.

## Тести

Критична логіка покрита unit-тестами (vitest, 43 tests):
валідація конфігів (`SortingLevelParser`), правила ходів / win / undo /
deadlock (`SortingModel`), input-флоу і події (`SortingController` зі
stub-view через `SortingViewContract`), `ProgressManager` (persist,
corrupted data), `EventBus`, layout-математика. Rendering/UI свідомо без
unit-тестів на цьому етапі (за гайдлайном).

## Known limitations

- Шрифти з Google Fonts CDN — самозахостити перед Capacitor build.
- Бустер-гаманець (ключі та лупи) живе в межах сесії, не в save (прототипний скоуп).
- Service worker кешує app shell; рівні — network-first з offline-fallback.
- Немає звуку, тож немає і налаштування звуку.
- Реальні тести на iPhone Safari / Android Chrome — вручну, поза CI.

## Next steps

- Друга механіка за тим самим module contract (перевірка масштабованості).
- Native-реалізації PlatformService через Capacitor (storage → Preferences).
- Реальна аналітика замість console-mock (той самий інтерфейс track()).
- E2E smoke (Playwright) для loading flow і одного рівня.
