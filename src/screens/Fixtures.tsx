import { useState } from 'react'
import { hasStarted, matchForFixture, useSeason } from '../state/store'
import type { Fixture } from '../domain/types'
import PlayhqPaste from '../ui/PlayhqPaste'

export function isUpcoming(fixture: Fixture, now = Date.now()): boolean {
  // A fixture stays "on" for a few hours after tip-off so it does not vanish from the
  // top of the list while you are still at the stadium using it.
  return new Date(fixture.startTime).getTime() > now - 3 * 60 * 60 * 1000
}

/** Next Saturday at 9am: a sensible starting point for a hand-entered game. */
function nextSaturdayMorning(now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export default function Fixtures({ onPick }: { onPick: (fixture: Fixture) => void }) {
  const { season, dispatch } = useSeason()
  const [showPast, setShowPast] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /** Fixtures already set up say so, so a saved line-up is never a surprise. */
  const labelFor = (fixtureId: string) => {
    const existing = matchForFixture(season, fixtureId)
    if (!existing) return 'Set up game'
    if (existing.endedAt) return 'Played — view'
    return hasStarted(existing) ? 'Resume game' : 'Continue setting up'
  }

  const upcoming = season.fixtures.filter((f) => isUpcoming(f))
  const past = season.fixtures.filter((f) => !isUpcoming(f))
  const shown = showPast ? season.fixtures : upcoming

  return (
    <div className="screen">
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Fixtures — {season.name}</h2>
      <p className="muted small" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
        Paste your team&apos;s draw from PlayHQ, or add games by hand.
        {!season.playhqUrl && ' Add your PlayHQ link on the Team tab to open the draw from here.'}
      </p>

      <div className="inline wrap">
        <button
          className="btn-primary"
          onClick={() => {
            setPasting(true)
            setNotice(null)
          }}
        >
          Paste from PlayHQ
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            const id = crypto.randomUUID()
            const round = `Round ${season.fixtures.length + 1}`
            dispatch({
              type: 'ADD_FIXTURE',
              fixture: {
                id,
                round,
                startTime: nextSaturdayMorning(),
                opponent: '',
                homeAway: 'home',
                venue: '',
              },
            })
            setEditing(id)
          }}
        >
          + Add a game
        </button>
        {season.playhqUrl && (
          <a
            className="btn btn-ghost"
            href={season.playhqUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open PlayHQ draw ↗
          </a>
        )}
      </div>

      {pasting && (
        <PlayhqPaste
          existing={season.fixtures}
          playhqUrl={season.playhqUrl}
          onClose={() => setPasting(false)}
          onSave={(fixtures) => {
            const added = fixtures.length - season.fixtures.length
            dispatch({ type: 'SET_FIXTURES', fixtures })
            setPasting(false)
            setNotice(added > 0 ? `Added ${added} game${added === 1 ? '' : 's'} from PlayHQ.` : 'Games updated from PlayHQ.')
          }}
        />
      )}
      {notice && (
        <p className="small" style={{ color: 'var(--accent)', margin: '12px 0 0' }}>
          {notice}
        </p>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {shown.map((fixture) =>
          editing === fixture.id ? (
            <FixtureEditor
              key={fixture.id}
              fixture={fixture}
              onDone={() => setEditing(null)}
              onRemove={() => {
                dispatch({ type: 'REMOVE_FIXTURE', id: fixture.id })
                setEditing(null)
              }}
              onChange={(patch) => dispatch({ type: 'EDIT_FIXTURE', id: fixture.id, patch })}
            />
          ) : (
            <div className="card" key={fixture.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="small muted">
                    {fixture.round} · {fixture.homeAway === 'home' ? 'Home' : 'Away'}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, margin: '2px 0' }}>
                    v {fixture.opponent || 'Opponent TBC'}
                  </div>
                  <div className="small muted">{fmt.format(new Date(fixture.startTime))}</div>
                  {fixture.venue && <div className="small muted">{fixture.venue}</div>}
                </div>
              </div>
              <div className="row">
                <button className="btn-primary grow" onClick={() => onPick(fixture)}>
                  {labelFor(fixture.id)}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setEditing(fixture.id)}>
                  Edit
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {shown.length === 0 && (
        <p className="muted small" style={{ marginTop: 20, lineHeight: 1.5 }}>
          No games yet. Paste them from PlayHQ or add them by hand — or skip this and start
          a practice game from the Game tab.
        </p>
      )}

      {past.length > 0 && (
        <button
          className="btn-ghost btn-block"
          style={{ marginTop: 16 }}
          onClick={() => setShowPast((v) => !v)}
        >
          {showPast ? 'Hide past fixtures' : `Show ${past.length} past fixtures`}
        </button>
      )}
    </div>
  )
}

/** Every field is editable: draws change, and courts get swapped on the day. */
function FixtureEditor({
  fixture,
  onChange,
  onDone,
  onRemove,
}: {
  fixture: Fixture
  onChange: (patch: Partial<Fixture>) => void
  onDone: () => void
  onRemove: () => void
}) {
  const local = toLocalInput(fixture.startTime)

  return (
    <div className="card">
      <div className="row stack" style={{ alignItems: 'stretch' }}>
        <label className="small muted">Opponent</label>
        <input
          type="text"
          value={fixture.opponent}
          placeholder="Team name"
          autoFocus
          onChange={(e) => onChange({ opponent: e.target.value })}
        />

        <label className="small muted">Tip-off</label>
        <input
          type="datetime-local"
          value={local}
          onChange={(e) => onChange({ startTime: fromLocalInput(e.target.value) })}
        />

        <label className="small muted">Stadium and court</label>
        <input
          type="text"
          value={fixture.venue}
          placeholder="e.g. Stadium — Court 3"
          onChange={(e) => onChange({ venue: e.target.value })}
        />

        <label className="small muted">Round</label>
        <input
          type="text"
          value={fixture.round}
          onChange={(e) => onChange({ round: e.target.value })}
        />

        <label className="small muted">Home or away</label>
        <select
          value={fixture.homeAway}
          onChange={(e) => onChange({ homeAway: e.target.value as 'home' | 'away' })}
        >
          <option value="home">Home</option>
          <option value="away">Away</option>
        </select>
      </div>
      <div className="row">
        <button className="btn-primary grow" onClick={onDone}>
          Done
        </button>
        <button className="btn-ghost btn-sm btn-danger" onClick={onRemove}>
          Delete
        </button>
      </div>
    </div>
  )
}

/** datetime-local wants local wall time with no zone, so convert around the offset. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString()
}
