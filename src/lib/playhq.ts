import type { Fixture } from '../domain/types'

/**
 * Read games out of text copied from a team's fixture page on playhq.com.
 *
 * PlayHQ has no API a coach can use without a key from their association, but its team
 * page lays every game out the same way, so "Select All, Copy, Paste" is enough:
 *
 *   U10 BOYS DIVISION 3          ← grade (sits just before "VIEW GRADE")
 *   VIEW GRADE
 *   Round 3
 *   Saturday, 28 November 2026
 *   Hoop Dreams U10              ← first team listed is the home side
 *   -                            ← score, or "-" before the game
 *   UPCOMING                     ← or FINAL, and sometimes "Forfeit"
 *   Northside Hawks
 *   -
 *   09:15 AM, Sat, 28 Nov 26     ← tip-off: the anchor for each game
 *   Northside Stadium / Court 1
 *
 * Everything else on the page — menus, contact details, "not yet confirmed" rounds — is
 * ignored, because a game is only recognised by its tip-off line.
 *
 * Games already played are left out: anything marked FINAL, or whose tip-off has passed.
 * They are history, and setting one up as a game would only clutter the list.
 */

export interface ParsedGame {
  /** Stable across re-pastes: grade and round, so a rescheduled game updates in place. */
  id: string
  round: string
  startTime: string
  opponent: string
  homeAway: 'home' | 'away'
  venue: string
}

export interface ParseResult {
  team: string | null
  /** Games still to come. */
  games: ParsedGame[]
  /** Games found but left out because they have been played. */
  skippedPast: number
}

const TIP_OFF = /^(\d{1,2}):(\d{2})\s*(AM|PM),\s*\w{3},?\s+(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{2,4})$/i
// Not a bare "FINAL": on PlayHQ that word marks a finished game, not a finals round.
const ROUND =
  /^(round\s+\d+|semi[- ]?finals?|grand final|preliminary final|elimination final|qualifying final|finals? week\s+\d+)$/i
const DATE_LINE = /^(mon|tues|wednes|thurs|fri|satur|sun)day,?\s+\d{1,2}\s+\w+\s+\d{4}$/i
const NOISE = /^(-|–|\d+|final|upcoming|live|in progress|forfeit|bye|view grade|sync to calendar|fixture|ladder)$/i
const RESULT = /\b(won by|drawn?|draw|tied?|abandoned|cancell?ed|postponed)\b/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parsePlayhq(text: string, now: number = Date.now()): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  interface Raw {
    grade: string | null
    round: string
    start: Date
    teams: [string, string]
    venue: string
    played: boolean
  }
  const raw: Raw[] = []

  for (let i = 0; i < lines.length; i++) {
    const tip = TIP_OFF.exec(lines[i])
    if (!tip) continue

    // Walk back to the round heading that opens this game.
    let r = i - 1
    while (r >= 0 && !ROUND.test(lines[r]) && !TIP_OFF.test(lines[r])) r--
    if (r < 0 || !ROUND.test(lines[r])) continue

    const block = lines.slice(r + 1, i)
    const played = block.some((l) => /^(final|forfeit)$/i.test(l) || RESULT.test(l))
    const teams = block
      .filter((l) => !DATE_LINE.test(l) && !NOISE.test(l) && !RESULT.test(l))
    if (teams.length < 2) continue

    // The grade label is the line before "VIEW GRADE", a line or two above the round
    // heading ("Sync to Calendar" sometimes sits in between).
    let viewGrade: string | null = null
    for (let k = r - 1; k >= Math.max(1, r - 3); k--) {
      if (/^view grade$/i.test(lines[k])) {
        viewGrade = lines[k - 1]
        break
      }
    }

    const start = toDate(tip)
    if (!start) continue

    const venue = lines[i + 1] && !ROUND.test(lines[i + 1]) && !/^view grade$/i.test(lines[i + 1])
      ? lines[i + 1]
      : ''
    // A venue line is "Stadium / Court 2"; anything else after the tip-off is the next
    // block's grade, so leave the venue blank rather than mislabel it.
    raw.push({
      grade: viewGrade,
      round: titleCase(lines[r]),
      start,
      teams: [teams[0], teams[1]],
      played,
      venue: venue.includes('/') || /court/i.test(venue) ? venue.replace(/\s*\/\s*/, ' — ') : '',
    })
  }

  // Our team is whichever name turns up in the most games — the page is about them, so
  // they are in every one, while each opponent appears once or twice.
  const counts = new Map<string, number>()
  for (const g of raw) for (const t of g.teams) counts.set(t, (counts.get(t) ?? 0) + 1)
  // The page heading names the team too, which settles a single-game paste.
  for (const line of lines) if (counts.has(line)) counts.set(line, counts.get(line)! + 0.5)
  const team = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const upcoming = raw.filter((g) => !g.played && g.start.getTime() > now)
  const games = upcoming.map((g): ParsedGame => {
    const home = g.teams[0] === team
    const grade = g.grade ? titleCase(g.grade) : null
    return {
      id: `playhq:${slug(grade ?? 'grade')}:${slug(g.round)}`,
      round: grade ? `${g.round} · ${grade}` : g.round,
      startTime: g.start.toISOString(),
      opponent: home ? g.teams[1] : g.teams[0],
      homeAway: home ? 'home' : 'away',
      venue: g.venue,
    }
  })

  return { team, games: dedupe(games), skippedPast: raw.length - upcoming.length }
}

/** Two games keyed the same (no grade on the page) are told apart by date instead. */
function dedupe(games: ParsedGame[]): ParsedGame[] {
  const seen = new Map<string, number>()
  return games.map((g) => {
    const n = seen.get(g.id) ?? 0
    seen.set(g.id, n + 1)
    return n === 0 ? g : { ...g, id: `${g.id}:${g.startTime.slice(0, 10)}` }
  })
}

function toDate(m: RegExpExecArray): Date | null {
  const [, hh, mm, ampm, day, mon, yy] = m
  const month = MONTHS.indexOf(mon.toLowerCase().slice(0, 3))
  if (month < 0) return null
  let hour = Number(hh) % 12
  if (ampm.toUpperCase() === 'PM') hour += 12
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
  // Local time: the draw is published in the stadium's time, which is the coach's too.
  const d = new Date(year, month, Number(day), hour, Number(mm))
  return Number.isNaN(d.getTime()) ? null : d
}

function titleCase(s: string): string {
  // Grades come in shouting ("U10 BOYS DIVISION 3"); keep age codes like U10 as they are.
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bU(\d+)/gi, 'U$1')
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Fold pasted games into the fixtures already held. A game already imported is updated
 * in place — times and courts move — and anything added by hand is left alone.
 */
export function mergePlayhq(
  existing: Fixture[],
  games: ParsedGame[],
): { fixtures: Fixture[]; added: number; updated: number } {
  const byId = new Map(existing.map((f) => [f.id, f]))
  let added = 0
  let updated = 0
  for (const g of games) {
    const current = byId.get(g.id)
    if (current) {
      const changed =
        current.startTime !== g.startTime ||
        current.opponent !== g.opponent ||
        current.venue !== g.venue ||
        current.homeAway !== g.homeAway ||
        current.round !== g.round
      if (changed) updated++
    } else {
      added++
    }
    byId.set(g.id, { ...current, ...g })
  }
  const fixtures = [...byId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
  return { fixtures, added, updated }
}
