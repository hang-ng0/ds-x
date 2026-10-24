import { GestureRecognizer, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { OneEuroFilter } from './oneEuro'
import type { BrushKind, GestureModel, Settings, Tool } from './settings'

// Self-hosted so no camera-adjacent requests leave the machine at runtime.
// The custom model is the output of training/train_gestures.py.
export const MODEL_PATHS: Record<GestureModel, string> = {
  builtin: `${import.meta.env.BASE_URL}models/gesture_recognizer.task`,
  custom: `${import.meta.env.BASE_URL}models/custom_gesture_recognizer.task`,
}

export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_MCP = 5
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const PINKY_MCP = 17

export const HAND_CONNECTIONS = GestureRecognizer.HAND_CONNECTIONS
/** Outline of the palm, used to fill the handprint */
export const PALM = [0, 1, 5, 9, 13, 17]
/** Fingertip and middle (PIP) joint for each finger; the thumb uses its IP joint */
export const FINGERS = [
  { name: 'thumb', tip: 4, pip: 3 },
  { name: 'index', tip: 8, pip: 6 },
  { name: 'middle', tip: 12, pip: 10 },
  { name: 'ring', tip: 16, pip: 14 },
  { name: 'pinky', tip: 20, pip: 18 },
]

// Handprint line thickness as a fraction of palm size (scaled by the `handprint` setting).
// Not scaled by reach depth: the print already grows as the hand gets closer.
const HANDPRINT_THICKNESS = 0.22
// Frames a new hand shape must hold before Auto switches brush
const KIND_FRAMES = 4

export async function createRecognizer(model: GestureModel, minConfidence: number, numHands: number) {
  // Fetch it ourselves: a missing file would otherwise get the dev server's index.html
  const res = await fetch(MODEL_PATHS[model])
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`Model not found at public${MODEL_PATHS[model].slice(import.meta.env.BASE_URL.length - 1)}`)
  }
  const modelAssetBuffer = new Uint8Array(await res.arrayBuffer())
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetBuffer, delegate },
    runningMode: 'VIDEO' as const,
    numHands,
    minHandDetectionConfidence: minConfidence,
    minHandPresenceConfidence: minConfidence,
    minTrackingConfidence: minConfidence,
  })
  const fileset = { wasmLoaderPath, wasmBinaryPath }
  try {
    return await GestureRecognizer.createFromOptions(fileset, options('GPU'))
  } catch {
    return GestureRecognizer.createFromOptions(fileset, options('CPU'))
  }
}

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

/** Where the (mirrored, zoomed) camera image lands in client pixels. */
export type View = Rect

// Covers `area` with the camera image (keeping its aspect), zoomed so only the central
// `activeArea` fraction of the camera maps onto it
export function computeView(videoW: number, videoH: number, area: Rect, activeArea: number): View {
  const s = Math.max(area.w / videoW, area.h / videoH) / activeArea
  const w = videoW * s
  const h = videoH * s
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h }
}

export function toScreen(p: NormalizedLandmark | Point, view: View): Point {
  return { x: view.x + (1 - p.x) * view.w, y: view.y + p.y * view.h }
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number) {
  return Math.hypot(a.x - b.x, (a.y - b.y) / aspect)
}

/**
 * Apparent palm size as a fraction of the camera width: bigger = closer to the camera.
 * The max of palm length and palm width stays fairly stable as the hand rotates.
 */
export function palmSize(lm: NormalizedLandmark[], aspect: number) {
  return Math.max(dist(lm[WRIST], lm[MIDDLE_MCP], aspect), dist(lm[INDEX_MCP], lm[PINKY_MCP], aspect))
}

/** Which fingers are held out, in FINGERS order. */
export function extendedFingers(lm: NormalizedLandmark[], aspect: number, palm: number) {
  return FINGERS.map(({ tip, pip }, i) =>
    i === 0
      ? // Thumb: tip well away from the index knuckle
        dist(lm[THUMB_TIP], lm[INDEX_MCP], aspect) > 0.55 * palm
      : // Finger: tip farther from the wrist than its middle joint (a curled tip folds back in)
        dist(lm[tip], lm[WRIST], aspect) > dist(lm[pip], lm[WRIST], aspect) * 1.1,
  )
}

/** Auto brush: one finger = pointer, two or three = fingers, open hand = handprint. */
export function kindFromShape(extended: boolean[]): BrushKind {
  const n = extended.slice(1).filter(Boolean).length
  if (n <= 1) return 'pointer'
  if (n <= 3) return 'fingers'
  return 'palm'
}

