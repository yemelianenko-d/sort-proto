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
| `index.ts` | публічний API модуля — єдина точка імпорту ззовні |

Щоб додати нову механіку: створити папку за цим контрактом, додати сцену в
`bootstrap.ts`, конфіг рівнів у `public/levels/`, і емітити ті самі події.
Core-шар змінювати не потрібно.

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
