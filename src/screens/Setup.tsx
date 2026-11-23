import { useMemo, useState } from 'react'
import type { MatchEvent } from '../domain/events'
import { MINUTE, fairShares, foldMatch } from '../domain/engine'
import {
  DEFAULT_SLOTS,
  FORMATION_NAMES,
  MAX_ON_COURT,
  MIN_ON_COURT,
  formationFor,
  periodName,
  type PlayerId,
  type Slot,
  type SlotId,
} from '../domain/types'
import { dayContextFor, useSeason, type SetupDraft, type StoredMatch } from '../state/store'
import CourtMap from '../ui/CourtMap'
import PeriodSettings, { describeFormat, reshape } from '../ui/PeriodSettings'

const emptyDraft = (slots: Slot[]): SetupDraft => ({
  absent: [],
  assignments: Object.fromEntries(slots.map((s) => [s.id, null])),
  slots,
})

/**
 * Pre-game. Who is here and who starts.
 *
 * Every change is written straight to the stored match, so the line-up can be built at
 * home the night before and still be there at the stadium.
 */
export default function Setup({ match, onLeave }: { match: StoredMatch; onLeave: () => void }) {
  const { season, dispatch } = useSeason()
  const draft = match.draft ?? emptyDraft(match.init.slots.length ? match.init.slots : DEFAULT_SLOTS)
  const [picking, setPicking] = useState<SlotId | null>(null)

  const update = (patch: Partial<SetupDraft>) =>
    dispatch({ type: 'SET_DRAFT', id: match.id, draft: { ...draft, ...patch } })

  const slots = draft.slots
  const absent = new Set(draft.absent)

  const present = season.players.filter((p) => !absent.has(p.id))
  const taken = new Set(Object.values(draft.assignments).filter(Boolean) as PlayerId[])

  // Who is owed time, taking the day's other game into account if it has been played.
  const day = useMemo(() => dayContextFor(season, match), [season, match])
  const shares = useMemo(() => {
    const state = foldMatch(season.players, { slots, availability: {} }, [])
    return new Map(
      fairShares(season.players, state, match.config, 0, day).map((s) => [s.playerId, s]),
    )
  }, [season.players, slots, match.config, day])

  const owedFirst = [...present].sort(
    (a, b) => (shares.get(a.id)?.deltaMs ?? 0) - (shares.get(b.id)?.deltaMs ?? 0),
  )

  const ready = slots.every((s) => draft.assignments[s.id])

  const playedEarlier = present.some((p) => (shares.get(p.id)?.priorPlayedMs ?? 0) > 0)

  /**
   * Fill the line-up from who is owed most: the most owed start, and each takes a spot
   * they like where one is free.
   */
  const suggestLineup = () => {
    const starters = owedFirst.slice(0, slots.length)
    const assignments: Record<SlotId, PlayerId | null> = {}
    const remaining = [...starters]
    for (const slot of slots) {
      // Someone who likes this area gets it; otherwise the most owed player left.
      const index = remaining.findIndex((p) => slot.role && p.preferred?.includes(slot.role))
      const pick = index >= 0 ? remaining.splice(index, 1)[0] : remaining.shift()
      assignments[slot.id] = pick?.id ?? null
    }
    update({ assignments })
    setPicking(null)
  }

  const assign = (slotId: SlotId, playerId: PlayerId | null) => {
    const next = { ...draft.assignments }
    // A player can only be in one place, so clear them from anywhere else first.
    for (const key of Object.keys(next)) if (next[key] === playerId) next[key] = null
    next[slotId] = playerId
    update({ assignments: next })
    setPicking(null)
  }

  /** Switch format by players on court. Players already placed keep matching positions. */
  const setCount = (count: number) => {
    const nextSlots = formationFor(count)
    const next: Record<SlotId, PlayerId | null> = {}
    const placed = new Set<PlayerId>()
    for (const slot of nextSlots) {
      const keep = draft.assignments[slot.id]
      if (keep && !placed.has(keep)) {
        next[slot.id] = keep
        placed.add(keep)
      } else {
        next[slot.id] = null
      }
    }
    update({ slots: nextSlots, assignments: next })
    setPicking(null)
  }

  const start = () => {
    const assignments = { ...draft.assignments }
    const availability = Object.fromEntries(
      season.players.map((p) => [p.id, absent.has(p.id) ? 'absent' : 'available'] as const),
    )

    dispatch({
      type: 'START_MATCH',
      match: { ...match, init: { slots, availability }, events: [] },
    })
    const event: MatchEvent = { t: 'LINEUP', at: Date.now(), clock: 0, slots, assignments }
    dispatch({ type: 'APPEND', id: match.id, event })
  }

  if (season.players.length < 2) {
    return (
      <div className="screen">
        <h2 style={{ fontSize: 24 }}>Add the squad first</h2>
        <p className="muted small">You need players before you can set up a game.</p>
      </div>
    )
  }

  const nameOf = (id: PlayerId | null) => season.players.find((p) => p.id === id)?.name ?? '—'
  const pickingSlot = picking ? slots.find((s) => s.id === picking) : null
  const candidates = present

  const pickPlayer = (playerId: PlayerId) => {
    if (!pickingSlot) return
    assign(pickingSlot.id, playerId)
  }

  return (
    <div className="screen">
      <h2 style={{ fontSize: 20, marginBottom: 2 }}>{match.label}</h2>
      {match.venue && (
        <p className="small" style={{ margin: '0 0 4px', color: 'var(--amber)' }}>
          {match.venue}
        </p>
      )}
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        {describeFormat(match.config)} · sub every {match.config.shiftMinutes} min
      </p>

      <CourtMap
        slots={slots}
        nameOf={nameOf}
        selectedSlotId={picking}
        fill={(slotId) => ({ playerId: draft.assignments[slotId] ?? null })}
        onSlotTap={(slotId) => setPicking(picking === slotId ? null : slotId)}
      />

      {pickingSlot ? (
        <>
          <div className="section-title">
            WHO PLAYS {pickingSlot.label.toUpperCase()}? — MOST OWED FIRST
          </div>
          <div className="bench-strip">
            {owedFirst
              .filter((p) => candidates.includes(p))
              // Stable sort: players who like this area first, still most-owed within that.
              .sort((a, b) => {
                const role = pickingSlot.role
                const aLikes = role && a.preferred?.includes(role) ? 1 : 0
                const bLikes = role && b.preferred?.includes(role) ? 1 : 0
                return bLikes - aLikes
              })
              .map((player) => {
                const placed = taken.has(player.id)
                const share = shares.get(player.id)
                const owed = share ? Math.round(-share.deltaMs / MINUTE) : 0
                const likes =
                  pickingSlot.role && player.preferred?.includes(pickingSlot.role)
                return (
                  <button
                    key={player.id}
                    className="bench-chip"
                    style={{ opacity: placed ? 0.5 : 1 }}
                    onClick={() => pickPlayer(player.id)}
                  >
                    <span className="who">
                      {likes ? '★ ' : ''}
                      {player.name}
                    </span>
                    <span className="slot-label">
                      {placed ? 'already on' : owed > 0 ? `owed ${owed} min` : 'even'}
                    </span>
                  </button>
                )
              })}
          </div>
          <button
            className="btn-ghost btn-block btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              assign(pickingSlot.id, null)
            }}
          >
            Leave {pickingSlot.label} empty
          </button>
        </>
      ) : (
        <p className="muted small" style={{ margin: '12px 0 0', lineHeight: 1.5 }}>
          Tap a position to choose who plays there, or let the app pick from who is owed
          most. Everything here is saved as you go.
        </p>
      )}

      {playedEarlier && (
        <>
          <div className="section-title">EARLIER TODAY — MOST OWED FIRST</div>
          <div className="card">
            {owedFirst.map((player) => {
              const share = shares.get(player.id)
              const earlier = Math.round((share?.priorPlayedMs ?? 0) / MINUTE)
              const owed = Math.round((share?.gameTargetMs ?? 0) / MINUTE)
              const starting = Object.values(draft.assignments).includes(player.id)
              return (
                <div className="row" key={player.id}>
                  <span
                    className="grow"
                    style={{ fontWeight: earlier === 0 ? 700 : 400, color: earlier === 0 ? 'var(--amber)' : undefined }}
                  >
                    {player.name}
                    {starting && <span className="muted small"> · starting</span>}
                  </span>
                  <span className="muted small" style={{ marginRight: 10 }}>
                    {earlier === 0
                      ? 'no minutes yet'
                      : `${earlier} min`}
                  </span>
                  <span className={`pill ${owed > 0 ? 'behind' : 'level'}`}>owed {owed}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <button className="btn-block" style={{ marginTop: 12 }} onClick={suggestLineup}>
        Pick the starting {slots.length} from who is owed most
      </button>

      <div className="section-title">WHO IS HERE</div>
      <div className="card">
        <div className="row wrap" style={{ gap: 6 }}>
          {season.players.map((player) => {
            const here = !absent.has(player.id)
            return (
              <button
                key={player.id}
                className="btn-sm"
                style={{
                  borderColor: here ? 'var(--accent)' : 'var(--line)',
                  color: here ? 'var(--text)' : 'var(--muted)',
                  opacity: here ? 1 : 0.55,
                }}
                onClick={() => {
                  update({
                    absent: here
                      ? [...draft.absent, player.id]
                      : draft.absent.filter((id) => id !== player.id),
                    assignments: here
                      ? Object.fromEntries(
                          Object.entries(draft.assignments).map(([k, v]) => [
                            k,
                            v === player.id ? null : v,
                          ]),
                        )
                      : draft.assignments,
                  })
                }}
              >
                {player.name}
              </button>
            )
          })}
        </div>
        <div className="row small muted">
          {present.length} here · {absent.size} away
        </div>
      </div>

      <div className="section-title">FORMAT</div>
      <div className="card">
        <div className="row">
          <span className="grow small">
            Players on court · {FORMATION_NAMES[slots.length] ?? 'custom'}
          </span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={slots.length <= MIN_ON_COURT}
              onClick={() => setCount(slots.length - 1)}
            >
              −
            </button>
            <strong style={{ minWidth: 28, textAlign: 'center' }}>{slots.length}</strong>
            <button
              className="btn-sm"
              disabled={slots.length >= MAX_ON_COURT}
              onClick={() => setCount(slots.length + 1)}
            >
              +
            </button>
          </div>
        </div>
        <PeriodSettings
          periods={match.config.periods}
          periodMinutes={match.config.periodMinutes}
          onChange={(periods, periodMinutes) =>
            dispatch({
              type: 'SET_CONFIG',
              id: match.id,
              config: reshape(match.config, periods, periodMinutes),
            })
          }
        />
        <div className="row small muted" style={{ lineHeight: 1.5 }}>
          The clock stops itself at the end of each {periodName(match.config.periods).toLowerCase()}.
          These can also be changed mid-game.
        </div>
      </div>

      <button
        className="btn-primary btn-block"
        style={{ marginTop: 16, minHeight: 64, fontSize: 18 }}
        disabled={!ready}
        onClick={start}
      >
        {ready ? 'Confirm line-up and go' : 'Fill every position to start'}
      </button>

      <button className="btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onLeave}>
        Leave for now — this is saved
      </button>
    </div>
  )
}
