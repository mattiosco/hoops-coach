import { describe, expect, it } from 'vitest'
import { formatMinutes, recommendShift } from './shift'

const halves = { totalMinutes: 40, periodMinutes: 20, onCourt: 5 }

describe('recommendShift', () => {
  it('shares time exactly with the fewest sub breaks', () => {
    const eight = recommendShift({ ...halves, available: 8 })
    expect(eight).toMatchObject({ shifts: 8, shiftMinutes: 5, minutesEach: 25, even: true })

    // Ten players could share whole halves, but twenty minutes on the bench is too long.
    const ten = recommendShift({ ...halves, available: 10 })
    expect(ten).toMatchObject({ shifts: 4, shiftMinutes: 10, minutesEach: 20, even: true })
  })

  it('uses odd shift lengths when that is what makes it even', () => {
    const seven = recommendShift({ ...halves, available: 7 })
    expect(seven.shifts).toBe(7)
    expect(formatMinutes(seven.shiftMinutes)).toBe('5:45')
    expect(seven.even).toBe(true)

    const nine = recommendShift({ ...halves, available: 9 })
    expect(nine.shifts).toBe(9)
    expect(formatMinutes(nine.shiftMinutes)).toBe('4:25')
  })

  it('keeps every shift between three and ten minutes', () => {
    for (let available = 6; available <= 15; available++) {
      const plan = recommendShift({ ...halves, available })
      expect(plan.shiftMinutes).toBeGreaterThanOrEqual(3)
      expect(plan.shiftMinutes).toBeLessThanOrEqual(10)
    }
  })

  it('falls back to the shortest shift when no length shares exactly', () => {
    // 14 players at 5 on court needs 14 shifts — under three minutes each.
    const plan = recommendShift({ ...halves, available: 14 })
    expect(plan.even).toBe(false)
    expect(plan.shifts).toBe(13)
    expect(plan.shiftMinutes).toBeGreaterThanOrEqual(3)
  })

  it('works for quarters', () => {
    const plan = recommendShift({ totalMinutes: 32, periodMinutes: 8, onCourt: 5, available: 10 })
    expect(plan).toMatchObject({ shifts: 4, shiftMinutes: 8, minutesEach: 16, even: true })
  })

  it('has nobody to sub when everyone fits on court', () => {
    const plan = recommendShift({ ...halves, available: 5 })
    expect(plan.noSubs).toBe(true)
    expect(plan.minutesEach).toBe(40)
  })
})
