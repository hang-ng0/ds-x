import { GestureRecognizer, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { OneEuroFilter } from './oneEuro'
import type { Settings } from './settings'

// Self-hosted so no camera-adjacent requests leave the machine at runtime
const MODEL_PATH = `${import.meta.env.BASE_URL}models/gesture_recognizer.task`

export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_MCP = 5
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const PINKY_MCP = 17

export async function createRecognizer(minConfidence: number) {
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 1,
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

/** Where the (mirrored, zoomed) camera image sits on screen, in CSS pixels. */
export type View = { x: number; y: number; w: number; h: number }

// Matches the video's CSS: object-fit: cover, then scale(1 / activeArea) about the center
export function computeView(videoW: number, videoH: number, screenW: number, screenH: number, activeArea: number): View {
  const s = Math.max(screenW / videoW, screenH / videoH) / activeArea
  const w = videoW * s
  const h = videoH * s
  return { x: (screenW - w) / 2, y: (screenH - h) / 2, w, h }
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

export type PenState = Point & {
  down: boolean
  /** 0 = hand relaxed / open, 1 = right at the press threshold (drives the cursor ring) */
  press: number
  /** Reach mode: 0 at the "far" calibration, 1 at "near" */
  depth: number
  /** Raw palm size, before smoothing (used by calibration) */
  palm: number
  pinch: number
  /** Brush width multiplier from reach depth */
  widthScale: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Turns raw landmarks into a smoothed cursor plus a debounced pen-up/pen-down state. */
export class PenTracker {
  private fx = new OneEuroFilter(1, 0)
  private fy = new OneEuroFilter(1, 0)
  private palm: number | null = null
  private down = false
  private pending = 0

  update(lm: NormalizedLandmark[] | null, timeMs: number, s: Settings, view: View, screenW: number, screenH: number): PenState | null {
    if (!lm) {
      this.reset()
      return null
    }
    const aspect = view.w / view.h
    const rawPalm = palmSize(lm, aspect)
    this.palm = this.palm === null ? rawPalm : this.palm + (1 - s.depthSmoothing) * (rawPalm - this.palm)

    const depth = (this.palm - s.far) / Math.max(s.near - s.far, 1e-3)
    const pinch = dist(lm[THUMB_TIP], lm[INDEX_TIP], aspect) / rawPalm

    let press: number
    let pastPress: boolean
    let pastRelease: boolean
    if (s.mode === 'reach') {
      press = depth / s.pressAt
      pastPress = depth >= s.pressAt
      pastRelease = depth < s.pressAt - s.gap
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

    // In pinch mode the index tip moves toward the thumb as you pinch; the midpoint stays put
    const anchor = s.mode === 'pinch'
      ? { x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2 }
      : lm[INDEX_TIP]
    const target = toScreen(anchor, view)
    for (const f of [this.fx, this.fy]) {
      f.minCutoff = s.minCutoff
      f.beta = s.beta
    }

    return {
      x: clamp(this.fx.filter(target.x, timeMs), 0, screenW),
      y: clamp(this.fy.filter(target.y, timeMs), 0, screenH),
      down: this.down,
      press: clamp(press, 0, 1.2),
      depth,
      palm: rawPalm,
      pinch,
      widthScale: s.mode === 'reach' && s.pressure ? clamp(0.7 + (depth - s.pressAt) * 2.5, 0.5, 1.8) : 1,
    }
  }

  reset() {
    this.fx.reset()
    this.fy.reset()
    this.palm = null
    this.down = false
    this.pending = 0
  }
}
