# Промти для генерації ассетів (ChatGPT / DALL·E / GPT-Image)

Готові промти, щоб перемалювати ассети, які потребують художньої роботи
(див. ревю). Стиль — строго «зошит у клітинку» (див. `STYLE_GUIDE.md`).

## Як користуватись

1. Копіюй промт у ChatGPT (модель із генерацією зображень). Пиши промти
   **англійською** — моделі так стабільніші.
2. Проси **прозорий фон**. Якщо модель усе одно дає білий/картатий фон —
   прибрати альфу вручну (Photoshop/remove.bg) до чистої прозорості.
3. **Постобробка обов'язкова:** обрізати до вмісту з padding 2–4px,
   зменшити до цільового розміру (@2x із `asset-spec.md`), зберегти
   **PNG-24 з альфою** під **точним ім'ям файлу**.
4. **Drop-in:** поклади готовий PNG у `public/assets/images/` під тим самим
   іменем — гра підхопить автоматично, **без змін коду** (крім `primary`,
   див. нижче). Ім'я файлу = ключ у грі.
5. Обмеження моделей, які треба тримати в голові:
   - **Кирилицю й дрібні символи (♥△◆✱⬡) моделі часто спотворюють.** Проси
     малювати *форму* («a simple outlined triangle»), а не гліф. Текст —
     кілька спроб або дорисувати леттеринг вручну.
   - Моделі люблять градієнти/тіні/3D — у промті **явно забороняй** їх.
   - 8 однакових за стилем блоків важко зробити порізно → або грід-аркуш
     одним зображенням (потім порізати), або жорсткий шаблон стилю (нижче).

---

## Спільний опис стилю (встав у КОЖЕН промт)

```
STYLE (keep identical every time):
Hand-drawn doodle in the style of a child's school exercise-book sketch.
Outline: thin, slightly shaky ROYAL-BLUE ballpoint-pen line, clearly drawn
by hand (wobbly, imperfect). Fill: light COLORED-PENCIL hatching — visible
individual diagonal pencil strokes, uneven, NOT a flat vector fill. FLAT
and friendly: no realistic shading, no gradients, no drop shadow, no 3D, no
bevel, no glossy highlights. Fully TRANSPARENT background. Object centered,
small 2–4px margin, nothing cropped. No text, no numbers, no watermark.
Warm, casual, low-contrast, cute.
```

---

## 1. Блоки (8 шт) — найважливіше

Ціль: не просто коректні за таблицею, а **охайні, соковиті, милі** плитки —
зошитні, але чисті (перша спроба вийшла «грубою чернеткою»: дряпана
штриховка, задвоєний тремтливий контур, бліді заливки, синій символ
зливається з рамкою). Кожен блок — окремий файл `block_0.png` …
`block_7.png`, **128×128**, квадрат зі скругленими кутами.

**5 правил привабливості (ключове — не пропускати):**
1. **Один охайний контур**, не задвоєний: рівна темно-синя лінія з ЛЕГКИМ
   рукописним тремтінням, а не дряпанина.
2. **Рівна, соковита заливка** (як гладкий олівець/гуаш) із ЛЕДЬ помітним
   зерном паперу — без грубих смуг, білих прогалин і вицвілості.
3. **Символ ПО-БІЛОМУ** з тонким синім контуром, великий (~50% плитки) —
   так він вистрілює з кольору (а не зливається, як синій).
4. **Патерн — дуже блідий**, лише натяк текстури на тлі, щоб не сперечався
   із символом.
5. **Єдина вага лінії й розмір** на всіх 8 — набір має виглядати як родина.

### Рекомендований промт — один аркуш (найкраща консистентність)

