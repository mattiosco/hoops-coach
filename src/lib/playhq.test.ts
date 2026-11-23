import { describe, expect, it } from 'vitest'
import { mergePlayhq, parsePlayhq } from './playhq'
import type { Fixture } from '../domain/types'

/**
 * Laid out exactly as a "Select All, Copy" of a PlayHQ team fixture page comes through,
 * with made-up clubs. Two grades share round numbers, as they do on the real thing.
 */
const PAGE = `Hoop Dreams Basketball Club
BASKETBALL VICTORIA
Fixtures & Ladders
Register
Shop
News
Hoop Dreams U12 Girls GOLD
Northside Basketball Association, Junior Domestic, Summer 2026/27
Fixture
Ladder
U12 GIRLS GRADING
VIEW GRADE
Round 1
Saturday, 10 October 2026
Hoop Dreams U12 Girls GOLD
12
FINAL
Northside Hawks
8
Hoop Dreams U12 Girls GOLD won by 4 Points
09:15 AM, Sat, 10 Oct 26
Northside Stadium / Court 2
U12 GIRLS DIVISION 2
VIEW GRADE
Round 1
Saturday, 21 November 2026
Riverbank Rockets
Forfeit
0
FINAL
Hoop Dreams U12 Girls GOLD
20
Hoop Dreams U12 Girls GOLD won by forfeit
08:30 AM, Sat, 21 Nov 26
Riverbank College / Court 1
U12 GIRLS DIVISION 2
VIEW GRADE
Sync to Calendar
Round 2
Saturday, 28 November 2026
Hoop Dreams U12 Girls GOLD
-
UPCOMING
Eastwood Eagles
-
09:15 AM, Sat, 28 Nov 26
Northside Stadium / Court 1
U12 GIRLS DIVISION 2
VIEW GRADE
Round 3
Saturday, 05 December 2026
Westgate Wildcats
-
UPCOMING
Hoop Dreams U12 Girls GOLD
-
01:30 PM, Sat, 05 Dec 26
Westgate Leisure Centre / Court 4
U12 GIRLS DIVISION 2
VIEW GRADE
Round 4
Fixture has not yet been confirmed, dates and rounds are subject to change.
Round 5
Fixture has not yet been confirmed, dates and rounds are subject to change.
Hoop Dreams Basketball Club
PO BOX 1, Somewhere, VIC 3000, Australia`

/** The Monday before round 2, as the coach would be pasting it. */
const NOW = new Date(2026, 10, 23, 19, 0).getTime()

describe('parsePlayhq', () => {
  const result = parsePlayhq(PAGE, NOW)

  it('works out which team the page is about', () => {
    expect(result.team).toBe('Hoop Dreams U12 Girls GOLD')
  })

  it('imports only games still to come', () => {
    expect(result.games.map((g) => g.opponent)).toEqual(['Eastwood Eagles', 'Westgate Wildcats'])
    // The grading game and the forfeit win have both been played.
    expect(result.skippedPast).toBe(2)
  })

  it('reads tip-off, court, home or away and round', () => {
    const [r2, r3] = result.games
    expect(new Date(r2.startTime).getTime()).toBe(new Date(2026, 10, 28, 9, 15).getTime())
    expect(r2.homeAway).toBe('home')
    expect(r2.venue).toBe('Northside Stadium — Court 1')
    expect(r2.round).toBe('Round 2 · U12 Girls Division 2')

    // Afternoon times, and our team listed second means away.
    expect(new Date(r3.startTime).getHours()).toBe(13)
    expect(r3.homeAway).toBe('away')
  })

  it('keys games by grade and round, so a re-paste updates rather than duplicates', () => {
    expect(result.games[0].id).toBe('playhq:u12-girls-division-2:round-2')
  })

  it('skips a game whose tip-off has passed even if not yet marked final', () => {
    const later = new Date(2026, 10, 28, 10, 0).getTime()
    expect(parsePlayhq(PAGE, later).games.map((g) => g.opponent)).toEqual(['Westgate Wildcats'])
  })

  it('copes with extra blank lines and spacing from a phone copy', () => {
    const messy = PAGE.split('\n').join('\n\n  ')
    expect(parsePlayhq(messy, NOW).games).toHaveLength(2)
  })

  it('finds nothing in text that is not a PlayHQ fixture', () => {
    const none = parsePlayhq('Just some notes\nabout the game', NOW)
    expect(none.games).toHaveLength(0)
    expect(none.skippedPast).toBe(0)
  })
})

describe('mergePlayhq', () => {
  it('adds new games, updates moved ones and keeps hand-entered ones', () => {
    const { games } = parsePlayhq(PAGE, NOW)
    const manual: Fixture = {
      id: 'manual-1',
      round: 'Friendly',
      startTime: new Date(2026, 11, 1).toISOString(),
      opponent: 'Practice',
      homeAway: 'home',
      venue: '',
    }
    const first = mergePlayhq([manual], games)
    expect(first.added).toBe(2)
    expect(first.fixtures).toHaveLength(3)

    // Round 3 moves courts; pasting again updates it in place.
    const moved = games.map((g) =>
      g.opponent === 'Westgate Wildcats' ? { ...g, venue: 'Westgate Leisure Centre — Court 1' } : g,
    )
    const second = mergePlayhq(first.fixtures, moved)
    expect(second.added).toBe(0)
    expect(second.updated).toBe(1)
    expect(second.fixtures).toHaveLength(3)
    expect(second.fixtures.find((f) => f.id === 'manual-1')).toEqual(manual)
  })
})
