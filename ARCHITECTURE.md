# ARCHITECTURE

## Шари і залежності

```
App Layer        src/app        — composition root, config, debug tools
Core Layer       src/core       — GameController/State, LevelManager, ProgressManager, EventBus, utils
Mechanics Layer  src/mechanics  — ізольовані puzzle-модулі (зараз: sorting)
UI Layer         src/ui         — Button, Popup, Preloader, ResponsiveContainer, sketch-рендер-хелпери
Platform Layer   src/platform   — інтерфейси сервісів + web/mock реалізації
Config/Data      src/config, public/levels — тексти, налаштування, рівні
```

Напрямок залежностей:

```
App → Core → Mechanics
Core → Platform (через інтерфейси PlatformService)
Mechanics → EventBus (і більше нікуди)
UI → Core/Mechanics лише через публічний API
```

Механіка ніколи не імпортує platform/browser/Capacitor API, storage чи
analytics. Комунікація назовні — тільки події EventBus.

## Контракт модуля механіки

Кожна механіка = папка `src/mechanics/<name>` з файлами:

| Файл | Відповідальність |
|---|---|
| `<Name>Types.ts` | типи даних + `<Name>ViewContract` |
| `<Name>LevelParser.ts` | валідація зовнішнього конфігу, зрозумілі помилки |
| `<Name>Model.ts` | чиста логіка стану (без Phaser), unit-тестована |
| `<Name>View.ts` | тільки рендер/анімації, реалізує ViewContract |
| `<Name>Controller.ts` | input → model → view, емітить події; залежить від ViewContract |
| `<Name>Scene.ts` | Phaser-сцена: HUD, попапи, lifecycle |
| `<name>Module.ts` | дескриптор `MechanicModule` (реєстрація + master-lobby) |
| `index.ts` | публічний API модуля — єдина точка імпорту ззовні |

Щоб додати нову механіку: створити папку за цим контрактом, експортувати
`MechanicModule` і додати **один рядок** у реєстр `src/app/mechanics.ts`, покласти
конфіг рівнів у `public/levels/`, ассети — у власний бакет (див. нижче), і
емітити ті самі події. `bootstrap.ts` і Core-шар змінювати не потрібно. Повний
контракт автора — `docs/MECHANIC_SDK.md`.

## Puzzle Hub: реєстр механік

Проект — колекція самодостатніх механік на спільній базі; у майбутньому їх
об'єднає master-lobby. Механіки **самоописуються**, а не хардкодяться:

```
core/mechanics/MechanicModule.ts  — контракт (core, механіко-агностичний)
mechanics/<id>/<id>Module.ts       — дескриптор механіки (id, title, scenes, levelsUrl…)
app/mechanics.ts                   — реєстр MECHANICS (composition root, 1 рядок/механіка)
app/bootstrap.ts                   — будує масив сцен Phaser із реєстру
```

Master-lobby (коли з'явиться) перелічує `MECHANICS` і малює плитку на кожну.
Механізм завантаження ассетів/рівнів уже сумісний — саме лоббі відкладено.

## Спільний шар vs механіка

```
SHARED   app/ core/ ui/ config/ platform/ scenes/  +  public/assets/shared/
MECHANIC src/mechanics/<id>/  +  public/assets/mechanics/<id>/   — приватне власнику
```

Механіка споживає UI-кіт (`ui/Popup`, `ui/Button`, `ui/sketch`, `ui/doodles`,
`COLORS`/`FONTS`) — так вона успадковує вигляд. Спільний код для власників
механік — **тільки additive** (нові опції/компоненти, не зміна наявної
поведінки), щоб одна механіка не ламала іншу.

## Ассети: два бакети

- `public/assets/shared/manifest.json` — дизайн-система, вантажиться завжди
  (`SHARED_MANIFEST_URL` в `AssetLoader`); спільні ключі не переоголошувати.
- `public/assets/mechanics/<id>/manifest.json` — текстури механіки
  (`MechanicModule.assetManifestUrl`). Ключі **нових** механік — з префіксом
  `<id>/` (напр. `blocks/tile_0`), щоб колізії були неможливі; ключі сортингу —
  grandfathered без префікса (заморожений код не чіпаємо).
- Preloader вантажить shared + манифести всіх механік з реєстру (з однією
  механікою «одразу» == «ліниво»; per-mechanic lazy-load прийде з master-lobby).
- Standalone-білд (`tools/make-standalone.mjs`) зливає обидва манифести в
  `window.__SORTPROTO_ASSETS__` (data URIs).
- Відсутній арт → процедурна sketch-заглушка (`core/assets/assetManifest.ts`).

## Governance (ізоляція механік у моно-репо)

- **CODEOWNERS** (`.github/CODEOWNERS`) — зміни спільного шару вимагають ревʼю
  стюарда; папки механік — власнику.
- **Тести-заморозка**: юніт-набір механіки (напр. ~107 тестів сортингу) червоніє
  в CI, якщо спільна зміна ламає механіку → PR блокується.
- **Namespace**: i18n (`mechanics.<id>`), прогрес (`ProgressManager` per id),
  ассети (префікс ключа) — власники не перетинаються.

## Lifecycle рівня

```
LobbyScene → SortingScene.init({levelIndex})
  → LevelManager.byIndex → level_loaded
  → new Model/View/Controller → level_started
  → Input → Controller → Model → View.rebuild → EventBus(move_made, ...)
  → win: level_completed → Popup → next/restart
  → deadlock: level_failed → Popup(undo/key/restart)
  → SHUTDOWN: view.destroy(); всі tweens/listeners — scene-owned, помирають зі сценою
```

Undo/restart — через контрольовану історію снапшотів у моделі
(`pushSnapshot/undo`); рестарт = `scene.restart` з чистим станом.

## State management

Єдине джерело правди на рівень — `SortingModel`. View нічого не мутує;
Controller — єдиний, хто викликає команди моделі. Глобальний прогрес —
тільки в `ProgressManager` (persist через `StorageService`, schema
`version: 1`, обробка corrupted data, `clear()` для debug).

## Заміна mock-сервісів на реальні

Реалізуйте інтерфейси з `platform/PlatformService.ts` (Analytics, Ads,
Payments, Storage, Device) новим класом, наприклад
`CapacitorPlatformService`, і передайте його в `GameController` у
`bootstrap.ts`. Gameplay-код не змінюється.

## Capacitor build (майбутнє)

1. `npm run build` → статичний `dist/` (base `./`, без router).
2. `npm i @capacitor/core && npm i -D @capacitor/cli`
3. `npx cap add ios && npx cap add android` (заготовка: `capacitor.config.json`, webDir=dist)
4. Шрифти вже self-hosted (`@fontsource/caveat`, `@fontsource/neucha` —
   bundled woff2, offline-ready; імпортуються в `bootstrap.ts`).
5. За потреби — native-реалізації PlatformService (storage → Preferences тощо).