```
A set of 8 CUTE, CLEAN, high-quality mobile puzzle game tiles, drawn in a
tidy "notebook doodle" style — hand-drawn charm but POLISHED and appealing,
NOT a rough scribble. Lay them out as a 4×2 grid, even spacing, on a fully
TRANSPARENT background.

Each tile:
- a rounded-corner square with ONE single, confident, tidy NAVY-BLUE outline
  with only a gentle hand-drawn wobble (NOT doubled, NOT scratchy); the top
  edge is slightly open, as if the little box opens upward;
- filled with a SOFT, EVEN, VIBRANT color (smooth crayon/gouache look) with
  only a faint paper grain — rich and saturated, friendly, NO harsh diagonal
  scribble, NO white streaks or gaps, NO washed-out faded look;
- a very FAINT texture pattern hint in the fill (subtle, never competing);
- ONE bold, large, simple centered symbol, filled WHITE with a clean navy
  outline so it clearly POPS off the color.
Keep line weight, symbol size and framing IDENTICAL across all eight so they
read as one family. Cheerful, satisfying, sticker-like, inviting — like a
premium casual puzzle game.

The eight tiles (left→right, top→bottom):
1) warm red,        white heart,        faint diagonal stripes
2) royal blue,      white triangle,     faint polka dots
3) leaf green,      white diamond,      faint cross-hatch
4) orange,          white circle ring,  faint horizontal lines
5) deep brown,      white hexagon,      faint reverse-diagonal stripes
6) teal,            white star,         faint fine dots
7) magenta pink,    white rounded square, faint wavy lines
8) violet,          white flower,       faint vertical lines

NEGATIVE (avoid): scratchy, messy, streaky pencil; doubled or overlapping
wobbly frames; faded/low-contrast/dirty look; rough unfinished sketch;
childish scrawl; realistic 3D, gradients, drop shadows, bevel.
```

> Порядок кольорів у промті ≠ індекс: збережи як `block_0…7` за таблицею
> нижче (0 червоний, 1 синій, 2 зелений, 3 помаранчевий, 4 фіолетовий,
> 5 коричневий, 6 бірюзовий, 7 рожевий). Точні hex не критичні — після
> заміни арту `BLOCK_TINTS` перегенерується сэмплером.

| # | Колір | Символ (білий) | Патерн (блідий) |
|---|---|---|---|
| 0 | червоний | серце | діагональ |
| 1 | синій | трикутник | крапки |
| 2 | зелений | ромб | сітка |
| 3 | помаранчевий | коло | горизонталі |
| 4 | фіолетовий | квіточка | вертикалі |
| 5 | коричневий (темний) | шестикутник | зворотна діагональ |
| 6 | бірюзовий | зірка | дрібні крапки |
| 7 | малиновий/рожевий | квадрат | хвилі |

**Порада:** якщо аркуш знову дряпаний — згенеруй **по одному блоку окремо**
(тим самим описом стилю, «one single tile…») і попроси «clean vector-like
finish, smooth fill, crisp». Порізати аркуш на 8 файлів можу я (див. нижче).

---

## 2. `deco_seal.png` — печатка (перемалювати вільніше)

Зараз надто «векторно-глянцева» (золото, бевел) — випадає зі стилю. У грі
все одно тінтується в сірий, тож потрібен **плаский ескізний** варіант.
Розмір як у поточного (≈256×256, квадрат, центр порожній під блок).

```
[СПІЛЬНИЙ ОПИС СТИЛЮ]

SUBJECT: a rosette / wax-seal medallion badge. A round medallion in the
center with two short ribbon tails going out to the left and right, each
ending in a downward notched (swallowtail) tip. The center circle is EMPTY
— leave it blank/cream (a game symbol is placed inside later).
CRITICAL: draw it FLAT in the loose notebook doodle style — thin wobbly
blue pen outline + light neutral pencil hatch only. NO gold, NO metallic
gradient, NO bevel, NO shine, NO realistic ribbon folds. Muted neutral
tones so it can be tinted a single flat color in-game. Transparent bg.
```

---

## 3. `icon_star_empty.png` — порожня зірка (узгодити контур)

Дрібний фікс: у повної зірки контур **синій**, у порожньої зараз —
золотий/теплий. Треба порожню з **тим самим синім** контуром. 96×96.

```
[СПІЛЬНИЙ ОПИС СТИЛЮ]

SUBJECT: a single 5-point star, EMPTY (no colored fill). Thin ROYAL-BLUE
wobbly ballpoint-pen outline ONLY — the same blue as a pen, NOT gold/orange.
Interior transparent (or a very faint gray pencil trace). Square canvas,
star centered. Match a hand-drawn "empty/unearned" rating star.
```

---

## 4. `ui_button_primary.png` — головна кнопка (опційно, потребує рішення)

