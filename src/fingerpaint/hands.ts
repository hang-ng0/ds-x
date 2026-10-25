import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { Dwell } from './dwell'
import { GestureTrigger } from './gestures'
import { PenTracker, WRIST, type HandState, type Point } from './hand'

export const MAX_HANDS = 2
// A detection farther than this (in camera widths) from a hand's last wrist position is a different hand
const MAX_MATCH_DISTANCE = 0.25

/** Everything that belongs to one tracked hand. Two kids each get their own. */
export class HandSlot {
  id: number
  tracker = new PenTracker()
  dwell = new Dwell()
  trigger = new GestureTrigger()
  /** Last frame's state, for drawing */
  hand: HandState | null = null
  painting = false
  prevPrint: Point[] | null = null
  firedAt = -Infinity
  firedLabel = ''
  wrist: NormalizedLandmark | null = null
  /** Whether a pointing-at-UI check put this hand over a button last frame */
  overUi = false

  constructor(id: number) {
    this.id = id
  }

  /** Stroke ids in the painter are per hand so two hands' index fingers don't share a stroke. */
  strokeId(finger: string) {
    return `${this.id}:${finger}`
  }
}

/**
 * MediaPipe doesn't keep hands in a stable order between frames, so match each detection to the slot
 * whose hand was last seen nearest to it. Returns, for each slot, the index of its detection or null.
 */
export function assignHands(slots: HandSlot[], detections: NormalizedLandmark[][]): (number | null)[] {
  const assignment: (number | null)[] = slots.map(() => null)
  const taken = new Set<number>()
  const pairs: { slot: number; det: number; d: number }[] = []
  slots.forEach((slot, i) => {
    if (!slot.wrist) return
    detections.forEach((lm, j) => {
      pairs.push({ slot: i, det: j, d: Math.hypot(lm[WRIST].x - slot.wrist!.x, lm[WRIST].y - slot.wrist!.y) })
    })
  })
  pairs.sort((a, b) => a.d - b.d)
  for (const { slot, det, d } of pairs) {
    if (d > MAX_MATCH_DISTANCE || assignment[slot] !== null || taken.has(det)) continue
    assignment[slot] = det
    taken.add(det)
  }
  // New hands go into free slots
  detections.forEach((_, j) => {
    if (taken.has(j)) return
    const free = assignment.findIndex((a, i) => a === null && !slots[i].wrist)
    const fallback = free === -1 ? assignment.findIndex((a) => a === null) : free
    if (fallback === -1) return
    assignment[fallback] = j
    taken.add(j)
  })
  slots.forEach((slot, i) => {
    slot.wrist = assignment[i] === null ? null : detections[assignment[i]!][WRIST]
  })
  return assignment
}
