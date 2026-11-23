import { describe, expect, it } from 'vitest'
import {
  MINUTE,
  currentClock,
  fairShares,
  foldMatch,
  minutesPlayedMs,
  periodEndMs,
  undoLast,
  type DayContext,
  type MatchInit,
} from './engine'
import type { MatchEvent } from './events'
import { suggestSubs } from './suggest'
import { DEFAULT_SLOTS, withPeriods, type MatchConfig, type Player } from './types'

const roster: Player[] = [
  'Ava',
  'Bea',
  'Cal',
  'Dev',
  'Eli',
  'Fin',
  'Gus',
  'Hal',
  'Ivy',
  'Jo',
].map((name) => ({ id: name.toLowerCase(), name }))

const init: MatchInit = {
  slots: DEFAULT_SLOTS,
  availability: {},
}

/** Two halves of ten: a short game keeps the arithmetic easy to follow. */
const config: MatchConfig = { periods: 2, periodMinutes: 10, totalMinutes: 20, shiftMinutes: 5 }

/** Tip off with the first five. */
function lineup(clock = 0): MatchEvent {
  return {
    t: 'LINEUP',
    at: 1000,
    clock,
    slots: DEFAULT_SLOTS,
    assignments: { pg: 'ava', sg: 'bea', sf: 'cal', pf: 'dev', c: 'eli' },
  }
}

const mins = (ms: number) => Math.round((ms / MINUTE) * 100) / 100

describe('stint accounting', () => {
  it('credits time between coming on and going off', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 1000, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'sg', off: 'bea', on: 'fin' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)

    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(5)
    expect(mins(minutesPlayedMs(state, 'fin', 20 * MINUTE))).toBe(15)
    expect(mins(minutesPlayedMs(state, 'ava', 20 * MINUTE))).toBe(20)
    expect(mins(minutesPlayedMs(state, 'jo', 20 * MINUTE))).toBe(0)
  })

  it('does not accrue time while the clock is paused', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'CLOCK_PAUSE', at: 60_000, clock: 5 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)

    expect(currentClock(state, 60_000 + 10 * MINUTE)).toBe(5 * MINUTE)
    expect(mins(minutesPlayedMs(state, 'bea', currentClock(state, Date.now())))).toBe(5)
  })

  it('keeps both stints when a player comes on, off, then on again', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 4 * MINUTE, slotId: 'sg', off: 'bea', on: 'fin' },
      { t: 'SUB', at: 0, clock: 10 * MINUTE, slotId: 'sg', off: 'fin', on: 'bea' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(14)
    expect(mins(minutesPlayedMs(state, 'fin', 20 * MINUTE))).toBe(6)
  })

  it('treats a positional swap as continuous time for both players', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SWAP', at: 0, clock: 8 * MINUTE, slotA: 'pf', slotB: 'c' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(mins(minutesPlayedMs(state, 'dev', 20 * MINUTE))).toBe(20)
    expect(mins(minutesPlayedMs(state, 'eli', 20 * MINUTE))).toBe(20)
    expect(state.onField.pf).toBe('eli')
    expect(state.onField.c).toBe('dev')
  })
})