**Увага:** зараз код малює primary-кнопки зеленою success-шкурою, а цей файл
не використовується. Щоб зробити головний CTA (кнопка «Грати»/«Далі»)
візуально окремим від зеленого «підтвердити», потрібно (а) намалювати нижче
і (б) **одна правка в `Button.ts`**, щоб primary брав свою шкуру — скажи, і
я зроблю. Nine-slice: краї однорідні, декор лише в кутах, центр рівний.
96×96, широка «пігулка».

```
[СПІЛЬНИЙ ОПИС СТИЛЮ]

SUBJECT: a wide horizontal rounded-rectangle BUTTON (pill), the main
call-to-action. Wobbly blue pen outline + warm YELLOW/AMBER highlighter
colored-pencil fill (like a marker swipe). It must look the most inviting
button on screen but must NOT be green (green is reserved for confirm).
Interior EMPTY (the label is rendered by the game — leave it blank, no text).
Uniform stretchable edges (nine-slice friendly): keep the center and edge
midlines plain, put any tiny decoration only in the corners. Transparent bg.
```

---

## 5. `deco_sort_*.png` — маргінальні дудли-написи (узгодити мову)

Поточні — англійською («May the sort be with you»), тоді як гра й
`decorNotes` — українською. Або лишаємо англійські каламбури свідомо, або
робимо українські. Це фонові написи (alpha 0.24), тож дрібні — але текст
кирилицею моделі часто псують: закладай кілька спроб або леттеринг вручну.
Широкі (≈`3:1`), прозорий фон.

```
[СПІЛЬНИЙ ОПИС СТИЛЮ]

SUBJECT: one line of casual hand-written UKRAINIAN text in blue ballpoint
pen (child's handwriting), with a wavy underline and small accent dashes on
both sides. Notebook margin-doodle look. Transparent background.
The text must read EXACTLY (Ukrainian Cyrillic): "{ФРАЗА}"
```

Фрази-кандидати (по одному файлу на фразу):
- `Сортуй до перемоги!`
- `3 однакових = ✓`
- `Майже вийшло!`
- `Не здавайся!`
- `Все по поличках`

---

## Мапа файлів (куди класти)

| Ассет | Файл | Розмір @2x |
|---|---|---|
| Блоки 0–7 | `block_0.png` … `block_7.png` | 128×128 |
| Печатка | `deco_seal.png` | ~256×256 |
| Порожня зірка | `icon_star_empty.png` | 96×96 |
| Головна кнопка | `ui_button_primary.png` | 96×96 (nine-slice) |
| Дудли-написи | `deco_sort_01.png` … | широкі, ~довільно |

Усі — у `public/assets/images/`. Після заміни блоків:
`node tools/art/sample-block-tints.mjs` → оновити `BLOCK_TINTS` у
`src/app/gameConfig.ts`.

---

# Механіка «Блоки»: ассети ігрового поля-кресленика

Поле блоків — «технічний кресленик у зошиті» (затверджений концепт).
Зараз усе малюється процедурно (`BlocksView.drawBoard`, `blocksDoodles.ts`);
ці промти — щоб замінити кресленик артом. Кожен ассет — ОКРЕМИЙ файл на
прозорому фоні. Кладемо в `public/assets/mechanics/blocks/` і реєструємо в
його `manifest.json` (ключі з префіксом `blocks/`).

Після генерації прогнати обрізку/даунскейл (є тулза
`tools/art/prepare-blocks-tiles.mjs` як референс пайплайну — вона ж
зрізає «фейкову шахматку» ChatGPT-експорту).

## Спільний стиль-блок для КОЖНОГО промта поля

```
Style: a hand-drawn technical blueprint doodle, sketched with a fine blue
felt-tip pen in a school notebook. Ink color: cornflower blue (#5B86C6),
one single color only. Lines are thin (uniform width), slightly uneven and
wobbly like careful freehand drafting — NOT ruler-perfect, NOT calligraphic.
Flat 2D line art. IMPORTANT: fully transparent background (real alpha PNG,
no checkerboard pattern, no paper texture, no white background), no shadows,
no gradients, no 3D, no color fills — outlines only.
```

## 1. Рамка поля — `blocks/board_frame` (nine-slice)

