export type PenMode = 'reach' | 'pinch' | 'gesture'

/**
 * How reach is measured. `relative`: against the hand's own recent resting size, so posture changes
 * don't matter. `fixed`: against the far/near palm sizes captured by calibration.
 */
export type ReachStyle = 'relative' | 'fixed'

/** What part of the hand paints. `auto` picks one of the others from the hand shape. */
export type Tool = 'pointer' | 'fingers' | 'palm' | 'auto'
export type BrushKind = Exclude<Tool, 'auto'>

export type GestureModel = 'builtin' | 'custom'

/** What a recognized gesture does. `penDown` holds the pen down while shown (in "gesture" pen mode). */
export type GestureAction =
  | 'none'
  | 'penDown'
  | 'undo'
  | 'clear'
  | 'nextColor'
  | 'eraser'
  | `tool:${Tool}`
  | `color:${string}`
  | `brush:${number}`

export type Settings = {
  mode: PenMode
  reachStyle: ReachStyle
  // Relative reach: pen goes down when the hand looks `pushAmount` bigger than at rest (0.15 = 15%),
  // lifts `pushGap` below that. The resting size follows the hand over about `adaptSeconds`.
  pushAmount: number
  pushGap: number
  adaptSeconds: number
  // Fixed reach: palm size (fraction of camera width) at a relaxed and a reaching distance
  far: number
  near: number
  // Fixed reach: pen goes down at this fraction of the way from far to near, lifts `gap` below it
  pressAt: number
  gap: number
  // Pinch mode: thumb–index distance divided by palm size
  pinchPress: number
  pinchGap: number
  // Consecutive frames required before the pen changes state
  pressFrames: number
  liftFrames: number
  // Cursor One-Euro filter: lower minCutoff = steadier but laggier, higher beta = less lag when moving fast
  minCutoff: number
  beta: number
  // 0 = raw palm size, closer to 1 = heavier smoothing of the depth signal
  depthSmoothing: number
  // Fraction of the camera frame mapped to the full screen, so kids don't have to reach the edges
  activeArea: number
  pressure: boolean
  // Handprint brush thickness, relative to the palm
  handprint: number
  // Each stroke's opacity; below 1, overlapping strokes build up so you can shade
  paintOpacity: number
  showSkeleton: boolean
  showHud: boolean
  minDetect: number
  twoHands: boolean
  gestureModel: GestureModel
  // A gesture counts only above this classifier score, and must be held this long before its action fires
  gestureMinScore: number
  gestureHoldMs: number
  /** Gesture label (as the model reports it) → action */
  gestureActions: Record<string, GestureAction>
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'reach',
  reachStyle: 'relative',
  pushAmount: 0.15,
  pushGap: 0.06,
  adaptSeconds: 3,
  far: 0.15,
  near: 0.25,
  pressAt: 0.7,
  gap: 0.12,
  pinchPress: 0.35,
  pinchGap: 0.15,
  pressFrames: 2,
  liftFrames: 3,
  minCutoff: 1.2,
  beta: 0.015,
  depthSmoothing: 0.6,
  activeArea: 0.8,
  pressure: true,
  handprint: 1,
  paintOpacity: 0.5,
  showSkeleton: true,
  showHud: true,
  minDetect: 0.4,
  twoHands: true,
  gestureModel: 'builtin',
  gestureMinScore: 0.6,
  gestureHoldMs: 600,
  gestureActions: {},
}

const STORAGE_KEY = 'fingerpaint-settings'

export function loadSettings(): Settings {
  const settings = { ...DEFAULT_SETTINGS }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      if (saved[key] !== null && typeof saved[key] === typeof settings[key]) {
        Object.assign(settings, { [key]: saved[key] })
      }
    }
  } catch {
    // Storage blocked or corrupt: fall back to defaults
  }
  return settings
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: settings just won't persist
  }
}