describe('fair shares', () => {
  it('shares the court minutes evenly when everyone is available', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const shares = fairShares(roster, state, config, 0)
    const byId = new Map(shares.map((s) => [s.playerId, s]))

    // 20 min x 5 on court = 100 court-minutes over 10 players.
    expect(mins(byId.get('bea')!.targetMs)).toBeCloseTo(10, 1)
    expect(mins(shares.reduce((sum, s) => sum + s.targetMs, 0))).toBeCloseTo(100, 1)
  })

  it('shows who is owed time as a negative delta', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 10 * MINUTE, slotId: 'sg', off: 'bea', on: 'jo' },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(
      fairShares(roster, state, config, 15 * MINUTE).map((s) => [s.playerId, s]),
    )

    expect(byId.get('ava')!.deltaMs).toBeGreaterThan(0)
    expect(byId.get('hal')!.deltaMs).toBeLessThan(0)
    expect(mins(byId.get('hal')!.deltaMs)).toBeCloseTo(-10, 1)
  })

  it('counts time lent to the other team as a full run', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 10 * MINUTE, playerId: 'jo', status: 'loaned' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(
      fairShares(roster, state, config, 20 * MINUTE).map((s) => [s.playerId, s]),
    )
    const jo = byId.get('jo')!
    const staying = byId.get('gus')!

    expect(mins(jo.playedMs)).toBe(10)
    // A full share rather than a prorated one: they were there all game.
    expect(jo.targetMs).toBeCloseTo(staying.targetMs, 5)
    expect(jo.deltaMs).toBeGreaterThan(staying.deltaMs)
  })

  it('pulls a loaned player off the court automatically', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 6 * MINUTE, playerId: 'cal', status: 'loaned' },
    ]
    const state = foldMatch(roster, init, events)
    expect(state.onField.sf).toBeNull()
    // Six minutes for us, then nine for them: still fifteen minutes of basketball.
    expect(mins(minutesPlayedMs(state, 'cal', 15 * MINUTE))).toBe(15)
  })

  it('gives a late arrival a share of only the time they are there for', () => {
    const lateInit: MatchInit = { slots: DEFAULT_SLOTS, availability: { jo: 'absent' } }
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 10 * MINUTE, playerId: 'jo', status: 'available' },
    ]
    const state = foldMatch(roster, lateInit, events)
    const byId = new Map(
      fairShares(roster, state, config, 10 * MINUTE).map((s) => [s.playerId, s]),
    )
    const jo = byId.get('jo')!
    const allGame = byId.get('gus')!

    expect(jo.targetMs / allGame.targetMs).toBeCloseTo(0.5, 1)
    expect(jo.available).toBe(true)
  })

  it('stops the clock for a player who has gone home', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'AVAILABILITY', at: 0, clock: 6 * MINUTE, playerId: 'cal', status: 'absent' },
    ]
    const state = foldMatch(roster, init, events)
    const byId = new Map(
      fairShares(roster, state, config, 15 * MINUTE).map((s) => [s.playerId, s]),
    )
    expect(mins(minutesPlayedMs(state, 'cal', 15 * MINUTE))).toBe(6)
    expect(byId.get('cal')!.targetMs).toBeLessThan(byId.get('gus')!.targetMs)
  })

  it('raises everyone’s target when another spot opens on court', () => {
    const base = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const before = fairShares(roster, base, config, 0).find((s) => s.playerId === 'bea')!

    const state = foldMatch(roster, init, [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SLOT_ADD', at: 0, clock: 0, slot: { id: 'extra', label: 'Extra' }, playerId: 'fin' },
    ])
    const after = fairShares(roster, state, config, 0).find((s) => s.playerId === 'bea')!

    // Six on court instead of five: 20 x 6 = 120 over 10 players.
    expect(after.targetMs).toBeGreaterThan(before.targetMs)
    expect(mins(after.targetMs)).toBeCloseTo(12, 1)
  })
})

describe('game day', () => {
  it('carries minutes from the first game into the second', () => {
    const state = foldMatch(roster, init, [lineup(), { t: 'CLOCK_START', at: 0, clock: 0 }])
    const day: DayContext = {
      priorPlayedMs: { bea: 14 * MINUTE, jo: 2 * MINUTE },
      daySupplyMs: 200 * MINUTE, // two games of 100
      starts: { bea: 1 },
    }
    const byId = new Map(fairShares(roster, state, config, 0, day).map((s) => [s.playerId, s]))

    // Everyone is chasing 20 across the day...
    expect(mins(byId.get('bea')!.targetMs)).toBeCloseTo(20, 1)
    // ...but this game only owes them the remainder of it.
    expect(mins(byId.get('bea')!.gameTargetMs)).toBeCloseTo(6, 1)
    expect(mins(byId.get('jo')!.gameTargetMs)).toBeCloseTo(18, 1)
    expect(mins(byId.get('hal')!.gameTargetMs)).toBeCloseTo(20, 1)
    expect(byId.get('jo')!.deltaMs).toBeLessThan(byId.get('bea')!.deltaMs)
  })
})

