# Stint — Specification

A study stopwatch for one person on one phone. Start it when you sit down, stop it
when you get up. It shows how many hours you have put in today, this week, this
month, and whether you are ahead of where you were at this exact point last week.

The name is used in exactly three places (`package.json`, `capacitor.config.ts`,
`index.html`). Change it there if you want a different one.

---

## 1. What it is, precisely

**One screen matters.** The phone sits on the desk in landscape, showing a
split-flap clock counting today's study time in hours and minutes. Everything else
in the app is a place you visit occasionally.

**One interaction matters.** Start. Stop. No pause — a break *is* the end of a
session. Friction at the start button is the failure mode that kills apps like
this, so there is none.

**Tags do not gate the start.** A session is tagged, but the tag is never
something you wait on. Tapping `Start` begins the session *immediately*; the
tag row appears over the already-running clock, and picking is optional. Walk
away without choosing and the session is `Unset`, which is a real tag you can
fix later in History. The clock must never sit at 0:00 waiting for a decision.

**Non-goals for v1.** No accounts, no cloud sync, no notifications, no pomodoro,
no home-screen widget, no goals beyond a single daily target.

---

## 2. Platform and stack

Target is a Pixel 7a only. Landscape logical viewport is roughly **914 × 411 dp**
at density 2.625, 90 Hz OLED. Design to that, do not build a responsive grid for
devices that will never run this.

```
Vite + React 18 + TypeScript (strict)
Tailwind CSS          — layout and spacing only; colors come from CSS custom properties
Zustand               — runtime timer state
Dexie (IndexedDB)     — session persistence
Capacitor 6           — APK, wake lock, orientation lock
```

Capacitor plugins: `@capacitor/screen-orientation`, `@capacitor-community/keep-awake`,
`@capacitor/haptics`, `@capacitor/app` (for the resume hook in §6).

Ship as a debug APK over USB. No Play Store, no signing ceremony, no CI.

---

## 3. Data model

One table. Every number in the app is a query over it.

```ts
interface Session {
  id: string;            // crypto.randomUUID()
  startedAt: number;     // epoch ms, local clock
  endedAt: number | null;// null means running; at most one such row exists
  dayKey: string;        // "2026-09-16" — local calendar date of startedAt
  splitFrom?: string;    // id of the session this one continues, if split at midnight
  tag?: string;          // "work" | "study" | user-defined; absent means Unset
}
```

```ts
db.version(1).stores({
  sessions: 'id, dayKey, startedAt, endedAt, tag'
});
```

**No derived storage.** There is no `dailyTotals` table, no cached week sum, no
`durationMs` column. Totals are computed from rows on every read. The moment you
cache a total you acquire the job of invalidating it when a session is edited,
and sessions *will* be edited (§6).

**`dayKey` is denormalised deliberately** and is the one exception to the rule
above. It is a pure function of `startedAt` and the local timezone, it never
changes after write, and it turns every rollup into an indexed range scan instead
of a table walk. Compute it once at insert.

### Sessions never cross midnight

When local midnight passes during a running session, close it at `23:59:59.999`
and immediately open a new one at `00:00:00.000` with `splitFrom` pointing at the
closed row.

This is the single most load-bearing decision in the schema. Because a session
cannot cross a day boundary, it cannot cross a week, month, or year boundary
either — so every aggregation is `sum(endedAt - startedAt)` over rows whose
`startedAt` falls in a range. No clipping, no partial-overlap arithmetic, no
off-by-one at period edges. The cost is one timer and one repair pass; the
saving is correctness in six different query paths.

The running session is added to every total as a live term:
`now - activeSession.startedAt`, clamped to the query window.

---

## 4. The flip clock

This is the whole app visually. Budget most of your build time here and do not
accept the first version that works.

### What it displays

The big clock shows **today's total, including the running session**, as `HH:MM`.
Not the current session. When you come back from a ten-minute break the number
continues from 3:47 rather than resetting to 0:00, which is both more useful and
more motivating. This is also why hours-and-minutes is the right granularity —
a day total behaves like an odometer, and odometers do not need seconds.

The current session length appears as a small secondary readout below. Tapping
the big clock swaps the two for five seconds, then swaps back.

Seconds are represented as a **hairline progress rule** along the bottom of the
clock, filling left to right across each minute. It moves continuously, so the
display is never frozen, but nothing flips 60 times a minute.

### Structure per digit

Four stacked layers inside a container with `perspective: 1200px`:

