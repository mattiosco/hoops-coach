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
  /** How often to prompt for a rolling sub, in minutes (fractions allowed: 5.75 = 5:45). */
  shiftMinutes: number
  /**
   * Whether the interval follows the recommendation worked out from who is here. Off once
   * the coach sets one by hand. Missing on older games, which counts as on.
   */
  autoShift?: boolean
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
 * One line-up per players-on-court count, drawn in a 2-3 shape: two guards out at the top
 * of the key, and three "bigs" along the basket — a forward on each side and the centre in
 * the middle. That is the standard junior set-up, and the same shape as a 2-3 zone defence.
 *
 * Laid out on a half court with the basket at the top. Ids stay short (pg, sg…) because
 * stored games refer to them; only the labels are spelled out.
 */
export const FORMATIONS: Record<number, Slot[]> = {
  3: [
    slot('pg', 'Guard', 'Guard', 50, 76),
    slot('pf', 'Forward', 'Forward', 24, 32),
    slot('c', 'Centre', 'Centre', 76, 32),
  ],
  4: [
    slot('pg', 'Point Guard', 'Guard', 28, 74),
    slot('sg', 'Shooting Guard', 'Guard', 72, 74),
    slot('pf', 'Forward', 'Forward', 24, 34),
    slot('c', 'Centre', 'Centre', 76, 34),
  ],
  5: [
    slot('pg', 'Point Guard', 'Guard', 28, 76),
    slot('sg', 'Shooting Guard', 'Guard', 72, 76),
    slot('sf', 'Small Forward', 'Forward', 20, 40),
    slot('pf', 'Power Forward', 'Forward', 80, 40),
    slot('c', 'Centre', 'Centre', 50, 22),
  ],
}

export const MIN_ON_COURT = 3
export const MAX_ON_COURT = 5

export const FORMATION_NAMES: Record<number, string> = {
  3: '3 on 3',
  4: '4 on 4 · 2-2',
  5: '5 on 5 · 2-3',
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
