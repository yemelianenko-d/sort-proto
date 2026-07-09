# MECHANIC SDK — authoring a new mechanic

This project is a **Puzzle Hub**: a collection of self-contained puzzle
mechanics (each essentially its own game) built on **one shared base** — the
sorting mechanic's graphics, UI kit and design system. A future **master-lobby**
will let the player pick a mechanic; it does not exist yet, but every mechanic
already self-registers so wiring it later is one step.

This doc is the contract a new-mechanic agent follows. Read it with
`ARCHITECTURE.md` (layers, lifecycle) and `docs/STYLE_GUIDE.md` (visual system)
before writing code.

## 1. Golden rule — stay in your folder

A mechanic lives entirely in **`src/mechanics/<id>/`** and its asset bucket
**`public/assets/mechanics/<id>/`**. You own those; nobody else edits them, and
you don't edit anyone else's. Everything above is the **shared layer**
(`app/ core/ ui/ config/ platform/ scenes/`, `public/assets/shared/`) and is
governed (see §9).

Dependency direction is **App → Core → Mechanics**. A mechanic may import shared
**config/constants and the UI kit** (`gameConfig`, `uiTexts`, `ui/*`) and talks
to the game **only through the EventBus** (`src/core/events/EventBus.ts`). A
mechanic must **never** import platform/browser/Capacitor APIs, storage or
analytics — go through the EventBus and the shared managers instead.

## 2. Folder contract

`src/mechanics/<id>/` mirrors sorting (see `ARCHITECTURE.md` for each file's
responsibility):

| File | Responsibility |
|---|---|
| `<Name>Types.ts` | data types + `<Name>ViewContract` |
| `<Name>LevelParser.ts` | validate external config, clear errors |
| `<Name>Model.ts` | pure state logic, **no Phaser**, unit-tested |
| `<Name>View.ts` | render/animations only, implements the ViewContract |
| `<Name>Controller.ts` | input → model → view, emits EventBus events |
| `<Name>Scene.ts` | Phaser scene: HUD, popups, level lifecycle |
| `<name>Module.ts` | the `MechanicModule` descriptor (see §3) |
| `index.ts` | public API — the **only** import surface from outside |

Also provide a `StubView` implementing the ViewContract for controller unit
tests (see `SortingController.test.ts`). The Model must be Phaser-free and
covered by unit tests — that suite is the mechanic's freeze contract.

## 3. Register the mechanic

Export a `MechanicModule` (`src/core/mechanics/MechanicModule.ts`) from your
`index.ts`, then add **one line** to `src/app/mechanics.ts`:

```ts
// src/mechanics/blocks/blocksModule.ts
export const blocksModule: MechanicModule = {
  id: 'blocks',
  title: () => UI_TEXTS.mechanics.blocks.name,
  scenes: [BlocksScene],
  entryScene: SCENE_KEYS.blocks,        // add the key to gameConfig SCENE_KEYS
  levelsUrl: 'levels/blocks_levels.json',
  assetManifestUrl: 'assets/mechanics/blocks/manifest.json',
};

// src/app/mechanics.ts
export const MECHANICS = [sortingModule, blocksModule];
```

`bootstrap.ts` registers your scenes from the registry automatically — don't edit
bootstrap. `sortingModule.ts` is the reference implementation.

## 4. Build on the shared UI kit (this is "built on sorting's base")

Render UI through the shared components so you inherit the look for free:
`ui/Popup.ts`, `ui/Button.ts`, `ui/sketch.ts` (sketch strokes), `ui/doodles.ts`,
and `COLORS` / `FONTS` from `app/gameConfig.ts`. Follow the STYLE_GUIDE recipe
"додати візуал нової механіки в стилі" for the mechanic's own visual metaphor.
Do **not** fork these components — if one needs a capability, extend it
additively (§9).

## 5. Assets — your own bucket, prefixed keys

- Shared design-system art lives in `public/assets/shared/` (with its
  `manifest.json`) and is loaded for every mechanic. Reference it via the shared
  keys — never redefine those.
- Your textures go in `public/assets/mechanics/<id>/` with their own
  `manifest.json`, and every key is **prefixed with your id**: `blocks/tile_0`,
  `blocks/board_frame`, … The prefix makes collisions impossible and ownership
  obvious. (Sorting's keys are grandfathered unprefixed — frozen code; do not
  copy that: new mechanics always prefix.)
- The Preloader loads the shared manifest plus every registered module's
  `assetManifestUrl` (per-mechanic lazy-loading arrives with the master-lobby).
- Missing art falls back to procedural sketch placeholders (see
  `core/assets/assetManifest.ts`) — you can build entirely on shared assets +
  placeholders and drop your art in later with no code change.

## 6. i18n — your own namespace

Add strings under `mechanics.<id>` in **both** dictionaries in
`src/config/uiTexts.ts` (the types force parity uk/en). Read them via
`UI_TEXTS.mechanics.<id>.*`. Never touch another mechanic's namespace.

## 7. Progress — namespaced by id

Global progress is namespaced per mechanic id in `ProgressManager` — read/write
only your `<id>` slice. The master-lobby will read each module's slice for its
tile.

## 8. EventBus events

Emit the same lifecycle events sorting uses so the shell, analytics and future
master-lobby understand every mechanic uniformly (names in `EventBus.ts`):
`mechanic_loaded`, `level_loaded`, `level_started`, `move_made`,
`player_action_made`, `booster_used`, `hint_used`, `undo_used`,
`restart_used`, `level_completed`, `level_failed`, `level_quit`,
`level_restarted`, `error_occurred`.

## 9. Shared-layer governance

- **CODEOWNERS** gates every shared path — a PR touching `app/ core/ ui/ config/
  scenes/` or `assets/shared/` needs the shared steward's review.
- **Additive-only**: add a new optional prop, component or variant; never change
  an existing default or signature that another mechanic relies on. This keeps
  sorting (and every other mechanic) byte-for-byte unaffected.
- **Tests are the guard**: a shared change that breaks sorting turns its unit
  suite red in CI → the PR is blocked. If you must change shared behaviour,
  coordinate with the steward.

## 10. New-mechanic checklist

1. `src/mechanics/<id>/` per the §2 contract, Model unit-tested + StubView.
2. `<id>Module.ts` descriptor + one line in `src/app/mechanics.ts`.
3. `SCENE_KEYS.<id>` in `gameConfig.ts`; scene key wired.
4. `public/assets/mechanics/<id>/` bucket + manifest, keys prefixed `<id>/`.
5. `mechanics.<id>` strings in `uiTexts.ts` (uk + en).
6. UI via the shared kit; visuals per STYLE_GUIDE.
7. Quality gates green: `npx tsc --noEmit`, `npm test`, `npm run lint`,
   `npm run build`.
8. CODEOWNERS entries for your folder + asset bucket.
