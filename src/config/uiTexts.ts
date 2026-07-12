/**
 * Localised user-facing text.
 *
 * Dependency-free, fully typed i18n: `uk` is the source dictionary, its shape
 * becomes the `Messages` contract (`typeof uk`), and every other locale must
 * satisfy it — a missing or extra key is a compile error. `UI_TEXTS` is a live
 * binding that `setLocale` re-points; call sites keep reading `UI_TEXTS.x.y`
 * and pick up the active locale when their screen next renders.
 *
 * Add a language: write its dictionary as `Messages`, register it in `DICTS`
 * and `LOCALES`. Interpolation stays type-safe (typed functions, not string
 * templates), which is why we avoid a heavier runtime i18n lib on this stack.
 */
import { storageGet, storageSet } from '../core/utils/storage';
import { STORAGE_KEYS } from '../app/gameConfig';

export type Locale = 'uk' | 'en';

const uk = {
  app: {
    title: 'Scribble Sort: Сортування кольорів',
    loading: 'Завантаження…',
  },
  // Per-mechanic strings live under their own namespace so each mechanic owner
  // adds keys here without touching another mechanic's block (see MECHANIC_SDK).
  mechanics: {
    sorting: { name: 'Scribble Sort' },
    blocks: {
      name: 'Блоки',
      level: (n: number) => `Рівень ${n}`,
      goalClear: (left: number) => `Прибрати блоки: ${left}`,
      goalClearLabel: 'Прибрати:',
      combo: (chain: number) => `Комбо ${chain}`,
      goalScore: (score: number, target: number) => `Очки: ${score} / ${target}`,
      score: (n: number) => `Очки: ${n}`,
      scoreLabel: 'Очки',
      pieces: (n: number) => `Фігури: ${n}`,
      reviveCount: (n: number) => `♻ ${n}`,
      revive: (n: number) => `Продовжити (${n})`,
      howtoTitle: 'Як грати',
      howtoBody:
        'Перетягуй фігури з лотка на поле. Повний рядок або стовпець зникає. Прибери стартові блоки чи набери очки — і рівень пройдено. Якщо жодна фігура не вміщується — програш.',
      winScore: (score: number) => `Очки: ${score}`,
      winHintAfter: (par: number) => `— ${par} фігур`,
      failTitle: 'Немає місця!',
      failBody: 'Фігурам з лотка більше нема куди стати.',
      confirmBody: 'Прогрес цього рівня зникне.',
      praise: {
        double: ['Гарно!', 'Акуратно!'],
        triple: ['Чудово!', 'Як по лінійці!'],
        quad: ['Легендарно!', 'Майстерно!'],
        allClear: ['Чистий аркуш!'],
      },
      endlessName: 'Нескінченний',
      endlessBest: (n: number) => `Рекорд: ${n}`,
      gameOverTitle: 'Гру завершено',
      gameOverScore: (score: number) => `Рахунок: ${score}`,
      gameOverBest: (best: number) => `Рекорд: ${best}`,
      newBest: 'Новий рекорд! 🎉',
    },
  },
  lobby: {
    play: 'Грати',
    playAgain: 'Грати ще',
    progressDone: (done: number) => `Пройдено: ${done}`,
    progress: (done: number, total: number, stars: number) =>
      `Пройдено: ${done}/${total} · ★ ${stars}`,
  },
  hud: {
    level: (n: number, par: number) => `Рівень ${n} · ціль ≤ ${par}`,
    moves: (n: number) => `Ходи: ${n}`,
    undo: '↶ назад',
    lens: (n: number) => `🔍 ${n}`,
    key: (n: number) => `🔑 ${n}`,
    countOnly: (n: number) => `${n}`,
    back: '←',
    restart: '↺',
  },
  tutorials: {
    ok: 'Зрозуміло!',
    howto: {
      emoji: '✏️',
      title: 'Як грати',
      body: 'Збирай колонки з однакових фігур: клади блок лише на такий самий зверху або в порожню колонку. Повна колонка одного виду — готова: її позначає стрічка «Готово», і вона більше не заважає. Розбери так усю дошку!',
    },
    hidden: {
      emoji: '❓',
      title: 'Приховані блоки',
      body: 'Заштриховані блоки відкриваються, коли стають верхніми в колонці. Лупа відкриє один одразу.',
    },
    locked: {
      title: 'Замкнена колонка',
      body: 'Додатковий простір під замком. Відкривається ключем, але рівень можна пройти й без нього.',
    },
    target: {
      title: 'Колонка кольору',
      body: 'Ця колонка — під один колір, його підказує блідий візерунок. Клади сюди лише блоки цього кольору.',
    },
    chains: {
      title: 'Колонка з печаткою',
      body: 'Колонку запечатано. На печатці — блок: збери повний набір цього кольору, і печатка спаде. Коли впадуть усі печатки, колонка відкриється.',
    },
    multilock: {
      title: 'Два замки',
      body: 'На цій колонці два замки — знадобляться два ключі. Кожен знайдений ключ знімає один замок.',
    },
    ink: {
      title: 'Чорнильна пляма',
      body: 'Мертве місце внизу колонки: її не можна ані взяти, ані прибрати. Класти блоки зверху можна — просто робочих слотів у цій колонці менше.',
    },
    keyblock: {
      title: 'Ключ у завалі',
      body: 'Серед блоків захований ключ: відкопай його — і він сам відімкне замкнену колонку. А якщо застряг, відкрий її ключем-бустером згори.',
    },
    taped: {
      title: 'Паперовий клапан',
      body: 'Клапан працює в один бік: звідси можна лише брати блоки, а класти — ні. Спорожни колонку раз — і клапан відклеїться.',
    },
  },
  decorNotes: ['д/з: зібрати всі ★', '3 однакових = ✓', 'не здавайся!', 'сортуй → збирай ↺', 'майже вийшло!', '?!'],
  win: {
    title: 'Рівень пройдено!',
    moves: (moves: number) => `Ходів: ${moves}`,
    hintBefore: 'До 3',
    hintAfter: (par: number) => `— ${par} ходів`,
    next: 'Далі →',
    toLobby: 'У лоббі',
    replay: 'Ще раз',
  },
  locked: {
    tag: '🔑 відкрити',
    tagText: 'відкрити',
  },
  quitConfirm: {
    title: 'Вийти з рівня?',
    body: 'Прогрес цього рівня зникне, а витрачені бустери не повернуться.',
    yes: 'Вийти',
    no: 'Продовжити',
  },
  restartConfirm: {
    title: 'Почати заново?',
    body: 'Прогрес цього рівня зникне, а витрачені бустери не повернуться.',
    yes: '↺ Заново',
    no: 'Продовжити',
  },
  settings: {
    button: '⚙',
    title: 'Налаштування',
    language: 'Мова',
    ok: 'Добре',
    cheat: 'Чит-режим',
  },
  cheat: {
    reset: 'Скинути прогрес',
    win: 'WIN',
    solve: 'AUTO',
  },
  error: {
    title: 'Не вдалося запустити гру',
    retry: 'Спробувати ще раз',
    unknown: 'Невідома помилка завантаження.',
    levelNotFound: (index: number) => `Рівень з індексом ${index} не знайдено в конфігу.`,
    loadFailed: (url: string) => `Не вдалося завантажити конфіг рівнів (${url}): мережа недоступна.`,
    httpError: (url: string, status: number) => `Конфіг рівнів не знайдено (${url}): HTTP ${status}.`,
    corrupted: 'Конфіг рівнів пошкоджено: файл не є валідним JSON.',
  },
};

