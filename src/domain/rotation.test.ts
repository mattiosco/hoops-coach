import { describe, expect, it } from 'vitest'
import { MINUTE, fairShares, foldMatch, minutesPlayedMs, type MatchInit } from './engine'
import type { MatchEvent } from './events'
import { recommendShift } from './shift'
import { suggestSubs } from './suggest'
import { DEFAULT_SLOTS, withPeriods, DEFAULT_CONFIG, type Player } from './types'

/**
 * Play a whole game on paper: take the recommended interval, accept every suggested sub
 * at every buzzer, and see how even the minutes come out. This is the promise the
 * recommendation makes, so it is checked end to end rather than trusted.
 */
function simulate(available: number) {
  const roster: Player[] = Array.from({ length: available }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
  }))
  const config = withPeriods(DEFAULT_CONFIG, 2, 20)
  const plan = recommendShift({
    available,
    onCourt: DEFAULT_SLOTS.length,
    totalMinutes: config.totalMinutes,
    periodMinutes: config.periodMinutes,
  })
  config.shiftMinutes = plan.shiftMinutes

  const init: MatchInit = { slots: DEFAULT_SLOTS, availability: {} }
  const assignments = Object.fromEntries(DEFAULT_SLOTS.map((s, i) => [s.id, roster[i].id]))
  const events: MatchEvent[] = [
    { t: 'LINEUP', at: 0, clock: 0, slots: DEFAULT_SLOTS, assignments },
    { t: 'CLOCK_START', at: 0, clock: 0 },
  ]

  const total = config.totalMinutes * MINUTE
  const step = plan.shiftMinutes * MINUTE
  for (let clock = step; clock < total - 1000; clock += step) {
    const state = foldMatch(roster, init, events)
    const shares = fairShares(roster, state, config, clock)
    for (const sub of suggestSubs(roster, state, shares, clock)) {
      events.push({ t: 'SUB', at: 0, clock, slotId: sub.slotId, off: sub.off, on: sub.on })
    }
  }
  events.push({ t: 'MATCH_END', at: 0, clock: total })

  const state = foldMatch(roster, init, events)
  const minutes = roster.map((p) => minutesPlayedMs(state, p.id, total) / MINUTE)
  return { plan, spread: Math.max(...minutes) - Math.min(...minutes), minutes }
}

describe('recommended rotation, played out', () => {
  for (const available of [6, 7, 8, 9, 10, 11, 12]) {
    it(`gives ${available} players near-equal time`, () => {
      const { plan, spread } = simulate(available)
      // Within one shift of each other at worst, and exactly even where the plan says so.
      expect(spread).toBeLessThanOrEqual(plan.shiftMinutes + 0.01)
      if (plan.even) expect(spread).toBeLessThan(0.5)
    })
  }
})
