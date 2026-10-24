export type PenMode = 'reach' | 'pinch'

export type Settings = {
  mode: PenMode
  // Reach mode: palm size (fraction of camera width) at a relaxed and a reaching distance
  far: number
  near: number
  // Reach mode: pen goes down at this fraction of the way from far to near, lifts `gap` below it
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
  videoOpacity: number
  showSkeleton: boolean
  showHud: boolean
  minDetect: number
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'reach',
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
  videoOpacity: 0.3,
  showSkeleton: false,
  showHud: true,
  minDetect: 0.4,
}

const STORAGE_KEY = 'fingerpaint-settings'

export function loadSettings(): Settings {
  const settings = { ...DEFAULT_SETTINGS }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const key of Object.keys(settings) as (keyof Settings)[]) {
      if (typeof saved[key] === typeof settings[key]) {
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