| Layer | Content | Transform |
|---|---|---|
| `upper-static` | **new** digit, top half | none — revealed as the flap falls |
| `lower-static` | **old** digit, bottom half | none — covered by the landing flap |
| `flap-front` | **old** digit, top half | `rotateX(0 → -90deg)`, origin bottom |
| `flap-back` | **new** digit, bottom half | `rotateX(90deg → 0)`, origin top |

`transform-style: preserve-3d` on the container, `backface-visibility: hidden`
on both flaps.

### Timing

```
total            600ms
flap-front       0ms   → 300ms   cubic-bezier(0.36, 0, 0.66, -0.15)
flap-back        300ms → 600ms   cubic-bezier(0.20, 1.10, 0.40, 1.00)
```

The front curve has a slight negative overshoot at the start — a fraction of
backward lean before the fall, the way a real flap unseats. The back curve
overshoots past 1.0 so the flap lands with a small bounce against its stop.
Linear easing on either half is the difference between a flip clock and a
PowerPoint transition.

### The detail that sells it

Each flap carries a black overlay whose opacity is animated in lockstep with the
rotation:

- `flap-front`: overlay `0 → 0.42` as it rotates away from the light
- `flap-back`: overlay `0.55 → 0` as it rotates into the light

Without this the flaps read as flat paper sliding around. With it they read as
solid cards turning in space. Most implementations skip it. Do not skip it.

Additionally, a 1px `seam` line sits across the exact midpoint of every digit,
and a soft `inset 0 -8px 12px rgba(0,0,0,0.45)` on the upper half gives the
flap thickness.

### Render discipline

Only digits whose value changed may animate. Minutes-ones flips every minute,
minutes-tens every ten, hours-ones hourly. Each `FlipDigit` is `React.memo`'d on
its own value and mounts its animation from a `useEffect` keyed to that value.
Re-rendering all four digits every tick is the bug that makes this feel cheap on
a 90 Hz panel.

Animate `transform` and `opacity` only. No `width`, `top`, or `box-shadow`
transitions on the flaps.

### Reduced motion

`prefers-reduced-motion: reduce` replaces the fold with a 150 ms crossfade
between digit faces. The layout does not change.

---

## 5. Comparison — the part worth getting right

"Am I ahead of last week?" cannot be answered by comparing this week's total to
last week's total. On Wednesday morning, this week has 11 hours and last week has
26, and the app would tell you that you are 15 hours behind every single week.

Compare **the same point in each period**.

```ts
function weekPace(now: number) {
  const weekStart = startOfISOWeek(now);        // Monday 00:00 local
  const offset    = now - weekStart;
  const prevStart = weekStart - 7 * DAY;

  const current  = totalBetween(weekStart, now);
  const previous = totalBetween(prevStart, prevStart + offset);

  return { current, previous, delta: current - previous };
}
```

Month is the same idea with one edge case — the previous month may be shorter,
so the window must be clamped:

```ts
function monthPace(now: number) {
  const monthStart = startOfMonth(now);
  const offset     = now - monthStart;
  const prevStart  = startOfMonth(subMonths(now, 1));
  const prevEnd    = Math.min(prevStart + offset, monthStart);   // clamp

  return {
    current:  totalBetween(monthStart, now),
    previous: totalBetween(prevStart, prevEnd),
    delta:    totalBetween(monthStart, now) - totalBetween(prevStart, prevEnd),
  };
}
```

Without the clamp, March 30th compared against February reaches into March and
double-counts. This is the test case to write first.

Weeks start **Monday**. Use ISO weeks throughout so the year boundary behaves.

### How it reads

A single line above the bar chart, in plain language:

> 2h 40m ahead of last week
> 1h 10m behind last month

Not a percentage, not an arrow glyph, not a badge. When the delta is under
5 minutes it says `level with last week` and stays neutral in color.

### The second comparison

One period back answers "am I keeping up." Two periods back answers "is this a
slump or is this just me," which is the more useful question after a bad week.

So `weekPace` and `monthPace` both return an array of comparisons, not one:

```ts
interface Comparison {
  label:    string;   // "last week", "the week of 8 Sep"
  previous: number;
  delta:    number;
}

function weekPace(now: number): { current: number; against: Comparison[] }
```

Two entries for now. The function shape means a third costs nothing later.

**The headline stays single.** The pace line above the chart reads one
comparison — the nearest period — because that is the glance. The second
comparison lives below the chart with the totals, where you are already
reading numbers rather than taking in a state. Two sentences stacked above a
chart is a dashboard, and this is not one.

---

## 6. The two things that will actually go wrong

### He forgets to stop it

This is not an edge case, it is a weekly occurrence. On app resume, if a session
has been running longer than **6 hours**, do not silently accept it. Show a sheet:

