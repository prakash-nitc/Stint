# CLAUDE.md

Working instructions for this repo. Read `SPEC.md` for what the app is; this file
is about how to build it.

---

## Commands

```bash
npm run dev                 # browser, use Chrome device toolbar at 914×411
npm run build
npx cap sync android        # after any dependency or native config change
npx cap run android         # build + install on the connected 7a
npm run test                # vitest
npx tsc --noEmit            # must be clean before any commit
```

The phone must be in developer mode with USB debugging on. `adb devices` should
list one device before `cap run`.

---

## The rules that matter

### 1. Never accumulate elapsed time

```ts
// wrong — drifts, dies when backgrounded, loses everything on kill
setInterval(() => setElapsed(e => e + 1000), 1000);

// right — the clock is the source of truth, always
const elapsed = Date.now() - session.startedAt;
```

There is exactly one interval in this app. It lives in `sessionStore.ts`, fires
at 1000 ms, and its only job is to bump a `now` value so components re-render.
It never adds to a counter. If you find yourself writing `+=` on a duration,
stop.

### 2. Never store what can be computed

No `durationMs` column. No `dailyTotals` table. No cached week sum in Zustand.
Totals are derived from `sessions` rows on every read, because sessions are
editable and every cache is an invalidation bug waiting for the day he fixes a
forgotten stop.

`dayKey` is the one denormalised field and `SPEC.md §3` explains why. Do not add
a second exception without a comparable argument.

### 3. Never store formatted strings

The database holds epoch milliseconds. Formatting happens in `lib/time.ts` at
render. A `"3h 47m"` in IndexedDB is unsortable, unsummable, and locale-frozen.

### 4. Sessions cannot cross midnight

Every write path must maintain this. If you add a code path that creates or
edits a session, it needs a split check. The invariant is what makes every
aggregation a simple indexed range sum — breaking it quietly breaks six
different queries in ways that only show up at period boundaries.

### 5. Only changed digits animate

`FlipDigit` is `React.memo`'d on its own value. The 1 Hz tick in the store must
not cause all four digits to re-render. If the profiler shows four `FlipDigit`
renders per second, that is a bug, not a performance nicety.

---

## Code style

TypeScript strict. No `any`, no non-null `!` assertions — narrow properly or
return early.

Write it the way you would write it on a whiteboard in an interview: named
intermediate variables, early returns, one idea per line.

```ts
// no
const label = d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d}d ago` : fmt(date);

// yes
function relativeDayLabel(daysAgo: number, date: Date): string {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo < 7)   return `${daysAgo} days ago`;
  return formatDate(date);
}
```

Time arithmetic gets named constants — `const DAY = 86_400_000`, never a bare
`86400000` in an expression.

Comments explain *why*, and only where the why is not obvious from the code. Do
not narrate what the next line does. Do not leave section-divider comment banners.

Keep components under ~150 lines. If one grows past that, the extraction is
usually a hook, not a subcomponent.

---

## Design tokens — use these, do not invent

All color comes from `theme/tokens.css` via `var(--token)`. Tailwind handles
layout and spacing only. Never write a hex value in a component.

| Token | Value | Use |
|---|---|---|
| `--base` | `#0E1211` | screen background |
| `--chassis` | `#19201E` | the housing behind the flaps, button fill |
| `--flap-lower` | `#232C29` | card face in shadow, chart bars |
| `--flap-upper` | `#2C3733` | card face catching light |
| `--seam` | `#070A09` | hairline at each card's midpoint |
| `--rule` | `#29332F` | dividers, gridlines |
| `--ink` | `#EDE6D6` | digits and primary text |
| `--ink-dim` | `#7A8580` | labels, inactive states |
| `--brass` | `#C9A227` | running indicator only |
| `--brass-halo` | `rgba(201,162,39,0.10)` | glow behind a running clock |
| `--patina` | `#7FA88C` | ahead of pace |
| `--oxide` | `#B5734A` | behind pace |

Type: **IBM Plex Sans Condensed 500** for flip digits only. **IBM Plex Sans**
for everything else. **IBM Plex Mono** only in the History timestamp columns.

---

## Do not write these

These are the tells that make a UI look generated. The app is meant to look like
an instrument someone designed on purpose.

- Emoji anywhere in the interface, in code comments, or in commit messages
- All-caps tracked-out labels above sections
- `→` or any arrow glyph appended to button text
- Meta strings joined with middle dots — `Week · 14h · 6 sessions`
- Gradient fills on buttons, bars, or backgrounds
- `shadow-2xl`, `backdrop-blur`, or glassmorphism of any kind
- Everything given the same `rounded-xl`; radius should encode what a thing is
- Fade-and-slide-up entrance animations on cards and sections
- Hover transitions on a touch-only app
- Percentages where a duration is clearer — `2h 40m ahead`, not `+11%`
- Pure `#FFF` or pure `#000` anywhere
- Celebratory copy: no "Great job!", no "You're on fire", no streak confetti

The flip animation is the only motion in the app. Adding a second animated
element dilutes it.

---

## Copy

Sentence case. Plain verbs. Buttons name the thing that happens, and the same
word is used everywhere in the flow — `Stop` produces a stopped session, not a
"paused" one.

Empty states point at the next action rather than describing emptiness:
`Start a session to see this week.` Not `No data available.`

The long-session sheet states the fact and offers choices without apologising or
scolding: `This session has been running for 14h 22m since 9:40 PM yesterday.`

---

## Tests

Vitest, and only where the logic is genuinely tricky. Do not write render tests
for buttons.

Required before the corresponding UI is built:

- `lib/pace.ts` — week comparison on a Wednesday uses Mon–Wed of last week
- `lib/pace.ts` — month comparison on the 30th following February clamps to
  the end of February and does not reach into the current month
- `db/repair.ts` — a session running from 11:50 PM to 12:10 AM splits into 10m
  yesterday and 10m today
- `db/repair.ts` — a session running across three whole days produces four rows,
  correctly chained, with the last one still running
- `db/rollups.ts` — a running session contributes its live elapsed time to today,
  this week, and this month, clamped to each window

---

## Working agreement

Before implementing anything that is not spelled out in `SPEC.md`, say what you
are about to assume and wait. The spec is opinionated on purpose; silent
improvisation on the parts it does cover is worse than asking.

Do one phase from `SPEC.md §10` at a time. At the end of a phase, stop and let it
get installed on the phone before starting the next. This app is going to be used
every day by the person who is reading the diff, so the feedback loop is worth
more than momentum.

When something in the spec turns out to be wrong once it is on the device — and
the flip animation easing probably will — change `SPEC.md` in the same commit.
A spec that drifts from the code is worse than no spec.
