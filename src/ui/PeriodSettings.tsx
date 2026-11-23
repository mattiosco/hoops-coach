import { periodName, type MatchConfig } from '../domain/types'

/**
 * Halves or quarters, and how long each runs. Shared by the team defaults, game setup and
 * the live game, so the three never disagree about what the options are.
 */
export default function PeriodSettings({
  periods,
  periodMinutes,
  onChange,
}: {
  periods: number
  periodMinutes: number
  onChange: (periods: number, periodMinutes: number) => void
}) {
  const name = periodName(periods).toLowerCase()
  return (
    <>
      <div className="row">
        <span className="grow small">Played in</span>
        <div className="inline">
          {[
            [2, 'Halves'],
            [4, 'Quarters'],
          ].map(([n, label]) => (
            <button
              key={n}
              className="btn-sm"
              aria-pressed={periods === n}
              style={{
                borderColor: periods === n ? 'var(--accent)' : undefined,
                background: periods === n ? 'var(--accent-dim)' : undefined,
              }}
              onClick={() => onChange(n as number, periodMinutes)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="grow small">Minutes per {name}</span>
        <div className="inline">
          <button
            className="btn-sm"
            disabled={periodMinutes <= 1}
            onClick={() => onChange(periods, periodMinutes - 1)}
          >
            −
          </button>
          <strong style={{ minWidth: 52, textAlign: 'center' }}>{periodMinutes} min</strong>
          <button
            className="btn-sm"
            disabled={periodMinutes >= 30}
            onClick={() => onChange(periods, periodMinutes + 1)}
          >
            +
          </button>
        </div>
      </div>
    </>
  )
}

/** Change the period shape of a match while keeping any extra time already added. */
export function reshape(config: MatchConfig, periods: number, periodMinutes: number): MatchConfig {
  const extra = Math.max(0, config.totalMinutes - config.periods * config.periodMinutes)
  return { ...config, periods, periodMinutes, totalMinutes: periods * periodMinutes + extra }
}

/** "2 × 20 min" or "4 × 10 min", plus any extra time. */
export function describeFormat(config: MatchConfig): string {
  const extra = config.totalMinutes - config.periods * config.periodMinutes
  return `${config.periods} × ${config.periodMinutes} min${extra > 0 ? ` + ${extra} extra` : ''}`
}