> This session has been running for 14h 22m since 9:40 PM yesterday.

with three actions: **Keep it**, **Trim to…** (a duration input, prefilled with a
sensible 2h), and **Discard**. Never auto-trim without asking — the one time he
really did study for seven hours straight, silently deleting it is unforgivable.

The History screen exists for the same reason: every session is editable and
deletable, with start and end times adjustable to the minute.

### The app dies across midnight

The midnight split (§3) runs on a timer while the app is foregrounded. If the
phone was off or the app was killed, that timer never fired.

So on every `appStateChange → active` and on cold start, run a **repair pass**:
find the running session; if its `dayKey` is not today, close it at the end of
its own day, then create one session per intervening full day, then a final
running session starting at today's `00:00:00.000`, all chained by `splitFrom`.
In practice this combines with the 6-hour check above and the whole mess lands in
the same review sheet.

Write both of these as unit tests before writing the UI for them.

---

## 7. Visual design

### The reference object

Not "dark mode." A **split-flap departure board** — a physical instrument in a
dim room, aged aluminium housing, printed cards, brass hardware, one sodium lamp
somewhere off to the side. That object is the source for every color below, and
it is why the palette is a desaturated green-slate rather than neutral black.

The screen will be lit for six hours a day, at night, next to someone's face.
Low luminance is a functional requirement, not a style.

### Palette

```css
:root {
  --base:        #0E1211;  /* the dark behind the board — green-charcoal, not black */
  --chassis:     #19201E;  /* the housing the flaps are mounted in */
  --flap-lower:  #232C29;  /* card face, in shadow */
  --flap-upper:  #2C3733;  /* card face, catching light */
  --seam:        #070A09;  /* hairline across each card's midpoint */
  --rule:        #29332F;  /* dividers, chart gridlines */

  --ink:         #EDE6D6;  /* digits — warm bone, the color of printed flap cards */
  --ink-dim:     #7A8580;  /* labels, inactive tabs */

  --brass:       #C9A227;  /* running state: the lamp is on */
  --brass-halo:  rgba(201, 162, 39, 0.10);

  --patina:      #7FA88C;  /* ahead of pace */
  --oxide:       #B5734A;  /* behind pace */
}
```

`--ink` is never `#FFFFFF`. Pure white at that size on OLED at 11 PM is painful.

Ahead/behind are patina and oxide, not green and red. He is tracking study hours,
not passing a compliance audit — the behind state should read as information, not
as a warning light.

### Typography

Two faces, clearly distinct roles:

- **IBM Plex Sans Condensed, 500** — the flip digits, and only the flip digits.
  Condensed because real flap cards are tall and narrow. `font-variant-numeric:
  tabular-nums`, `letter-spacing: -0.02em`. Cap height around **248 dp** on the
  landscape clock.
- **IBM Plex Sans, 400/500** — every label, button, and number in the stats
  screens. Sentence case. Never all-caps.

**IBM Plex Mono** appears in exactly one place: the start/end timestamp columns
in the History list, where column alignment is a real requirement. It is not the
app's "data font."

No tracked-out eyebrow labels above sections. No `A · B · C` meta strings. No
arrow glyphs appended to button text. Buttons say what happens: `Start`, `Stop`,
`Save changes`, `Delete session`.