export type HandState = {
  /** All 21 landmarks, smoothed, in client pixels */
  points: Point[]
  /** The point used for hovering buttons and the main cursor */
  cursor: Point
  kind: BrushKind
  extended: boolean[]
  down: boolean
  /** 0 = hand relaxed / open, 1 = right at the press threshold (drives the cursor ring) */
  press: number
  /** Fixed reach: 0 at the "far" calibration, 1 at "near" */
  depth: number
  /** Relative reach: how much bigger the hand looks than at rest (0.15 = 15%) */
  push: number
  /** Raw palm size, before smoothing (used by calibration) */
  palm: number
  pinch: number
  /** Brush width multiplier from reach depth */
  widthScale: number
  /** Handprint line thickness in pixels */
  printWidth: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Turns raw landmarks into smoothed points, a brush kind, and a debounced pen-up/pen-down state. */
export class PenTracker {
  private fx = Array.from({ length: 21 }, () => new OneEuroFilter(1, 0))
  private fy = Array.from({ length: 21 }, () => new OneEuroFilter(1, 0))
  private palm: number | null = null
  private rest: number | null = null
  private lastTime = 0
  private down = false
  private pending = 0
  private kind: BrushKind = 'pointer'
  private kindCandidate: BrushKind = 'pointer'
  private kindCount = 0

  /** `gesturePen`: whether a gesture mapped to "Pen down" is showing (used in gesture pen mode) */
  update(lm: NormalizedLandmark[] | null, timeMs: number, s: Settings, tool: Tool, gesturePen: boolean, view: View, bounds: Rect): HandState | null {
    if (!lm) {
      this.reset()
      return null
    }
    const aspect = view.w / view.h
    const rawPalm = palmSize(lm, aspect)
    this.palm = this.palm === null ? rawPalm : this.palm + (1 - s.depthSmoothing) * (rawPalm - this.palm)
    const extended = extendedFingers(lm, aspect, rawPalm)

    // The brush is locked while painting so a stroke never changes type halfway through
    if (!this.down) this.updateKind(tool === 'auto' ? kindFromShape(extended) : tool, tool === 'auto')

    // Resting size: follows the hand while the pen is up and holds still while painting. It catches up
    // quickly when the hand pulls back, slowly when it approaches, and barely at all once the hand is
    // halfway into a push, so a deliberate push isn't absorbed before it reaches the press point.
    const dt = this.rest === null ? 0 : Math.max(timeMs - this.lastTime, 0) / 1000
    this.lastTime = timeMs
    if (this.rest === null) {
      this.rest = this.palm
    } else if (!this.down) {
      const growth = this.palm / this.rest - 1
      const timeConstant =
        growth < 0 ? s.adaptSeconds / 10 : growth > s.pushAmount / 2 ? s.adaptSeconds * 5 : s.adaptSeconds
      this.rest += (this.palm - this.rest) * (1 - Math.exp(-dt / timeConstant))
    }
    const push = this.palm / this.rest - 1

    const depth = (this.palm - s.far) / Math.max(s.near - s.far, 1e-3)
    const pinch = dist(lm[THUMB_TIP], lm[INDEX_TIP], aspect) / rawPalm
    // Pinching changes the hand shape, so only the pointer can use it
    const mode = s.mode === 'pinch' && this.kind !== 'pointer' ? 'reach' : s.mode

    let press: number
    let pastPress: boolean
    let pastRelease: boolean
    if (mode === 'gesture') {
      press = gesturePen ? 1 : 0.3
      pastPress = gesturePen
      pastRelease = !gesturePen
    } else if (mode === 'reach') {
      const [value, at, release] =
        s.reachStyle === 'relative' ? [push, s.pushAmount, s.pushAmount - s.pushGap] : [depth, s.pressAt, s.pressAt - s.gap]
      press = value / at
      pastPress = value >= at
      pastRelease = value < release
    } else {
      press = (1 - pinch) / (1 - s.pinchPress)
      pastPress = pinch <= s.pinchPress
      pastRelease = pinch > s.pinchPress + s.pinchGap
    }

    const want = this.down ? !pastRelease : pastPress
    if (want !== this.down) {
      this.pending++
      if (this.pending >= (want ? s.pressFrames : s.liftFrames)) {
        this.down = want
        this.pending = 0
      }
    } else {
      this.pending = 0
    }

    const points = lm.map((p, i) => {
      const target = toScreen(p, view)
      for (const f of [this.fx[i], this.fy[i]]) {
        f.minCutoff = s.minCutoff
        f.beta = s.beta
      }
      return { x: this.fx[i].filter(target.x, timeMs), y: this.fy[i].filter(target.y, timeMs) }
    })

    let cursor: Point
    if (this.kind === 'palm') {
      const palmPts = [WRIST, INDEX_MCP, MIDDLE_MCP, PINKY_MCP].map((i) => points[i])
      cursor = { x: palmPts.reduce((a, p) => a + p.x, 0) / 4, y: palmPts.reduce((a, p) => a + p.y, 0) / 4 }
    } else if (this.kind === 'pointer' && mode === 'pinch') {
      // The index tip moves toward the thumb as you pinch; the midpoint stays put
      cursor = mid(points[THUMB_TIP], points[INDEX_TIP])
    } else {
      cursor = points[INDEX_TIP]
    }
    cursor = {
      x: clamp(cursor.x, bounds.x, bounds.x + bounds.w),
      y: clamp(cursor.y, bounds.y, bounds.y + bounds.h),
    }

    // Reaching past the press point thickens the line
    const widthScale = mode === 'reach' && s.pressure ? clamp(0.7 + (press - 1) * 1.75, 0.5, 1.8) : 1
    return {
      points,
      cursor,
      kind: this.kind,
      extended,
      down: this.down,
      press: clamp(press, 0, 1.2),
      depth,
      push,
      palm: rawPalm,
      pinch,
      widthScale,
      printWidth: this.palm * view.w * HANDPRINT_THICKNESS * s.handprint,
    }
  }

  private updateKind(kind: BrushKind, debounce: boolean) {
    if (!debounce || kind === this.kind) {
      this.kind = kind
      this.kindCount = 0
    } else if (kind === this.kindCandidate) {
      if (++this.kindCount >= KIND_FRAMES) this.kind = kind
    } else {
      this.kindCandidate = kind
      this.kindCount = 1
    }
  }

  reset() {
    for (const f of [...this.fx, ...this.fy]) f.reset()
    this.palm = null
    this.rest = null
    this.down = false
    this.pending = 0
    this.kindCount = 0
  }
}
