import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MINUTE,
  currentClock,
  fairShares,
  periodEndMs,
  totalMatchMs,
  type MatchState,
  type Share,
} from '../domain/engine'
import type { MatchEvent, NewMatchEvent } from '../domain/events'
import { msToNextShift, shiftNumber, suggestSubs } from '../domain/suggest'
import {
  MAX_ON_COURT,
  formationFor,
  periodName,
  type Availability,
  type PlayerId,
  type SlotId,
} from '../domain/types'
import { useWakeLock } from '../lib/useWakeLock'
import { alertBuzzer, alertSubNow, alertSubSoon, unlockAudio } from '../lib/alerts'
import { recommendShift } from '../domain/shift'
import SubInterval from '../ui/SubInterval'
import {
  activeMatch,
  configFor,
  dayContextFor,
  hasStarted,
  newMatch,
  stateOf,
  useSeason,
  type PlannedSub,
  type StoredMatch,
} from '../state/store'
import CourtMap from '../ui/CourtMap'
import PeriodSettings, { reshape } from '../ui/PeriodSettings'
import Setup from './Setup'
import Summary from './Summary'

export default function Game({ onNoMatch }: { onNoMatch: () => void }) {
  const { season, dispatch } = useSeason()
  const match = activeMatch(season)

  // Keep the screen on from setup to the final buzzer, breaks included — not just while
  // the clock runs. Once the game is over, or the coach leaves this screen, the screen
  // may sleep as normal.
  useWakeLock(!!match && !match.endedAt)

  if (!match) {
    const parked = season.matches.filter((m) => !m.endedAt)
    const played = [...season.matches]
      .filter((m) => m.endedAt)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    return (
      <div className="screen">
        <h2 style={{ fontSize: 24 }}>No game running</h2>
        <p className="muted small" style={{ lineHeight: 1.5 }}>
          Pick a fixture, or start a practice game to have a play.
        </p>
        <div className="stack">
          <button className="btn-primary btn-block" onClick={onNoMatch}>
            Go to fixtures
          </button>
          <button
            className="btn-block"
            disabled={season.players.length < 2}
            onClick={() =>
              dispatch({
                type: 'START_MATCH',
                match: newMatch(
                  null,
                  'Practice game',
                  {},
                  configFor(season.defaults),
                  formationFor(season.defaults.playersPerSide),
                ),
              })
            }
          >
            Start a practice game
          </button>
        </div>

        {parked.length > 0 && (
          <>
            <div className="section-title">SET UP EARLIER — PICK UP WHERE YOU LEFT OFF</div>
            <div className="stack">
              {parked.map((m) => (
                <div className="card" key={m.id}>
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{m.label}</div>
                      <div className="small muted">
                        {hasStarted(m) ? 'In progress' : 'Line-up saved, not started'}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn-primary grow"
                      onClick={() => dispatch({ type: 'SET_ACTIVE', id: m.id })}
                    >
                      {hasStarted(m) ? 'Resume game' : 'Continue setting up'}
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (!confirm(`Throw away "${m.label}"?`)) return
                        dispatch({ type: 'DELETE_MATCH', id: m.id })
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {played.length > 0 && (
          <>
            <div className="section-title">PLAYED — TIMES AND VOTES</div>
            <div className="stack">
              {played.map((m) => (
                <div className="card" key={m.id}>
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{m.label}</div>
                      <div className="small muted">
                        {m.endedAt ? new Date(m.endedAt).toLocaleDateString() : ''}
                      </div>
                    </div>
                    <button
                      className="btn-sm"
                      onClick={() => dispatch({ type: 'SET_ACTIVE', id: m.id })}
                    >
                      View
                    </button>
                    <button
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (!confirm(`Delete "${m.label}" for good? Its minutes stop counting.`))
                          return
                        dispatch({ type: 'DELETE_MATCH', id: m.id })
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {season.players.length < 2 && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Add some players on the Team tab first.
          </p>
        )}
      </div>
    )
  }

  const state = stateOf(season, match)
  const leave = () => dispatch({ type: 'SET_ACTIVE', id: null })

  if (match.endedAt) return <Summary match={match} onDone={leave} />

  return hasStarted(match) ? (
    <Live match={match} state={state} onLeave={leave} />
  ) : (
    <Setup match={match} onLeave={leave} />
  )
}

/** What the "just changed" panel holds: substitutions and positional moves alike. */
type RecentChange =
  | { kind: 'sub'; slotId: SlotId; off: PlayerId | null; on: PlayerId }
  | {
      kind: 'move'
      slotA: SlotId
      slotB: SlotId
      playerA: PlayerId | null
      playerB: PlayerId | null
    }

function Live({
  match,
  state,
  onLeave,
}: {
  match: StoredMatch
  state: MatchState
  onLeave: () => void
}) {
  const { season, dispatch } = useSeason()
  const [, tick] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  // Shift 1 is the opening line-up, so the first prompt is at the end of it, not at tip-off.
  // Coming back to this screen mid-game starts from the shift in progress, so returning
  // does not beep for a sub that was already dealt with.
  const [ackedShift, setAckedShift] = useState(() =>
    Math.max(1, shiftNumber(currentClock(state, Date.now()), match.config.shiftMinutes)),
  )
  /** Changes just made, kept on screen while everyone finds their new spot. */
  const [recent, setRecent] = useState<RecentChange[] | null>(null)
  const recentTimer = useRef<number | undefined>(undefined)
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null)
  /** Moving players between positions, rather than subbing anyone on or off. */
  const [moving, setMoving] = useState(false)
  /** Boundaries the clock has already stopped itself at, so Resume is not overridden. */
  const autoStopped = useRef(new Set<number>())

  const running = state.runningSince !== null
  const planned = match.plannedSubs

  // One timer drives the screen. The clock is always derived from Date.now(), so a
  // missed tick costs nothing.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [running])

  const clock = currentClock(state, Date.now())
  const totalMs = totalMatchMs(match.config)
  const day = useMemo(() => dayContextFor(season, match), [season, match])
  const shares = useMemo(
    () => fairShares(season.players, state, match.config, clock, day),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [season.players, state, match.config, day, Math.floor(clock / 1000)],
  )
  const shareOf = new Map(shares.map((s) => [s.playerId, s]))
  const nameOf = (id: PlayerId | null) => season.players.find((p) => p.id === id)?.name ?? '—'

  const append = (event: NewMatchEvent) =>
    dispatch({
      type: 'APPEND',
      id: match.id,
      event: { ...event, at: Date.now(), clock: currentClock(state, Date.now()) } as MatchEvent,
    })

  const shiftMinutes = match.config.shiftMinutes
  const shift = shiftNumber(clock, shiftMinutes)
  const shiftDue = running && shift > ackedShift && clock > 0

  const suggestions = useMemo(
    () => (shiftDue && planned.length === 0 ? suggestSubs(season.players, state, shares, clock) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftDue, state, shares, planned.length],
  )

  const periods = match.config.periods
  const periodLabel = periodName(periods)
  const lastPeriod = state.period >= periods
  const periodEnd = periodEndMs(match.config, state.period)

  const toNextSub = msToNextShift(clock, shiftMinutes)
  // A sub that would land on (or after) the end of the period is made at the break
  // instead, so it gets no warning of its own — the period buzzer covers it.
  const nextSubInPlay = clock + toNextSub < periodEnd - 1000
  const subSoon = running && nextSubInPlay && toNextSub <= 30_000 && !shiftDue

  // Beep once, 30 seconds out, so the next players can be at the bench ready to go.
  const warned = useRef(0)
  useEffect(() => {
    if (subSoon && warned.current !== shift + 1) {
      warned.current = shift + 1
      alertSubSoon()
    }
  }, [subSoon, shift])

  // And again when the sub falls due.
  const buzzed = useRef(0)
  useEffect(() => {
    if (shiftDue && buzzed.current !== shift) {
      buzzed.current = shift
      alertSubNow()
    }
  }, [shiftDue, shift])

  /** Who would come on at the next sub, shown during the 30-second warning. */
  const upcoming = useMemo(
    () =>
      subSoon && planned.length === 0
        ? suggestSubs(season.players, state, shares, clock + toNextSub)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subSoon, state, shares, planned.length],
  )

  /**
   * Stop the clock on our own at the end of each period, and at full time.
   *
   * The buzzer goes and the phone is on the bench; left alone the clock kept running and
   * everyone on court quietly banked minutes they never played. The stop is stamped at
   * exactly the boundary rather than whenever this fires, so a late notice costs nothing.
   * Each boundary stops the clock only once, so undoing it, or adding time and playing on,
   * works.
   */
  useEffect(() => {
    if (!running || clock < periodEnd) return
    if (autoStopped.current.has(periodEnd)) return
    autoStopped.current.add(periodEnd)
    dispatch({
      type: 'APPEND',
      id: match.id,
      event: lastPeriod
        ? { t: 'CLOCK_PAUSE', at: Date.now(), clock: periodEnd }
        : { t: 'PERIOD_END', at: Date.now(), clock: periodEnd },
    })
    // Subs are made during the break, so a shift that falls due at the boundary is
    // treated as done rather than prompting again the moment play resumes.
    setAckedShift(shiftNumber(periodEnd, shiftMinutes))
    alertBuzzer()
  }, [running, clock, periodEnd, lastPeriod, shiftMinutes, match.id, dispatch])

  /** Close the current period at this clock reading, ahead of its scheduled end. */
  const endPeriodNow = () => {
    autoStopped.current.add(periodEnd)
    setAckedShift(shiftNumber(clock, shiftMinutes))
    append({ t: 'PERIOD_END' })
  }

  const availableNow = season.players.filter((p) => state.availability[p.id] === 'available').length
  const recommended = recommendShift({
    available: availableNow,
    onCourt: state.slots.length,
    totalMinutes: match.config.totalMinutes,
    periodMinutes: match.config.periodMinutes,
  })

  /** Change the interval mid-game without firing a prompt for shifts already gone by. */
  const setShift = (minutes: number, auto: boolean) => {
    dispatch({
      type: 'SET_CONFIG',
      id: match.id,
      config: { ...match.config, shiftMinutes: minutes, autoShift: auto },
    })
    setAckedShift(shiftNumber(clock, minutes))
  }

  /** Between periods: the previous one has finished and the clock has not restarted. */
  const atBreak = !running && match.events[match.events.length - 1]?.t === 'PERIOD_END'

  const plannedBySlot = new Map(planned.map((p) => [p.slotId, p]))
  const plannedOn = new Set(planned.map((p) => p.on))

  const bench = season.players.filter(
    (p) => !Object.values(state.onField).includes(p.id) && state.availability[p.id] === 'available',
  )

  const setPlanned = (next: PlannedSub[]) =>
    dispatch({ type: 'PLAN_SUBS', id: match.id, planned: next })

  const showRecent = (changes: RecentChange[]) => {
    setRecent(changes)
    window.clearTimeout(recentTimer.current)
    recentTimer.current = window.setTimeout(() => setRecent(null), 60_000)
  }

  const startMoving = (slotId?: SlotId) => {
    setMoving(true)
    setSuggestMsg(null)
    setSelectedSlot(slotId ?? null)
  }

  /** Tapping a position selects it; tapping it again clears any plan on it. */
  const handleSlot = (slotId: string) => {
    if (moving) {
      // Two taps swap the players standing in those spots. Nobody comes off, so no minutes
      // change hands — it is only the shape of the team that moves.
      if (!selectedSlot) {
        setSelectedSlot(slotId)
        return
      }
      if (selectedSlot === slotId) {
        setSelectedSlot(null)
        return
      }
      const playerA = state.onField[selectedSlot] ?? null
      const playerB = state.onField[slotId] ?? null
      append({ t: 'SWAP', slotA: selectedSlot, slotB: slotId })
      showRecent([{ kind: 'move', slotA: selectedSlot, slotB: slotId, playerA, playerB }])
      setSelectedSlot(null)
      navigator.vibrate?.(40)
      return
    }
    if (plannedBySlot.has(slotId) && selectedSlot === slotId) {
      setPlanned(planned.filter((p) => p.slotId !== slotId))
      setSelectedSlot(null)
      return
    }
    setSelectedSlot(selectedSlot === slotId ? null : slotId)
  }

  /** Tapping a bench player plans them into the selected position. */
  const handleBench = (playerId: PlayerId) => {
    if (moving || !selectedSlot) return
    const next = planned.filter((p) => p.slotId !== selectedSlot && p.on !== playerId)
    setPlanned([
      ...next,
      { slotId: selectedSlot, off: state.onField[selectedSlot] ?? null, on: playerId },
    ])
    setSelectedSlot(null)
  }

  const suggestNow = () => {
    const proposals = suggestSubs(season.players, state, shares, clock)
    if (proposals.length === 0) {
      setSuggestMsg(
        'Nothing to suggest right now — everyone is close to their share, or the last subs are still settling in.',
      )
      return
    }
    setSuggestMsg(null)
    setPlanned(proposals.map((p) => ({ slotId: p.slotId, off: p.off, on: p.on })))
    setSelectedSlot(null)
    setAckedShift(shift)
  }

  const makeSubs = () => {
    const at = Date.now()
    const stamp = currentClock(state, at)
    for (const sub of planned) {
      dispatch({
        type: 'APPEND',
        id: match.id,
        event: { t: 'SUB', slotId: sub.slotId, off: sub.off, on: sub.on, at, clock: stamp },
      })
    }
    // Hold the list up for a minute: the players are still sorting themselves out, and
    // this is what you check them against.
    showRecent(planned.map((p) => ({ kind: 'sub', slotId: p.slotId, off: p.off, on: p.on })))

    setPlanned([])
    setAckedShift(shift)
    setSelectedSlot(null)
    navigator.vibrate?.(60)
  }

  // The moment the next change starts being planned, the last one is history.
  useEffect(() => {
    if (planned.length > 0) {
      setRecent(null)
      setSuggestMsg(null)
      window.clearTimeout(recentTimer.current)
    }
  }, [planned.length])

  useEffect(() => () => window.clearTimeout(recentTimer.current), [])

  const addMinutes = (extra: number) =>
    dispatch({
      type: 'SET_CONFIG',
      id: match.id,
      config: { ...match.config, totalMinutes: match.config.totalMinutes + extra },
    })

  const endMatch = () => {
    if (!confirm('End the game and save it?')) return
    append({ t: 'MATCH_END' })
    dispatch({ type: 'END_MATCH', id: match.id, at: Date.now() })
  }


  return (
    <div className="screen">
      <div className="inline" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {match.label}
          </div>
          {match.venue && (
            <div className="small" style={{ color: 'var(--amber)', fontWeight: 700 }}>
              {match.venue}
            </div>
          )}
        </div>
        <div className="small muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {periodLabel} {Math.min(state.period, periods)} · shift {shift}
        </div>
      </div>

      {/* Sticky: both clocks stay readable however far down the screen you scroll. */}
      <div className="clockbar">
        <div className={`clock ${running ? 'running' : 'paused'}`}>{formatClock(clock)}</div>
        <div className="clockbar-side">
          <div>
            <span className="clockbar-num">
              {formatClock(Math.max(0, periodEnd - clock))}
            </span>
            <span className="clockbar-cap">left in {periodLabel.toLowerCase()}</span>
          </div>
          <div>
            <span className="clockbar-num" style={{ color: 'var(--amber)' }}>
              {nextSubInPlay ? formatClock(toNextSub) : 'break'}
            </span>
            <span className="clockbar-cap">{nextSubInPlay ? 'to sub' : 'next sub'}</span>
          </div>
        </div>
      </div>

      <div className="inline" style={{ marginBottom: 12 }}>
        <button
          className={running ? '' : 'btn-primary'}
          style={{ flex: 2, minHeight: 60, fontSize: 18, fontWeight: 700 }}
          onClick={() => {
            // A tap is the moment the tablet allows sound, so the alerts can beep later.
            unlockAudio()
            append({ t: running ? 'CLOCK_PAUSE' : 'CLOCK_START' })
          }}
        >
          {running ? 'Pause' : clock === 0 ? 'Start' : 'Resume'}
        </button>
        <button
          className="btn-ghost"
          style={{ flex: 1 }}
          disabled={match.events.length === 0}
          onClick={() => dispatch({ type: 'UNDO', id: match.id, now: Date.now() })}
        >
          Undo
        </button>
      </div>

      {atBreak && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">
            END OF {periodLabel.toUpperCase()} {state.period - 1} — clock stopped
          </div>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
            Make any subs now, then press Resume to start {periodLabel.toLowerCase()}{' '}
            {state.period}.
          </p>
        </div>
      )}

      {lastPeriod && clock >= totalMs && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">
            FULL TIME — {match.config.totalMinutes} min played, clock stopped
          </div>
          <div className="inline">
            <button className="grow" onClick={() => addMinutes(1)}>
              +1 min
            </button>
            <button className="grow" onClick={() => addMinutes(3)}>
              +3 OT
            </button>
            <button className="btn-primary grow" onClick={endMatch}>
              End game
            </button>
          </div>
          <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
            Tied, or the clock ran late? Add time, then press Resume.
          </p>
        </div>
      )}

      {subSoon && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner soon">
            SUB IN {formatClock(toNextSub)} — get the next players ready
          </div>
          {upcoming.length > 0 && (
            <div className="card">
              {upcoming.map((s) => (
                <div className="row small" key={s.slotId}>
                  <span className="grow">
                    <strong>{nameOf(s.on)}</strong> on for {nameOf(s.off)}
                  </span>
                  <span className="muted">{state.slots.find((x) => x.id === s.slotId)?.label}</span>
                </div>
              ))}
              <div className="row">
                <button
                  className="btn-primary grow"
                  onClick={() =>
                    setPlanned(upcoming.map((s) => ({ slotId: s.slotId, off: s.off, on: s.on })))
                  }
                >
                  Plan these {upcoming.length}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {shiftDue && planned.length === 0 && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="shift-banner">SUB DUE — shift {shift}</div>
          {suggestions.length > 0 && (
            <div className="card">
              {suggestions.map((s) => (
                <div className="row small" key={s.slotId}>
                  <span className="grow">
                    <strong>{nameOf(s.on)}</strong> on for {nameOf(s.off)}
                  </span>
                  <span className="muted">{state.slots.find((x) => x.id === s.slotId)?.label}</span>
                </div>
              ))}
              <div className="row">
                <button
                  className="btn-primary grow"
                  onClick={() =>
                    setPlanned(
                      suggestions.map((s) => ({ slotId: s.slotId, off: s.off, on: s.on })),
                    )
                  }
                >
                  Plan these {suggestions.length}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setAckedShift(shift)}>
                  Skip
                </button>
              </div>
            </div>
          )}
          {suggestions.length === 0 && (
            <button className="btn-ghost btn-block" onClick={() => setAckedShift(shift)}>
              Nothing to change — dismiss
            </button>
          )}
        </div>
      )}

      <CourtMap
        slots={state.slots}
        nameOf={nameOf}
        selectedSlotId={selectedSlot}
        fill={(slotId) => ({
          playerId: state.onField[slotId] ?? null,
          incoming: plannedBySlot.get(slotId)?.on ?? null,
        })}
        onSlotTap={handleSlot}
        onSlotHold={startMoving}
        shuffling={moving}
      />

      {planned.length === 0 && !moving && (
        <div className="inline" style={{ marginTop: 12 }}>
          <button className="grow" onClick={suggestNow}>
            Suggest subs
          </button>
          <button className="grow" onClick={() => startMoving()}>
            Move players
          </button>
        </div>
      )}

      {moving && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="shift-banner">
            {selectedSlot
              ? `MOVING ${(state.slots.find((s) => s.id === selectedSlot)?.label ?? '').toUpperCase()} — TAP WHERE THEY GO`
              : 'MOVING PLAYERS — TAP TWO POSITIONS TO SWAP'}
          </div>
          <button
            className="btn-block"
            onClick={() => {
              setMoving(false)
              setSelectedSlot(null)
            }}
          >
            Done moving
          </button>
        </div>
      )}
      {suggestMsg && (
        <p className="muted small" style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
          {suggestMsg}
        </p>
      )}

      {recent && recent.length > 0 && planned.length === 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--accent-dim)' }}>
          <div className="row small muted">Just changed — check they are in the right spots</div>
          {recent.map((c) =>
            c.kind === 'sub' ? (
              <div className="row small" key={`sub-${c.slotId}`}>
                <span className="grow">
                  <strong style={{ color: 'var(--accent)' }}>{nameOf(c.on)}</strong> on for{' '}
                  {nameOf(c.off)}
                </span>
                <span className="muted">{state.slots.find((x) => x.id === c.slotId)?.label}</span>
              </div>
            ) : (
              <div className="row small" key={`move-${c.slotA}-${c.slotB}`}>
                <span className="grow">
                  <strong style={{ color: 'var(--accent)' }}>{nameOf(c.playerA)}</strong> and{' '}
                  <strong style={{ color: 'var(--accent)' }}>{nameOf(c.playerB)}</strong> swapped
                </span>
                <span className="muted">
                  {state.slots.find((x) => x.id === c.slotA)?.label} /{' '}
                  {state.slots.find((x) => x.id === c.slotB)?.label}
                </span>
              </div>
            ),
          )}
          <div className="row">
            <button className="btn-ghost btn-sm btn-block" onClick={() => setRecent(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {planned.length > 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="row small muted">
              Tell the players, then make the change at the next dead ball.
            </div>
            {planned.map((p) => (
              <div className="row small" key={p.slotId}>
                <span className="grow">
                  <strong style={{ color: 'var(--amber)' }}>{nameOf(p.on)}</strong> on for{' '}
                  {nameOf(p.off)}
                </span>
                <span className="muted">{state.slots.find((x) => x.id === p.slotId)?.label}</span>
              </div>
            ))}
          </div>
          <div className="inline">
            <button
              className="btn-primary grow"
              style={{ minHeight: 60, fontSize: 17, fontWeight: 700 }}
              onClick={makeSubs}
            >
              Make {planned.length === 1 ? 'this sub' : `these ${planned.length} subs`} now
            </button>
            <button className="btn-ghost" onClick={() => setPlanned([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="section-title">
        {moving
          ? 'BENCH — NOT USED WHILE MOVING'
          : selectedSlot
            ? `WHO GOES TO ${(state.slots.find((s) => s.id === selectedSlot)?.label ?? '').toUpperCase()}?`
            : 'BENCH — MOST OWED FIRST'}
      </div>
      <div className="bench-strip">
        {[...bench]
          .sort((a, b) => (shareOf.get(a.id)?.deltaMs ?? 0) - (shareOf.get(b.id)?.deltaMs ?? 0))
          .map((player) => {
            const share = shareOf.get(player.id)
            return (
              <button
                key={player.id}
                className={`bench-chip ${plannedOn.has(player.id) ? 'planned' : ''}`}
                disabled={moving || (!selectedSlot && !plannedOn.has(player.id))}
                style={{ opacity: selectedSlot || plannedOn.has(player.id) ? 1 : 0.85 }}
                onClick={() => handleBench(player.id)}
              >
                <span className="who">{player.name}</span>
                <span className="slot-label">
                  {plannedOn.has(player.id)
                    ? 'GOING ON'
                    : `${Math.round((share?.playedMs ?? 0) / MINUTE)} min`}
                </span>
                {share && <DeltaPill share={share} />}
              </button>
            )
          })}
        {bench.length === 0 && <p className="muted small">Nobody on the bench.</p>}
      </div>

      {!selectedSlot && planned.length === 0 && !moving && (
        <p className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Tap a position on the court, then tap who is going there. That plans the change
          so you can tell the players — nothing moves until you tap Make subs. To rearrange
          the players already on, tap Move players or hold down on a position.
        </p>
      )}

      <div className="section-title">
        {shares.some((s) => s.priorPlayedMs > 0) ? 'TIME ON — TODAY INCLUDED' : 'TIME ON SO FAR'}
      </div>
      <div className="card">
        {[...shares]
          .filter((s) => state.availability[s.playerId] !== 'absent')
          .sort((a, b) => b.playedMs - a.playedMs)
          .map((s) => (
            <div className="row" key={s.playerId}>
              <span className="grow" style={{ fontWeight: s.onField ? 700 : 400 }}>
                {nameOf(s.playerId)}
                {s.onField && <span className="muted small"> · on</span>}
                {state.availability[s.playerId] === 'loaned' && (
                  <span className="muted small"> · lent out</span>
                )}
                {s.priorPlayedMs > 0 && (
                  <div className="muted small">
                    {Math.round(s.priorPlayedMs / MINUTE)} min earlier today
                  </div>
                )}
              </span>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  marginRight: 8,
                }}
              >
                {Math.round(s.playedMs / MINUTE)} min
              </span>
              <DeltaPill share={s} />
            </div>
          ))}
      </div>

      <div className="section-title">GAME</div>
      <div className="card">
        <div className="row">
          <span className="grow small">Players on court</span>
          <div className="inline">
            <button
              className="btn-sm"
              disabled={state.slots.length <= 1}
              onClick={() => {
                const last = state.slots[state.slots.length - 1]
                if (last) append({ t: 'SLOT_REMOVE', slotId: last.id })
              }}
            >
              −
            </button>
            <strong style={{ minWidth: 28, textAlign: 'center' }}>{state.slots.length}</strong>
            <button
              className="btn-sm"
              onClick={() => {
                const usedIds = new Set(state.slots.map((s) => s.id))
                const usedLabels = new Set(state.slots.map((s) => s.label))
                let next = null
                for (let n = state.slots.length + 1; n <= MAX_ON_COURT && !next; n++) {
                  next =
                    formationFor(n).find(
                      (slot) => !usedIds.has(slot.id) && !usedLabels.has(slot.label),
                    ) ?? null
                }
                next ??= { id: `slot-${crypto.randomUUID()}`, label: 'Extra' }
                append({ t: 'SLOT_ADD', slot: next, playerId: null })
                // Open the picker straight away: adding a position is only ever the first
                // half of putting someone in it.
                setSelectedSlot(next.id)
                document.querySelector('.court')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              +
            </button>
          </div>
        </div>
        <SubInterval
          minutes={shiftMinutes}
          // Mid-game the interval is fixed from tip-off — moving it on its own would jump the
          // sub clock. A late arrival changes the recommendation, offered as a one-tap Use.
          auto={Math.abs(shiftMinutes - recommended.shiftMinutes) < 0.01}
          plan={recommended}
          available={availableNow}
          onChange={setShift}
        />
        <PeriodSettings
          periods={periods}
          periodMinutes={match.config.periodMinutes}
          onChange={(n, minutes) =>
            dispatch({ type: 'SET_CONFIG', id: match.id, config: reshape(match.config, n, minutes) })
          }
        />
        {!lastPeriod && (
          <div className="row">
            <span className="grow small">
              The clock stops itself at the end of each {periodLabel.toLowerCase()}
            </span>
            <button className="btn-sm" onClick={endPeriodNow}>
              End {periodLabel.toLowerCase()} {state.period} now
            </button>
          </div>
        )}
        {season.players.some((p) => state.availability[p.id] === 'absent') && (
          <>
            <div className="row">
              <span className="grow small">Turned up late? Tap them to add them in</span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {season.players
                .filter((p) => state.availability[p.id] === 'absent')
                .map((player) => (
                  <button
                    key={player.id}
                    className="btn-sm"
                    style={{ borderColor: 'var(--accent)' }}
                    onClick={() =>
                      append({
                        t: 'AVAILABILITY',
                        playerId: player.id,
                        status: 'available' as Availability,
                      })
                    }
                  >
                    {player.name} arrived
                  </button>
                ))}
            </div>
          </>
        )}

        <div className="row">
          <span className="grow small">Lend a player to the other team</span>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {season.players
            .filter((p) => state.availability[p.id] !== 'absent')
            .map((player) => {
            const status = state.availability[player.id]
            return (
              <button
                key={player.id}
                className="btn-sm"
                style={{
                  borderColor: status === 'loaned' ? 'var(--amber)' : undefined,
                  color: status === 'loaned' ? 'var(--amber)' : undefined,
                }}
                onClick={() =>
                  append({
                    t: 'AVAILABILITY',
                    playerId: player.id,
                    status: (status === 'loaned' ? 'available' : 'loaned') as Availability,
                  })
                }
              >
                {player.name}
                {status === 'loaned' && ' ↩'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <button className="btn-ghost" onClick={onLeave}>
          Leave the game screen — this is saved
        </button>
        <button className="btn-ghost btn-danger" onClick={endMatch}>
          End game
        </button>
        <button
          className="btn-ghost btn-danger"
          onClick={() => {
            if (!confirm('Throw this game away? Nothing about it is kept.')) return
            dispatch({ type: 'DELETE_MATCH', id: match.id })
          }}
        >
          Discard — keep no record
        </button>
      </div>
    </div>
  )
}

function DeltaPill({ share }: { share: Share }) {
  const deltaMin = share.deltaMs / MINUTE
  const rounded = Math.round(deltaMin * 10) / 10
  const cls = Math.abs(rounded) < 0.5 ? 'level' : rounded < 0 ? 'behind' : 'ahead'
  return (
    <span className={`pill ${cls}`}>
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}
    </span>
  )
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
