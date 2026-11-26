import { formatMinutes, MAX_SHIFT_MINUTES, type ShiftPlan } from '../domain/shift'

const STEP = 0.5 // thirty seconds

/**
 * How often to sub. Follows the recommendation by default — it moves as players are
 * marked here or away — and the coach can nudge it, then go back to the recommendation
 * with one tap.
 */
export default function SubInterval({
  minutes,
  auto,
  plan,
  available,
  onChange,
}: {
  /** The interval in use. */
  minutes: number
  /** Whether it is following the recommendation. */
  auto: boolean
  plan: ShiftPlan
  available: number
  onChange: (minutes: number, auto: boolean) => void
}) {
  const shown = auto ? plan.shiftMinutes : minutes
  const nudge = (delta: number) => {
    // Step from the nearest half minute so a recommended 5:45 goes to 5:30 or 6:00.
    const base = Math.round(shown / STEP) * STEP
    const next = Math.min(MAX_SHIFT_MINUTES * 2, Math.max(1, base + delta))
    onChange(next, false)
  }

  return (
    <>
      <div className="row">
        <span className="grow small">
          Sub every
          {auto && <span className="muted"> · recommended</span>}
        </span>
        <div className="inline">
          <button className="btn-sm" disabled={shown <= 1} onClick={() => nudge(-STEP)}>
            −
          </button>
          <strong style={{ minWidth: 52, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {formatMinutes(shown)}
          </strong>
          <button className="btn-sm" onClick={() => nudge(STEP)}>
            +
          </button>
        </div>
      </div>
      <div className="row small muted" style={{ lineHeight: 1.5, flexWrap: 'wrap', gap: 8 }}>
        <span className="grow">
          {plan.noSubs
            ? `Only ${available} here — everyone plays the whole game.`
            : plan.even
              ? `${available} players here: subbing every ${formatMinutes(plan.shiftMinutes)} gives everyone ${formatMinutes(plan.minutesEach)}.`
              : `${available} players here: every ${formatMinutes(plan.shiftMinutes)} keeps everyone within one shift of ${formatMinutes(plan.minutesEach)}.`}
          {' '}A beep warns 30 seconds before each sub.
        </span>
        {!auto && Math.abs(minutes - plan.shiftMinutes) > 0.01 && (
          <button className="btn-sm" onClick={() => onChange(plan.shiftMinutes, true)}>
            Use {formatMinutes(plan.shiftMinutes)}
          </button>
        )}
      </div>
    </>
  )
}
