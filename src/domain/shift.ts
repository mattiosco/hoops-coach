/**
 * How often to sub, worked out from who is here.
 *
 * Time is perfectly even when the game splits into shifts that the squad can share
 * exactly: with S shifts and K players on court there are S × K places to fill, and if
 * that divides by the N players available, everyone plays the same number of shifts.
 *
 *   8 players, 5 on court, 40 min → 8 shifts of 5:00, everyone plays 25 min
 *  10 players, 5 on court, 40 min → 4 shifts of 10:00, everyone plays 20 min
 *   7 players, 5 on court, 40 min → 7 shifts of 5:43, everyone plays 28:34
 *
 * The fewest shifts that do this wins, so the game is not stopped more than it needs
 * to be, but each shift is kept between MIN and MAX: long enough to settle into the
 * game, short enough that nobody sits out for half of it.
 */

export const MIN_SHIFT_MINUTES = 3
export const MAX_SHIFT_MINUTES = 10

export interface ShiftPlan {
  /** Minutes between subs, rounded to the nearest 5 seconds. */
  shiftMinutes: number
  /** How many shifts the game splits into. */
  shifts: number
  /** Minutes each player gets if the rotation runs to plan. */
  minutesEach: number
  /** True when every player can get exactly the same time. */
  even: boolean
  /** Everyone fits on court at once, so there is nobody to sub. */
  noSubs: boolean
}

export function recommendShift({
  available,
  onCourt,
  totalMinutes,
  periodMinutes,
}: {
  available: number
  onCourt: number
  totalMinutes: number
  periodMinutes: number
}): ShiftPlan {
  if (available <= onCourt || onCourt <= 0 || totalMinutes <= 0) {
    return {
      shiftMinutes: Math.max(1, periodMinutes),
      shifts: Math.max(1, Math.round(totalMinutes / Math.max(1, periodMinutes))),
      minutesEach: totalMinutes,
      even: true,
      noSubs: true,
    }
  }

  const fewest = Math.max(1, Math.ceil(totalMinutes / MAX_SHIFT_MINUTES))
  const most = Math.max(fewest, Math.floor(totalMinutes / MIN_SHIFT_MINUTES))

  let shifts = -1
  for (let s = fewest; s <= most; s++) {
    if ((s * onCourt) % available === 0) {
      shifts = s
      break
    }
  }
  // A squad size that cannot be shared exactly within sensible shift lengths: take the
  // shortest allowed shift, which keeps the gap between players to a single short shift.
  const even = shifts > 0
  if (!even) shifts = most

  return {
    shiftMinutes: roundTo5s(totalMinutes / shifts),
    shifts,
    minutesEach: (totalMinutes * onCourt) / available,
    even,
    noSubs: false,
  }
}

function roundTo5s(minutes: number): number {
  return Math.round((minutes * 60) / 5) * 5 / 60
}

/** "5:00", "5:45" — minutes and seconds for a fractional number of minutes. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