Розмір: 1024×1024 → у грі тягнеться nine-slice (кути ~64px). ВАЖЛИВО: без
внутрішньої сітки — лінії клітинок гра малює сама (розмір поля може змінитись).

```
[стиль-блок]
Draw ONLY an empty square frame, centered, taking ~90% of the canvas:
a technical drawing border made of TWO nested rectangles — a bolder outer
rectangle (line ~10px) and a thinner inner rectangle (line ~4px) offset
~12px inside it, with slightly rounded corners (radius ~16px). Along the
INSIDE of the top edge draw 7 short evenly spaced vertical tick marks
(~20px long) hanging down from the inner rectangle, like ruler marks.
The interior of the frame is completely EMPTY and transparent.
No text, no numbers, no grid inside, nothing else.
```

## 2. Розмірна лінійка верхня — `blocks/dim_top` (цифра 8)

Розмір: 1536×256 (широкий). У грі розтягується по ширині поля.

```
[стиль-блок]
Draw ONLY a horizontal dimension line from a technical drawing, spanning
~90% of the canvas width, vertically centered: a thin DASHED horizontal
line with a short solid vertical tick at each end and one small tick in
the middle. Right above the middle tick — a single handwritten digit "8"
(casual handwriting, like quickly written with the same pen, ~90px tall).
No other text, no arrows, no circles, nothing else.
```

## 3. Розмірна лінійка бічна — `blocks/dim_side` (цифра 8)

Розмір: 256×1536 (вертикальний). У грі розтягується по висоті поля.

```
[стиль-блок]
Draw ONLY a vertical dimension line from a technical drawing, spanning
~90% of the canvas height, horizontally centered: a thin DASHED vertical
line with a short solid horizontal tick at each end and one small tick in
the middle. To the right of the middle tick — a single handwritten digit
"8" written UPRIGHT (casual handwriting, ~90px tall). No other text, no
arrows, no circles, nothing else.
```

## 4. Кут 90° (низ-ліво) — `blocks/corner_angle`

Розмір: 512×512.

```
[стиль-блок]
Draw ONLY a right-angle annotation from a technical drawing, centered:
two thin perpendicular lines meeting at a corner point (one going straight
up ~200px, one going right ~200px), with a small quarter-circle arc
(radius ~90px) drawn between them inside the angle. To the lower-left of
the corner — a small handwritten label "90°" (casual handwriting, ~70px
tall). Nothing else.
```

## 5. Datum-кружок для верхніх кутів — `blocks/corner_datum`

Розмір: 512×512. Один ассет, у грі дзеркалиться для другого кута.

```
[стиль-блок]
Draw ONLY a small datum target symbol from a technical drawing, centered:
a thin circle (~140px diameter) with a short dash-dot center line passing
through it horizontally and another one vertically (classic center-mark
crosshair, the lines extend ~80px beyond the circle on each side).
No text, nothing else.
```

## 6. Символ прямого кута (низ-право) — `blocks/corner_square`

Розмір: 512×512.

```
[стиль-блок]
Draw ONLY a small right-angle corner symbol from a technical drawing,
centered: two thin perpendicular lines meeting at a corner (one going up
~160px, one going right ~160px), with a tiny square mark (~50px) drawn
inside the corner where they meet. No text, no arc, nothing else.
```

## Мапа файлів поля блоків

| Ассет | Файл | Розмір @2x | Nine-slice |
|---|---|---|---|
| Рамка поля | `board_frame.png` | 1024×1024 | так, ~64px |
| Лінійка верхня «8» | `dim_top.png` | 1536×256 | ні (stretch по X) |
| Лінійка бічна «8» | `dim_side.png` | 256×1536 | ні (stretch по Y) |
| Кут 90° | `corner_angle.png` | 512×512 → ~128 у грі | ні |
| Datum-кружок | `corner_datum.png` | 512×512 → ~64 у грі | ні |
| Прямий кут | `corner_square.png` | 512×512 → ~72 у грі | ні |

Нюанс із запеченою цифрою «8»: правило гайду — «без тексту в ассетах», але
для розмірних ліній цифру запечено свідомо (рішення розробника). Якщо
колись з'явиться поле іншого розміру — або нові варіанти ассета, або
повертаємось до процедурної цифри поверх лінійки без напису.