### Layout — the timer screen (landscape)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│      ┌────┐┌────┐      ┌────┐┌────┐                          │
│      │ 0  ││ 4  │  ·   │ 2  ││ 7  │                          │
│      ├────┤├────┤      ├────┤├────┤        ●  Stop           │
│      │    ││    │      │    ││    │                          │
│      └────┘└────┘      └────┘└────┘                          │
│      ────────────────────────────────  (seconds hairline)    │
│      this session 1h 12m                                     │
│                                                              │
│                                          Today  Week  Month  │
└──────────────────────────────────────────────────────────────┘
```

Clock block is left-aligned and vertically centred, occupying roughly the left
two-thirds. The control sits right, thumb-reachable when the phone is held or
resting. Navigation is a quiet row bottom-right — dim until touched.

The colon between hours and minutes is a **static dot pair that does not blink**.
Blinking colons are a clock affectation; this is a stopwatch and the seconds rule
already carries liveness.

### The control

A stadium button, 120 × 56 dp. Stopped: `--chassis` fill, `--ink` label, 1px
`--rule` border. Running: the label reads `Stop`, and a 10 dp dot in `--brass`
sits to its left with a slow 3-second breathing opacity between 0.55 and 1.0.
That dot and the `--brass-halo` behind the clock are the *only* two places the
accent color appears on this screen.

Haptic `impact: medium` on start, `impact: light` on stop.

### The tag row

On `Start`, the session begins and a single row of tags fades in beneath the
control — `Work`, `Study`, and whatever else has been used before. No modal, no
scrim, nothing blocking. The clock is already counting behind it.

Tapping one assigns it and the row dismisses. Touching anything else, or ten
seconds of nothing, dismisses it too and the session stays `Unset`. Tapping the
current tag while running reopens the row; changing it re-tags the running
session and never restarts it.

This is the whole compromise. The picker is at the start, where it is useful and
where you remember what you sat down to do — but it is downstream of the timer,
so it can never cost you a minute or a session. If it ever starts to feel like a
question you have to answer, it has failed and it should go.

### Stats screen (portrait)

Segmented control: `Week · Month · Year`. Below it, the pace line from §5, then a
bar chart, then three plain totals.

Bars are `--flap-lower` fill with a 2 dp `--brass` cap on the current period's
bar. Square corners — these are measurements, not cards. Gridlines at every 2
hours in `--rule` at 40% opacity, labelled at the left edge in `--ink-dim`.

Weekly view: 7 bars, Mon–Sun. Monthly: one bar per day, no labels except the 1st
and the 15th. Yearly: 12 bars.

### Time of day

Below the period chart, 24 bars — one per hour, midnight to midnight — showing
where the studying actually falls. This is the chart that changes behaviour:
a week total tells you how much, this tells you when, and "nothing after 6 PM"
is something you can act on tonight.

Same visual language as the period bars. Labels at `00`, `06`, `12`, `18` only.
It aggregates across whatever period the segmented control has selected.

Sessions cannot cross midnight (§3) but they cross hours constantly, so this is
the one place in the app doing partial-overlap arithmetic. `byHourOfDay` clips
each session into the hour buckets it spans. Keep that clipping in one function
and test it against a session running 09:47 → 11:12, which must produce 13m,
60m, 12m.

### Tags

A tag breakdown under the totals: one row per tag, a horizontal bar sized by
share, the tag name, and the duration.

```
Work    ████████████████████████░░░░░░░  8h 45m
Study   ████░░░░░░░░░░░░░░░░░░░░░░░░░░░  1h 34m
Unset   ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    58m
```

Durations, not percentages — `8h 45m` is the number you can do something with,
`78%` is a number about the chart. Bars are `--flap-lower` on `--rule`. Not a
donut: the app's visual language is square-cornered measurement, and a pie
forces a legend to say what the shape already failed to.

Tag colors: none. Tags are rows of text with bars, distinguished by their names.
Introducing a per-tag palette means either inventing colors outside the token
list or reusing `--patina` and `--oxide`, which mean ahead and behind everywhere
else in the app.

### Weak statistics

Aggregates like "most focused hour" or "most focused weekday" are patterns, and
a pattern needs data. Below **five sessions** in the selected period, these say
so plainly rather than asserting a trend:

> Not enough sessions yet to see a pattern.

Announcing "most focused at 10:00" off a single 20-minute session is the kind of
confident nonsense that makes an app feel automated. The threshold is cheap; the
credibility is not.

### Motion elsewhere

None. The flip is the one piece of motion in this app. No fade-and-slide-up on
the stats cards, no hover transitions, no page-load choreography. Everything
outside the clock either appears or does not.

---

## 8. Screen-on behaviour

`KeepAwake.keepAwake()` on start, `allowSleep()` on stop. Also release it if the
app is backgrounded while running — a phone in a pocket does not need its screen
held on.

### Auto-dim

Two stages, both cleared instantly by any touch.

| After | Overlay | Over |
|---|---|---|
| 90 seconds | `--base` at 45% | 1.2 s |
| 10 minutes | `--base` at 85% | 4 s |

The first stage is about distraction: he is studying, not watching the clock,
and a phone at full brightness in peripheral vision for three hours costs
attention and battery.

The second stage is about the panel. Burn-in rate scales steeply with
luminance, so ten minutes untouched — which is most of a study session —
dropping the clock to a faint reading of itself does more for the screen than
any animation could. It stays legible from across a desk. It is not off.

### Burn-in

A static flip clock on an OLED for six hours a day for a year will leave a ghost.
Two mitigations, both invisible in use:

1. **Pixel shift.** Every 90 s, translate the entire clock container to a new
   offset within a **±12 dp** box, over a 2 s ease. The eye does not register it.

   ±4 dp was the first number here and it was too timid. The digits have a cap
   height around 248 dp, so a 4 dp excursion only ever softens the *edges* of a
   stroke — the interior of a thick stroke stays lit under the same pixels all
   session. The landscape layout has room to spare on a left-aligned clock, and
   at 2 s of easing ±12 dp is equally invisible.

2. The dark palette and the two-stage auto-dim above already keep average
   luminance low, which matters more than either of the above.

Do not skip this because it seems paranoid. It is the specific failure mode of
this specific app on this specific panel.

**No particle animation.** The obvious third mitigation — drifting particles to
exercise the dark pixels — is deliberately rejected. It needs a
`requestAnimationFrame` loop repainting for hours on a phone already holding its
screen awake, and it puts a second animated element on a screen whose entire
motion budget belongs to the flip. Widening the shift and dimming harder buys
more protection for no frames and no battery.

---

## 9. File layout

```
src/
  screens/
    TimerScreen.tsx        landscape-locked
    StatsScreen.tsx
    HistoryScreen.tsx
  components/
    flip/
      FlipClock.tsx        composes four FlipDigits + colon + seconds rule
      FlipDigit.tsx        the four-layer fold; memo'd on its own digit
      flip.css             keyframes and the overlay opacity curves
    stats/
      PeriodBars.tsx
      HourBars.tsx         24 bars, time of day
      TagBreakdown.tsx     rows with bars and durations, never a donut
      PaceLine.tsx
      TotalsRow.tsx
    ui/
      Button.tsx
      Segmented.tsx
      Sheet.tsx            used only by the long-session review
      TagRow.tsx           the non-blocking picker over a running clock
  store/
    sessionStore.ts        zustand: activeSession, start(), stop(), tick
  db/
    db.ts                  dexie schema
    sessions.ts            create / close / update / delete / retag
    rollups.ts             totalBetween, byDay, byWeek, byMonth, byHourOfDay, byTag
    repair.ts              midnight split + resume repair pass
  lib/
    time.ts                dayKey, startOfISOWeek, startOfMonth, formatHM
    pace.ts                weekPace, monthPace
    tags.ts                the tag list, and Unset
  theme/
    tokens.css
    fonts.css              latin woff2 only; see the note in the file