/** The text contract every locale must satisfy. */
export type Messages = typeof uk;

const en: Messages = {
  app: {
    title: 'Scribble Sort: Color Puzzle',
    loading: 'Loading…',
  },
  mechanics: {
    sorting: { name: 'Scribble Sort' },
    blocks: {
      name: 'Blocks',
      level: (n: number) => `Level ${n}`,
      goalClear: (left: number) => `Clear the blocks: ${left}`,
      goalClearLabel: 'Clear:',
      combo: (chain: number) => `Combo ${chain}`,
      goalScore: (score: number, target: number) => `Score: ${score} / ${target}`,
      score: (n: number) => `Score: ${n}`,
      scoreLabel: 'Score',
      pieces: (n: number) => `Pieces: ${n}`,
      reviveCount: (n: number) => `♻ ${n}`,
      revive: (n: number) => `Continue (${n})`,
      howtoTitle: 'How to play',
      howtoBody:
        'Drag pieces from the tray onto the board. A full row or column clears. Remove the starting blocks or reach the score — and the level is done. If no piece fits, you lose.',
      winScore: (score: number) => `Score: ${score}`,
      winHintAfter: (par: number) => `— ${par} pieces`,
      failTitle: 'No room left!',
      failBody: 'None of the tray pieces fits anywhere.',
      confirmBody: 'This level’s progress will be lost.',
      praise: {
        double: ['Nice!', 'Neat!'],
        triple: ['Great!', 'Ruler-straight!'],
        quad: ['Legendary!', 'Masterful!'],
        allClear: ['Clean sheet!'],
      },
      endlessName: 'Endless',
      endlessBest: (n: number) => `Best: ${n}`,
      gameOverTitle: 'Game over',
      gameOverScore: (score: number) => `Score: ${score}`,
      gameOverBest: (best: number) => `Best: ${best}`,
      newBest: 'New best! 🎉',
    },
  },
  lobby: {
    play: 'Play',
    playAgain: 'Play again',
    progressDone: (done: number) => `Done: ${done}`,
    progress: (done: number, total: number, stars: number) =>
      `Done: ${done}/${total} · ★ ${stars}`,
  },
  hud: {
    level: (n: number, par: number) => `Level ${n} · goal ≤ ${par}`,
    moves: (n: number) => `Moves: ${n}`,
    undo: '↶ undo',
    lens: (n: number) => `🔍 ${n}`,
    key: (n: number) => `🔑 ${n}`,
    countOnly: (n: number) => `${n}`,
    back: '←',
    restart: '↺',
  },
  tutorials: {
    ok: 'Got it!',
    howto: {
      emoji: '✏️',
      title: 'How to play',
      body: 'Build columns of matching shapes: drop a block only onto the same shape or into an empty column. A full column of one kind is done — a “done” ribbon marks it and it stays out of the way. Clear the whole board!',
    },
    hidden: {
      emoji: '❓',
      title: 'Hidden blocks',
      body: 'Hatched blocks reveal themselves once they reach the top of a column. The lens booster reveals one right away.',
    },
    locked: {
      title: 'Locked column',
      body: 'Extra space behind a lock. A key opens it, but the level can be finished without it.',
    },
    target: {
      title: 'Colour column',
      body: 'This column takes one colour — the faint pattern hints which. Drop only blocks of that colour here.',
    },
    chains: {
      title: 'Sealed column',
      body: 'The column is sealed. Each seal shows a block: collect a full set of that colour and the seal falls. Once every seal is gone, the column opens.',
    },
    multilock: {
      title: 'Two locks',
      body: 'This column has two locks — you will need two keys. Each key you find removes one lock.',
    },
    ink: {
      title: 'Ink blot',
      body: 'Dead space at the bottom of a column: it cannot be lifted or removed. You can still drop blocks on top — the column just has fewer usable slots.',
    },
    keyblock: {
      title: 'Key in the pile',
      body: 'A key is buried among the blocks: dig it out and it unlocks the locked column. Stuck? Open it with the key booster up top.',
    },
    taped: {
      title: 'Paper flap',
      body: 'The flap is one-way: you can only take blocks out, not put them in. Empty the column once and the flap peels away.',
    },
  },
  decorNotes: ['hw: collect every ★', '3 alike = ✓', 'don’t give up!', 'sort → collect ↺', 'almost there!', '?!'],
  win: {
    title: 'Level complete!',
    moves: (moves: number) => `Moves: ${moves}`,
    hintBefore: 'Up to 3',
    hintAfter: (par: number) => `— ${par} moves`,
    next: 'Next →',
    toLobby: 'Lobby',
    replay: 'Replay',
  },
  locked: {
    tag: '🔑 open',
    tagText: 'open',
  },
  quitConfirm: {
    title: 'Leave the level?',
    body: 'This level’s progress will be lost, and spent boosters won’t return.',
    yes: 'Leave',
    no: 'Stay',
  },
  restartConfirm: {
    title: 'Start over?',
    body: 'This level’s progress will be lost, and spent boosters won’t return.',
    yes: '↺ Restart',
    no: 'Stay',
  },
  settings: {
    button: '⚙',
    title: 'Settings',
    language: 'Language',
    ok: 'OK',
    cheat: 'Cheat mode',
  },
  cheat: {
    reset: 'Reset progress',
    win: 'WIN',
    solve: 'AUTO',
  },
  error: {
    title: 'Could not start the game',
    retry: 'Try again',
    unknown: 'Unknown loading error.',
    levelNotFound: (index: number) => `Level with index ${index} was not found in the config.`,
    loadFailed: (url: string) => `Could not load the level config (${url}): network unavailable.`,
    httpError: (url: string, status: number) => `Level config not found (${url}): HTTP ${status}.`,
    corrupted: 'Level config is corrupted: the file is not valid JSON.',
  },
};

const DICTS: Record<Locale, Messages> = { uk, en };

/** Registry for the language switcher (labels are endonyms — self-names). */
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
];

function detectInitialLocale(): Locale {
  const saved = storageGet(STORAGE_KEYS.locale);
  if (saved === 'uk' || saved === 'en') return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : '';
  return nav.startsWith('en') ? 'en' : 'uk'; // Ukrainian-first, English if the device is
}

let activeLocale: Locale = detectInitialLocale();

/** Live text for the active locale. Reassigned by setLocale (ES live binding). */
export let UI_TEXTS: Messages = DICTS[activeLocale];

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === activeLocale) return;
  activeLocale = locale;
  UI_TEXTS = DICTS[locale];
  storageSet(STORAGE_KEYS.locale, locale);
}
