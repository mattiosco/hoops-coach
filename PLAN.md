# Hoops Coach — Plan

A phone-first PWA for managing game time, positions and rolling subs for a junior
basketball team. Fully offline, no backend, no accounts.

## Core idea

Same as the soccer app: an **append-only event log plus a fold**. Every action during a
game (start clock, pause, sub, swap positions, end a period, a late arrival) is an event,
and all displayed state — who's on, minutes played, fairness deltas — is derived by
folding that log. Undo, correction, the post-game summary and crash recovery all fall out
of that for free.

The clock is stored as `{ accumulatedMs, runningSince }` and always recomputed from
`Date.now()`, never accumulated in an interval.

## Domain

```
Player      { id, name, preferred?: Guard | Forward | Centre }
MatchConfig { periods: 2 | 4, periodMinutes, totalMinutes, shiftMinutes }
Slot        { id, label, role, x, y }   // PG SG SF PF C at 5 on 5
```

`totalMinutes` is `periods × periodMinutes` plus any extra time added at the end.
Period boundaries are `k × periodMinutes`; the last period runs to `totalMinutes`.

## Fairness

```
target = (gameMinutes × playersOnCourt) / availablePlayers
```

With 10 players, 5 on court and 2 × 20 min: **20 min each**. Each player shows a `+/-`
against that, prorated for late arrivals, and carried across two games on the same day.
Time lent to the other team counts as time played.

## Decided

- Defaults: 5 on court, 2 × 20 min halves, sub prompt every 5 min. All configurable.
- Fixtures are entered by hand from PlayHQ.
- Minutes and positions only for now.

## Later

- **Fouls.** Personal fouls per player (warning at 4, out at 5), feeding into sub
  suggestions. A new event type folded by the same reducer — additive, not a rewrite.
- PlayHQ fixture import, if a usable feed turns up.