describe('preferred positions', () => {
  it('steers an incoming player toward a spot they like', () => {
    const picky: Player[] = roster.map((p) =>
      p.id === 'jo' ? { ...p, preferred: ['Centre' as const] } : p,
    )
    // Only Fin and Jo on the bench, so both certainly come on. Fin is first in owed
    // order and has no preference; without preference-first matching Fin would take the
    // centre spot Jo actually wants.
    // Bigs listed first, so the first two off are the centre and power forward.
    const slots = [...DEFAULT_SLOTS].reverse()
    const pickyInit: MatchInit = {
      slots,
      availability: { gus: 'absent', hal: 'absent', ivy: 'absent' },
    }
    const state = foldMatch(picky, pickyInit, [
      { ...lineup(), slots } as MatchEvent,
      { t: 'CLOCK_START', at: 0, clock: 0 },
    ])
    const clock = 10 * MINUTE
    const shares = fairShares(picky, state, config, clock)
    const proposals = suggestSubs(picky, state, shares, clock)

    const jos = proposals.find((p) => p.on === 'jo')
    expect(jos).toBeDefined()
    expect(jos!.slotId).toBe('c')
  })
})

describe('periods', () => {
  it('ends each half on the period boundary and the last at full time', () => {
    expect(periodEndMs(config, 1)).toBe(10 * MINUTE)
    expect(periodEndMs(config, 2)).toBe(20 * MINUTE)

    const quarters = withPeriods(config, 4, 8)
    expect(quarters.totalMinutes).toBe(32)
    expect(periodEndMs(quarters, 3)).toBe(24 * MINUTE)
    expect(periodEndMs(quarters, 4)).toBe(32 * MINUTE)

    // Overtime lands on the last period only.
    const overtime = { ...quarters, totalMinutes: 35 }
    expect(periodEndMs(overtime, 3)).toBe(24 * MINUTE)
    expect(periodEndMs(overtime, 4)).toBe(35 * MINUTE)
  })

  it('counts a period break as a pause, not as playing time', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'PERIOD_END', at: 0, clock: 10 * MINUTE },
      { t: 'CLOCK_START', at: 5 * MINUTE, clock: 10 * MINUTE },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(state.period).toBe(2)
    expect(mins(minutesPlayedMs(state, 'bea', 20 * MINUTE))).toBe(20)
  })

  it('caps the clock when the buzzer pause is stamped at the period end', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      // Nobody stopped the clock; the app ends the half itself, stamping exactly the
      // boundary even though it noticed late.
      { t: 'PERIOD_END', at: 15 * MINUTE, clock: 10 * MINUTE },
    ]
    const state = foldMatch(roster, init, events)
    expect(currentClock(state, 40 * MINUTE)).toBe(10 * MINUTE)
    expect(mins(minutesPlayedMs(state, 'bea', currentClock(state, 40 * MINUTE)))).toBe(10)
  })
})

describe('undo', () => {
  it('removes the last event and its effect', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'sg', off: 'bea', on: 'fin' },
    ]
    const { events: after, state } = undoLast(roster, init, events, Date.now())

    expect(after).toHaveLength(2)
    expect(state.onField.sg).toBe('bea')
    expect(minutesPlayedMs(state, 'fin', 5 * MINUTE)).toBe(0)
  })

  it('does not jump the clock forward when a pause is undone', () => {
    const pausedAt = 100_000
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'CLOCK_PAUSE', at: pausedAt, clock: 5 * MINUTE },
    ]
    const now = pausedAt + 2 * MINUTE
    const { state } = undoLast(roster, init, events, now)

    expect(state.runningSince).not.toBeNull()
    expect(mins(currentClock(state, now))).toBe(5)
  })
})

describe('replay', () => {
  it('is deterministic: folding twice gives the same state', () => {
    const events: MatchEvent[] = [
      lineup(),
      { t: 'CLOCK_START', at: 0, clock: 0 },
      { t: 'SUB', at: 0, clock: 5 * MINUTE, slotId: 'sg', off: 'bea', on: 'fin' },
      { t: 'PERIOD_END', at: 0, clock: 10 * MINUTE },
      { t: 'CLOCK_START', at: 0, clock: 10 * MINUTE },
      { t: 'SUB', at: 0, clock: 15 * MINUTE, slotId: 'sf', off: 'cal', on: 'gus' },
      { t: 'MATCH_END', at: 0, clock: 20 * MINUTE },
    ]
    expect(foldMatch(roster, init, events)).toEqual(foldMatch(roster, init, events))
  })
})
