import { useEffect, useRef } from 'react'
import type { PlayerId, Slot, SlotId } from '../domain/types'

export interface MagnetInfo {
  /** Who is filling the slot right now. */
  playerId: PlayerId | null
  /** Who is coming on here, once the planned sub is made. */
  incoming?: PlayerId | null
}

/**
 * Spots for positions added mid-game, when the other coach agrees to more players. They
 * sit clear of the formation spots: two magnets on the same coordinates is worse than
 * useless — you cannot tap the one behind.
 */
const EXTRA_SPOTS = [
  { x: 50, y: 50 },
  { x: 30, y: 72 },
  { x: 70, y: 72 },
  { x: 50, y: 14 },
]

function layout(slots: Slot[]): (slot: Slot) => { x: number; y: number } {
  const extras = slots.filter((s) => s.x === undefined || s.y === undefined)
  return (slot) => {
    if (slot.x !== undefined && slot.y !== undefined) return { x: slot.x, y: slot.y }
    const i = extras.indexOf(slot)
    return EXTRA_SPOTS[i % EXTRA_SPOTS.length]
  }
}

/**
 * Half-court markings: basket at the top, halfway line at the bottom. Drawn in a 100 × 94
 * box (a half court is 15 m × 14 m) and stretched to fit. Decoration only — it never
 * takes a tap.
 */
function Markings() {
  const line = { fill: 'none', stroke: 'rgba(255,255,255,0.55)', strokeWidth: 0.7 }
  return (
    <svg className="court-lines" viewBox="0 0 100 94" preserveAspectRatio="none" aria-hidden>
      {/* Three-point line: short straights from the baseline, then the arc. */}
      <path d="M 6 0 V 9 A 45 45 0 0 0 94 9 V 0" {...line} />
      {/* The key and free-throw circle. */}
      <rect x="35" y="0" width="30" height="38" {...line} />
      <circle cx="50" cy="38" r="12" {...line} />
      {/* Backboard and ring. */}
      <line x1="44" y1="8" x2="56" y2="8" {...line} strokeWidth={1.2} />
      <circle cx="50" cy="10.5" r="2.4" {...line} stroke="#ff8a3d" strokeWidth={1} />
      {/* Halfway line and centre circle. */}
      <path d="M 38 94 A 12 12 0 0 1 62 94" {...line} />
    </svg>
  )
}

/**
 * The team laid out as it stands on court, with names big enough to read from the bench.
 * The players look at this to see where they are going, so position labels stay small
 * and names stay large.
 */
export default function CourtMap({
  slots,
  fill,
  nameOf,
  selectedSlotId,
  onSlotTap,
  onSlotHold,
  shuffling = false,
}: {
  slots: Slot[]
  fill: (slotId: SlotId) => MagnetInfo
  nameOf: (id: PlayerId | null) => string
  selectedSlotId?: SlotId | null
  onSlotTap: (slotId: SlotId) => void
  /** Held down on a magnet — used to start moving players around. */
  onSlotHold?: (slotId: SlotId) => void
  shuffling?: boolean
}) {
  const positionOf = layout(slots)
  const holdTimer = useRef<number | undefined>(undefined)
  const held = useRef(false)

  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  const startHold = (slotId: SlotId) => {
    if (!onSlotHold) return
    held.current = false
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      held.current = true
      navigator.vibrate?.(30)
      onSlotHold(slotId)
    }, 450)
  }
  const cancelHold = () => window.clearTimeout(holdTimer.current)

  return (
    <div className={`court${shuffling ? ' shuffling' : ''}`}>
      <Markings />

      {slots.map((slot) => {
        const { x, y } = positionOf(slot)
        const info = fill(slot.id)
        const planned = !!info.incoming

        return (
          <button
            key={slot.id}
            className={[
              'magnet',
              info.playerId ? '' : 'empty',
              planned ? 'planned' : '',
              selectedSlotId === slot.id ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${x}%`, top: `${y}%` }}
            onPointerDown={() => startHold(slot.id)}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              // A completed hold already did its job; do not also treat it as a tap.
              if (held.current) {
                held.current = false
                return
              }
              onSlotTap(slot.id)
            }}
          >
            <span className="pos">{slot.label}</span>
            <span className="who">{info.playerId ? nameOf(info.playerId) : 'Tap'}</span>
            {planned && <span className="incoming">▼ {nameOf(info.incoming ?? null)}</span>}
          </button>
        )
      })}
    </div>
  )
}
