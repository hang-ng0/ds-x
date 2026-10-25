export type PenMode = 'reach' | 'pinch' | 'gesture'

/**
 * How reach is measured. `relative`: against the hand's own recent resting size, so posture changes
 * don't matter. `fixed`: against the far/near palm sizes captured by calibration.
 */
export type ReachStyle = 'relative' | 'fixed'

/**
 * Feel settings each pen-down mode keeps for itself, so tuning one mode (and its preset) doesn't
 * change another.
 */
export type ModeTuning = {
  // Consecutive frames required before the pen changes state
  pressFrames: number
  liftFrames: number
  // Cursor One-Euro filter: lower minCutoff = steadier but laggier, higher beta = less lag when moving fast
  minCutoff: number
  beta: number
}

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
  // Pinch mode: lift immediately once the fingers open faster than this (pinch units per second; 0 = off)
  pinchOpenSpeed: number
  /** Timing and smoothing, kept separately for each pen-down mode */
  modeTuning: Record<PenMode, ModeTuning>
  // 0 = raw palm size, closer to 1 = heavier smoothing of the depth signal
  depthSmoothing: number
  // Fraction of the camera frame mapped to the full screen, so kids don't have to reach the edges
  activeArea: number
  // Moves the active area from the middle (0) toward the top (1) of the camera image, so the palm
  // stays in view when the fingertip reaches the bottom of the paper
  areaShiftUp: number
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

// Tuned for a smooth first experience: a gentle push to paint, crisp lifts, steady lines, vivid paint
export const DEFAULT_SETTINGS: Settings = {
  mode: 'reach',
  reachStyle: 'relative',
  // A 12% push is a small, comfortable reach; the 5% gap still sits well above palm-size jitter
  pushAmount: 0.12,
  pushGap: 0.05,
  adaptSeconds: 3,
  far: 0.15,
  near: 0.25,
  pressAt: 0.7,
  gap: 0.12,
  // A narrow gap plus lift-on-opening, so opening the hand ends the stroke right away
  pinchPress: 0.35,
  pinchGap: 0.08,
  pinchOpenSpeed: 1.5,
  modeTuning: {
    // Reach: depth from hand size is noisy, so wait a couple of frames each way; steady cursor
    reach: { pressFrames: 2, liftFrames: 3, minCutoff: 1, beta: 0.02 },
    // Pinch: fingertips touching is a crisp, deliberate signal, so start on the first frame (lifting is
    // already immediate) and keep the cursor more responsive for detailed drawing
    pinch: { pressFrames: 1, liftFrames: 1, minCutoff: 1.4, beta: 0.03 },
    // Gesture: the classifier's label flickers, so require it for longer before starting or stopping
    gesture: { pressFrames: 3, liftFrames: 4, minCutoff: 1, beta: 0.02 },
  },
  depthSmoothing: 0.6,
  activeArea: 0.7,
  areaShiftUp: 0.9,
  // Off: width following a noisy depth signal makes lines look wobbly
  pressure: false,
  handprint: 1,
  // Bright enough to look like real paint, still see-through enough to shade with a second pass
  paintOpacity: 0.7,
  showSkeleton: true,
  showHud: true,
  minDetect: 0.4,
  twoHands: true,
  gestureModel: 'builtin',
  // Fewer accidental actions while kids are just painting
  gestureMinScore: 0.7,
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
    // Merge each mode's profile over its preset, so a value added later still gets its default
    settings.modeTuning = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.modeTuning).map(([mode, preset]) => [
        mode,
        { ...preset, ...(saved.modeTuning?.[mode] ?? {}) },
      ]),
    ) as Settings['modeTuning']
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
