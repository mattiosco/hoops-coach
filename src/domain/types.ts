export type PlayerId = string
export type SlotId = string
export type MatchId = string

/** Broad areas of the court a player can prefer. Kept coarse so it survives format changes. */
export type Role = 'Guard' | 'Forward' | 'Centre'
export const ROLES: Role[] = ['Guard', 'Forward', 'Centre']

export interface Player {
  id: PlayerId
  name: string
  /** Optional preferred areas. Used to order pickers and steer suggestions, never to force. */
  preferred?: Role[]
}

/** A position on the court. */
export interface Slot {
  id: SlotId
  label: string
  role?: Role
  /** Where the magnet sits on the court map, as a percentage of the box. */
  x?: number
  y?: number
}

export type Availability =
  | 'available' // on the court or on the bench
  | 'absent' // not at the stadium
  | 'loaned' // lent to the other team; still playing, just in their singlet

export interface MatchConfig {
  /** Number of periods: 2 halves or 4 quarters. */
  periods: number
  /** Running minutes in each period. */
  periodMinutes: number
  /**
   * Total running minutes, excluding breaks. Normally periods × periodMinutes; anything
   * beyond that is extra time added at the end (overtime, or a game that runs on).
   */
  totalMinutes: number
  /** How often to prompt for a rolling sub. */
  shiftMinutes: number
}

/** A game on the draw. Entered by hand — PlayHQ has no open API to sync from. */
export interface Fixture {
  id: string
  round: string
  /** ISO instant of tip-off. */
  startTime: string
  opponent: string
  homeAway: 'home' | 'away'
  venue: string
}

const slot = (id: SlotId, label: string, role: Role, x: number, y: number): Slot => ({
  id,
  label,
  role,
  x,
  y,
})

/**
 * One line-up per players-on-court count. Laid out on a half court with the basket at the
 * top, so the map reads the way the team attacks.
 */
export const FORMATIONS: Record<number, Slot[]> = {
  3: [
    slot('pg', 'Guard', 'Guard', 50, 80),
    slot('wing', 'Wing', 'Forward', 18, 46),
    slot('post', 'Post', 'Centre', 70, 26),
  ],
  4: [
    slot('pg', 'Point', 'Guard', 50, 82),
    slot('sg', 'Wing L', 'Guard', 16, 54),
    slot('sf', 'Wing R', 'Forward', 84, 54),
    slot('c', 'Post', 'Centre', 50, 28),
  ],
  5: [
    slot('pg', 'PG', 'Guard', 50, 84),
    slot('sg', 'SG', 'Guard', 15, 60),
    slot('sf', 'SF', 'Forward', 85, 60),
    slot('pf', 'PF', 'Forward', 24, 28),
    slot('c', 'C', 'Centre', 76, 28),
  ],
}

export const MIN_ON_COURT = 3
export const MAX_ON_COURT = 5

export const FORMATION_NAMES: Record<number, string> = {
  3: '3 on 3',
  4: '4 on 4',
  5: '5 on 5',
}

export function formationFor(count: number): Slot[] {
  return FORMATIONS[Math.min(MAX_ON_COURT, Math.max(MIN_ON_COURT, count))]
}

export const DEFAULT_SLOTS: Slot[] = FORMATIONS[5]

export const DEFAULT_CONFIG: MatchConfig = {
  periods: 2,
  periodMinutes: 20,
  totalMinutes: 40,
  shiftMinutes: 5,
}

/** A config with its total recomputed from the period settings. Drops any extra time. */
export function withPeriods(
  config: MatchConfig,
  periods: number,
  periodMinutes: number,
): MatchConfig {
  return { ...config, periods, periodMinutes, totalMinutes: periods * periodMinutes }
}

/** What a period is called: halves, quarters, or plain periods for anything else. */
export function periodName(periods: number): string {
  return periods === 2 ? 'Half' : periods === 4 ? 'Quarter' : 'Period'
}

/** Short form for tight spaces: "H1", "Q3", "P2". */
export function periodShort(periods: number, n: number): string {
  return `${periodName(periods)[0]}${n}`
}
