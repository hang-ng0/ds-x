// Distances are in torso lengths (shoulders to hips) and speeds in torso lengths per second, so the
// same thresholds work for a small kid close to the camera and a tall one far away.

export type PoseModel = 'lite' | 'full'

/**
 * Dark: glowing neon ink that brightens where it overlaps. White: clean white paper with softer colors.
 * Light: ink soaking into rice paper.
 */
export type PaperStyle = 'dark' | 'white' | 'light'

export type InkSettings = {
  model: PoseModel
  // Multiplies every speed and distance threshold below: higher = only bigger, faster moves count
  moveSize: number
  // An arm or leg starts a move when its hand/foot moves faster than this across the screen
  slashSpeed: number
  kickSpeed: number
  // A swoosh must sweep the hand at least this far
  slashLength: number
  // A punch: the arm straightens this fast (including toward the camera) and by at least this much
  punchSpeed: number
  punchExtend: number
  // A kick must lift the foot at least this far above where it rests
  kickLift: number
  // A jump: the hips rise at least this far above standing height
  jumpHeight: number
  // An arm wave (flap): both hands, out to the sides, move up or down together at least this fast
  flapSpeed: number
  // A head shake: the head swings side to side at least this far, several times in about a second
  shakeSwing: number
  // Crossing the forearms in an X and holding still this long clears the painting
  xClear: boolean
  clearHoldSeconds: number
  // A short pause per limb after a move, so one punch doesn't fire twice
  cooldownMs: number
  // Ignore hands/feet MediaPipe isn't confident it can see (e.g. off the bottom of the camera)
  minVisibility: number
  // Fraction of the camera image mapped onto the paper; smaller = moves near the body still reach the edges
  activeArea: number
  // Ink look
  paper: PaperStyle
  inkScale: number
  splatter: number
  drips: boolean
  inkOpacity: number
  // How much slower movement fades the paint (dimmer on dark paper, paler on light): 0 = off, 1 = full
  speedGradient: number
  showSkeleton: boolean
  showHud: boolean
}

// Tuned to react only to big, deliberate moves: fidgeting, gesturing and shifting weight shouldn't paint
export const DEFAULT_INK_SETTINGS: InkSettings = {
  // The accurate model's landmarks jitter much less, which matters more here than its small extra cost
  model: 'full',
  moveSize: 1,
  slashSpeed: 4.5,
  kickSpeed: 4,
  slashLength: 1,
  // Punches are a bit easier than other moves: from a distance the arm looks small and its depth is rough
  punchSpeed: 3,
  punchExtend: 0.32,
  kickLift: 0.55,
  jumpHeight: 0.22,
  flapSpeed: 3.5,
  shakeSwing: 0.12,
  xClear: true,
  clearHoldSeconds: 2.5,
  cooldownMs: 400,
  minVisibility: 0.65,
  activeArea: 0.85,
  paper: 'dark',
  inkScale: 1,
  splatter: 1,
  drips: true,
  inkOpacity: 0.95,
  speedGradient: 0.85,
  showSkeleton: true,
  showHud: true,
}

// Bumped when the defaults change a lot, so earlier saved tuning doesn't hide them
const STORAGE_KEY = 'inkdojo-settings-v3'

export function loadInkSettings(): InkSettings {
  const settings = { ...DEFAULT_INK_SETTINGS }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const key of Object.keys(settings) as (keyof InkSettings)[]) {
      if (saved[key] !== null && typeof saved[key] === typeof settings[key]) {
        Object.assign(settings, { [key]: saved[key] })
      }
    }
  } catch {
    // Storage blocked or corrupt: fall back to defaults
  }
  return settings
}

export function saveInkSettings(settings: InkSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: settings just won't persist
  }
}