```

Orientation: `TimerScreen` calls `ScreenOrientation.lock({ orientation: 'landscape' })`
on mount and `unlock()` on unmount. The other two screens are portrait-natural.

---

## 10. Build order

Ship after phase 2. Everything after that is additive and touches no existing code.

**Phase 1 — it runs on the phone** *(~3h)*
Vite + TS + Tailwind scaffold, Capacitor added, debug APK installed on the 7a
over USB, tokens.css in place, a black screen with the word Stint on it. Getting
the toolchain to the device first means every later step is testable for real.

**Phase 2 — it is useful** *(~5h)*
Dexie schema, start/stop, `totalBetween`, the flip clock, keep-awake, landscape
lock. At the end of this phase the app does its actual job. Use it for a few days
before building anything else.

Tags are *stored* from phase 2 — the column is written, defaulting to `Unset` —
but the picker is phase 4. Recording them from the first session means the tag
breakdown has history to show on the day it ships, instead of starting empty.

**Phase 3 — it is honest** *(~4h)*
Midnight split, resume repair pass, the long-session review sheet, History screen
with edit and delete. Unit tests for the split and the repair.

**Phase 4 — it answers the question** *(~7h)*
Stats screen, rollups, `weekPace` / `monthPace` with two comparisons, period bar
charts, the time-of-day chart, the tag row on the timer screen and the tag
breakdown. Unit tests for the month clamp and for `byHourOfDay` clipping.

This phase roughly doubled when the tag and time-of-day work landed in it. If it
needs splitting, ship the period charts and pace first — the time-of-day chart
and tags are independent of them and of each other.

**Phase 5 — it is finished** *(~4h)*
Auto-dim, pixel shift, haptics, app icon, the flip animation pass where you sit
with it and fix the easing. Reserve real time for that last item; it is a loop of
looking and adjusting, not a task that can be specified away.

---

## 11. Done means

- Start, close the app, wait an hour, reopen — the total is correct to the second.
- Start at 11:50 PM, check at 12:10 AM — yesterday shows 10m, today shows 10m.
- Start, force-stop the app from Android settings, reopen — the session is
  recoverable through the review sheet, not lost and not silently inflated.
- On a Wednesday, the week comparison uses Monday-through-Wednesday of last week.
- On the 30th of a month following February, the month comparison does not
  reach into the current month.
- A session from 09:47 to 11:12 lands in the time-of-day chart as 13m, 60m, 12m
  and not as 85m in one bucket.
- Tapping `Start` and then walking away records a session. The tag row does not
  hold the clock at 0:00, and never has.
- The flip looks right at 90 Hz with the phone at arm's length on a desk.
