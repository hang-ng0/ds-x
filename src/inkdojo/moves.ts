import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { OneEuroFilter } from '../fingerpaint/oneEuro'
import { P } from './pose'
import type { InkSettings } from './settings'

export type MoveKind = 'punch' | 'slash' | 'kick' | 'jump' | 'wave' | 'shake' | 'clear'
export type LimbName = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'

/** A camera position in MediaPipe's normalized, unmirrored coordinates (map with `toScreen`). */
export type CamPoint = { x: number; y: number }

export type Move = {
  kind: MoveKind
  limb: LimbName | 'body'
  /** Hand or foot path for slashes and kicks; both hands for an arm wave */
  path: CamPoint[]
  /** Where a punch landed, the hips for a jump, the head for a shake */
  at: CamPoint
  /** Direction of travel as seen on screen (mirrored), unit length; zero for a punch straight at the camera */
  dir: { x: number; y: number }
  /** 1 = just past the threshold, up to 3 for a big move */
  power: number
  /** Slashes and kicks: speed at each path point, as a multiple of the move's speed threshold */
  speeds?: number[]
}

export type LimbDebug = {
  limb: LimbName
  at: CamPoint | null
  speed: number
  /** Velocity relative to the body, in torso lengths per second (screen orientation: +y is down) */
  vel: { x: number; y: number }
  /** Hand/foot position relative to the body (shoulders or hips), in torso lengths */
  rel: { x: number; y: number }
  extRate: number
  lift: number
  moving: boolean
  trail: CamPoint[]
}
export type DetectorDebug = {
  limbs: LimbDebug[]
  rise: number
  airborne: boolean
  torso: number
  feetVisible: boolean
  headSwings: number
  /** Arms crossed in an X: where (between the hands) and how far along the hold to clear is (0–1) */
  clear: { at: CamPoint; progress: number } | null
}

type LimbDef = { name: LimbName; arm: boolean; root: number; mid: number; end: number }
const LIMBS: LimbDef[] = [
  { name: 'leftArm', arm: true, root: P.leftShoulder, mid: P.leftElbow, end: P.leftWrist },
  { name: 'rightArm', arm: true, root: P.rightShoulder, mid: P.rightElbow, end: P.rightWrist },
  { name: 'leftLeg', arm: false, root: P.leftHip, mid: P.leftKnee, end: P.leftAnkle },
  { name: 'rightLeg', arm: false, root: P.rightHip, mid: P.rightKnee, end: P.rightAnkle },
]

const HISTORY_MS = 600
// Speeds are measured over roughly this window: about three frames, enough to average out landmark jitter
const SPEED_WINDOW_MS = 100
// Hand/foot smoothing (One-Euro): steady enough that a still or fidgeting hand reads as still, while
// big fast moves still come through with only a little lag
const SMOOTH_CUTOFF = 2
const SMOOTH_BETA = 0.3
const MAX_MOVE_MS = 700
const TRAIL_MS = 220

/**
 * "Screen space": mirrored like the preview, with y rescaled to width units so distances are the same
 * in every direction, plus MediaPipe's rough depth (z, smaller = closer to the camera). `rx`/`ry` are the
 * same position relative to the body (shoulders for hands, hips for feet), so jumping, leaning or
 * stepping around doesn't look like an arm or leg move.
 */
type Sample = { t: number; X: number; Y: number; Z: number; rx: number; ry: number; ext: number; speed: number; raw: CamPoint }
type Motion = { samples: Sample[]; peakSpeed: number; peakExtRate: number; maxLift: number; heading: { x: number; y: number } | null }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const emptyDebug = (limb: LimbName): LimbDebug => ({ limb, at: null, speed: 0, vel: { x: 0, y: 0 }, rel: { x: 0, y: 0 }, extRate: 0, lift: 0, moving: false, trail: [] })
const dist2 = (a: { X: number; Y: number }, b: { X: number; Y: number }) => Math.hypot(a.X - b.X, a.Y - b.Y)
const relDist = (a: Sample, b: Sample) => Math.hypot(a.rx - b.rx, a.ry - b.ry)
const dist3 = (a: Sample, b: Sample) => Math.hypot(a.rx - b.rx, a.ry - b.ry, a.Z - b.Z)

/** Follows one arm or leg and reports a move when a fast motion of it ends. */
class LimbTracker {
  def: LimbDef
  private fx = new OneEuroFilter(SMOOTH_CUTOFF, SMOOTH_BETA)
  private fy = new OneEuroFilter(SMOOTH_CUTOFF, SMOOTH_BETA)
  private fz = new OneEuroFilter(SMOOTH_CUTOFF, SMOOTH_BETA)
  private history: Sample[] = []
  private motion: Motion | null = null
  private cooldownUntil = 0
  private restRY: number | null = null
  debug: LimbDebug

  constructor(def: LimbDef) {
    this.def = def
    this.debug = emptyDebug(def.name)
  }

  reset() {
    for (const f of [this.fx, this.fy, this.fz]) f.reset()
    this.history = []
    this.motion = null
    this.restRY = null
    this.debug = emptyDebug(this.def.name)
  }

  /** Drop any motion in progress and ignore this limb until `until` (a two-arm move used it) */
  hold(until: number) {
    this.motion = null
    this.cooldownUntil = Math.max(this.cooldownUntil, until)
  }

  /** `anchor`: the body point this limb moves relative to (shoulders or hips), in screen space */
  update(lm: NormalizedLandmark[], t: number, aspect: number, torso: number, anchor: { X: number; Y: number }, s: InkSettings, suppress: boolean): Move | null {
    const { arm, root, end } = this.def
    if ((lm[end].visibility ?? 1) < s.minVisibility || (lm[root].visibility ?? 1) < s.minVisibility) {
      this.reset()
      return null
    }
    const X = this.fx.filter(1 - lm[end].x, t)
    const Y = this.fy.filter(lm[end].y / aspect, t)
    const Z = this.fz.filter(lm[end].z, t)
    const r = lm[root]
    const ext = Math.hypot(X - (1 - r.x), Y - r.y / aspect, Z - r.z) / torso
    const sample: Sample = { t, X, Y, Z, rx: X - anchor.X, ry: Y - anchor.Y, ext, speed: 0, raw: { x: 1 - X, y: Y * aspect } }
    this.history.push(sample)
    while (this.history.length && t - this.history[0].t > HISTORY_MS) this.history.shift()

    const ref = this.history.find((h) => t - h.t <= SPEED_WINDOW_MS) ?? sample
    const dt = (t - ref.t) / 1000
    const speed = dt > 0 ? relDist(sample, ref) / dt / torso : 0
    sample.speed = speed
    const extRate = dt > 0 ? (ext - ref.ext) / dt : 0
    const velocity = { x: sample.rx - ref.rx, y: sample.ry - ref.ry }

    // Legs: learn where the foot rests (relative to the hips) so a kick is measured by how high it rises
    if (!arm && !this.motion && speed < s.kickSpeed * 0.3) {
      this.restRY = this.restRY === null ? sample.ry : this.restRY + (sample.ry - this.restRY) * 0.05
    }
    const lift = this.restRY === null ? 0 : (this.restRY - sample.ry) / torso

    this.debug = {
      limb: this.def.name,
      at: sample.raw,
      speed,
      vel: dt > 0 ? { x: velocity.x / dt / torso, y: velocity.y / dt / torso } : { x: 0, y: 0 },
      rel: { x: sample.rx / torso, y: sample.ry / torso },
      extRate,
      lift,
      moving: !!this.motion,
      trail: this.history.filter((h) => t - h.t <= TRAIL_MS).map((h) => h.raw),
    }

    const startSpeed = arm ? s.slashSpeed : s.kickSpeed
    if (!this.motion) {
      const fast = speed > startSpeed || (arm && extRate > s.punchSpeed)
      if (!fast || suppress || t < this.cooldownUntil) return null
      // Include the frames just before the threshold so the stroke starts where the motion did
      this.motion = {
        samples: this.history.filter((h) => t - h.t <= 2 * SPEED_WINDOW_MS),
        peakSpeed: speed,
        peakExtRate: extRate,
        maxLift: lift,
        heading: null,
      }
      return null
    }

    const m = this.motion
    m.samples.push(sample)
    m.peakSpeed = Math.max(m.peakSpeed, speed)
    m.peakExtRate = Math.max(m.peakExtRate, extRate)
    m.maxLift = Math.max(m.maxLift, lift)
    if (suppress) {
      this.motion = null
      return null
    }
    const duration = t - m.samples[0].t
    if (!m.heading && duration > SPEED_WINDOW_MS) m.heading = normalize(velocity)
    const v = normalize(velocity)
    // A swoosh ends when the hand turns back, so waving back and forth paints one slash per swing
    const reversed = arm && m.heading !== null && speed > startSpeed * 0.5 && v.x * m.heading.x + v.y * m.heading.y < -0.3
    // A kick ends at the top, so its stroke is the rising arc rather than up-and-back-down
    const pastApex = !arm && m.maxLift > s.kickLift && lift < m.maxLift * 0.7
    const slowed = speed < startSpeed * 0.45 && extRate < s.punchSpeed * 0.45
    if (!slowed && !reversed && !pastApex && duration < MAX_MOVE_MS) return null

    this.motion = null
    const move = arm ? this.classifyArm(m, s, torso, lm, aspect) : this.classifyLeg(m, s, torso)
    // Punches and kicks get a cooldown so one doesn't fire twice; swooshes chain freely
    if (move && move.kind !== 'slash') this.cooldownUntil = t + s.cooldownMs
    if (reversed) {
      // The return swing starts a new motion right away
      this.motion = { samples: [m.samples[m.samples.length - 2] ?? sample, sample], peakSpeed: speed, peakExtRate: extRate, maxLift: lift, heading: v }
    }
    return move
  }

  private classifyArm(m: Motion, s: InkSettings, torso: number, lm: NormalizedLandmark[], aspect: number): Move | null {
    const first = m.samples[0]
    const last = m.samples[m.samples.length - 1]
    let pathLen = 0
    let pathLen3 = 0
    for (let i = 1; i < m.samples.length; i++) {
      pathLen += relDist(m.samples[i], m.samples[i - 1])
      pathLen3 += dist3(m.samples[i], m.samples[i - 1])
    }
    const extGain = Math.max(...m.samples.map((x) => x.ext)) - first.ext
    // How much of the movement went outward from the shoulder (1 = all of it). Punches are outward;
    // sweeps mostly go around.
    const outward = pathLen3 > 0 ? (extGain * torso) / pathLen3 : 0

    // Punch: the arm shoots out (sideways, up, or straight at the camera) and ends mostly straight.
    // The outward and elbow checks are lenient because depth (z) is rough for arms aimed at the camera,
    // especially from a distance.
    if (m.peakExtRate > s.punchSpeed && extGain > s.punchExtend && outward > 0.45 && elbowAngle(lm, this.def, aspect) > 110) {
      let dir = { x: last.X - first.X, y: last.Y - first.Y }
      if (Math.hypot(dir.x, dir.y) / torso < 0.15) {
        // Mostly toward the camera: splatter outward from the shoulder's side
        const sh = lm[this.def.root]
        dir = { x: last.X - (1 - sh.x), y: last.Y - sh.y / aspect }
      }
      return {
        kind: 'punch',
        limb: this.def.name,
        path: m.samples.map((x) => x.raw),
        at: last.raw,
        dir: normalize(dir),
        power: clamp(m.peakExtRate / s.punchSpeed, 1, 3),
      }
    }
    // Wave / swipe: a long sweep of the hand
    if (pathLen / torso > s.slashLength && m.peakSpeed > s.slashSpeed) {
      return {
        kind: 'slash',
        limb: this.def.name,
        path: m.samples.map((x) => x.raw),
        at: last.raw,
        dir: normalize({ x: last.X - first.X, y: last.Y - first.Y }),
        power: clamp(m.peakSpeed / s.slashSpeed, 1, 3),
        speeds: m.samples.map((x) => x.speed / s.slashSpeed),
      }
    }
    return null
  }

  private classifyLeg(m: Motion, s: InkSettings, torso: number): Move | null {
    let pathLen = 0
    for (let i = 1; i < m.samples.length; i++) pathLen += relDist(m.samples[i], m.samples[i - 1])
    // Kick: the foot goes up high and fast (walking and shifting weight don't lift it enough)
    if (m.maxLift < s.kickLift || m.peakSpeed < s.kickSpeed || pathLen / torso < 0.4) return null
    const first = m.samples[0]
    const last = m.samples[m.samples.length - 1]
    return {
      kind: 'kick',
      limb: this.def.name,
      path: m.samples.map((x) => x.raw),
      at: last.raw,
      dir: normalize({ x: last.X - first.X, y: last.Y - first.Y }),
      power: clamp(m.peakSpeed / s.kickSpeed, 1, 3),
      speeds: m.samples.map((x) => x.speed / s.kickSpeed),
    }
  }
}

/** Angle at the elbow (or knee) in degrees: 180 = fully straight */
function elbowAngle(lm: NormalizedLandmark[], def: LimbDef, aspect: number) {
  const v = (i: number) => ({ x: lm[i].x, y: lm[i].y / aspect, z: lm[i].z })
  const r = v(def.root)
  const m = v(def.mid)
  const e = v(def.end)
  const a = { x: r.x - m.x, y: r.y - m.y, z: r.z - m.z }
  const b = { x: e.x - m.x, y: e.y - m.y, z: e.z - m.z }
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z) || 1)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

function normalize(v: { x: number; y: number }) {
  const n = Math.hypot(v.x, v.y)
  return n > 1e-6 ? { x: v.x / n, y: v.y / n } : { x: 0, y: 0 }
}

/** Watches the hips: up fast above standing height = takeoff; back down = landing (when the splash fires). */
class JumpTracker {
  private restY: number | null = null
  private lastY = 0
  private lastT = 0
  private airborne: { since: number; peakRise: number } | null = null
  rise = 0
  /** Kicks are ignored while airborne and just after landing (legs move a lot in a jump) */
  quietUntil = 0

  get isAirborne() {
    return this.airborne !== null
  }

  reset() {
    this.restY = null
    this.airborne = null
    this.rise = 0
  }

  update(hips: CamPoint & { Y: number }, t: number, torso: number, s: InkSettings): Move | null {
    if (this.restY === null) {
      this.restY = hips.Y
      this.lastY = hips.Y
      this.lastT = t
      return null
    }
    const dt = Math.max((t - this.lastT) / 1000, 1e-3)
    const upSpeed = (this.lastY - hips.Y) / dt / torso
    this.lastY = hips.Y
    this.lastT = t
    this.rise = (this.restY - hips.Y) / torso

    if (!this.airborne) {
      // Standing height follows slow changes (shifting weight, stepping closer), never a quick hop
      this.restY += (hips.Y - this.restY) * (1 - Math.exp(-dt / 1.2))
      if (this.rise > s.jumpHeight && upSpeed > 1.2) this.airborne = { since: t, peakRise: this.rise }
      return null
    }
    this.airborne.peakRise = Math.max(this.airborne.peakRise, this.rise)
    if (t - this.airborne.since > 1500) {
      // Not a jump (stood up on something, or tracking jumped): take this as the new standing height
      this.airborne = null
      this.restY = hips.Y
      return null
    }
    if (this.rise > s.jumpHeight * 0.4) return null
    const peak = this.airborne.peakRise
    this.airborne = null
    this.quietUntil = t + 300
    return { kind: 'jump', limb: 'body', path: [], at: hips, dir: { x: 0, y: 1 }, power: clamp(peak / s.jumpHeight, 1, 3) }
  }
}

/**
 * Clear pose: forearms crossed in an X in front of the chest or face, held still. Each hand has to be
 * past the middle of the body, on the other arm's side, with the hands close together. The pose must be
 * dropped before it can clear again. A brief tracking blip doesn't restart the hold.
 */
const X_DROPOUT_MS = 250

class XPoseTracker {
  private since: number | null = null
  private lastSeen = -Infinity
  private armed = true
  progress = 0

  reset() {
    this.since = null
    this.progress = 0
  }

  update(posed: boolean, t: number, holdMs: number): boolean {
    if (posed) this.lastSeen = t
    if (!posed && t - this.lastSeen > X_DROPOUT_MS) {
      this.since = null
      this.progress = 0
      this.armed = true
      return false
    }
    if (this.since === null) this.since = t
    this.progress = this.armed ? Math.min((t - this.since) / holdMs, 1) : 0
    if (!this.armed || this.progress < 1) return false
    this.armed = false
    this.progress = 0
    return true
  }
}

/**
 * Head shake ("wet dog"): the head swinging side to side relative to the shoulders. Each time it turns
 * back after travelling at least `shakeSwing` counts as a swing; three swings within SHAKE_WINDOW_MS is a shake.
 * Looking to one side, nodding, or swaying with the whole body don't produce the back-and-forth swings.
 */
const SHAKE_WINDOW_MS = 1200
const SHAKE_SWINGS = 3

class ShakeTracker {
  private fx = new OneEuroFilter(3, 0.5)
  private dir = 0
  private ref: number | null = null
  private extreme = 0
  private swings: { t: number; size: number }[] = []
  private cooldownUntil = 0

  get swingCount() {
    return this.swings.length
  }

  reset() {
    this.fx.reset()
    this.dir = 0
    this.ref = null
    this.swings = []
  }

  /** `x`: head position relative to the shoulders, in torso lengths */
  update(x: number, at: CamPoint, t: number, s: InkSettings): Move | null {
    x = this.fx.filter(x, t)
    const h = s.shakeSwing
    while (this.swings.length && t - this.swings[0].t > SHAKE_WINDOW_MS) this.swings.shift()
    if (this.ref === null) {
      this.ref = x
      return null
    }
    if (this.dir === 0) {
      if (Math.abs(x - this.ref) > h) {
        this.dir = Math.sign(x - this.ref)
        this.extreme = x
      }
      return null
    }
    if ((x - this.extreme) * this.dir > 0) {
      this.extreme = x
      return null
    }
    if (Math.abs(this.extreme - x) <= h) return null
    // Turned back: one swing done
    this.swings.push({ t, size: Math.abs(this.extreme - this.ref) })
    this.ref = this.extreme
    this.extreme = x
    this.dir = -this.dir
    if (this.swings.length < SHAKE_SWINGS || t < this.cooldownUntil) return null
    const mean = this.swings.reduce((a, w) => a + w.size, 0) / this.swings.length
    const power = clamp(((mean / (2 * h)) * this.swings.length) / SHAKE_SWINGS, 1, 3)
    this.swings = []
    this.cooldownUntil = t + 1000
    return { kind: 'shake', limb: 'body', path: [], at, dir: { x: 0, y: 0 }, power }
  }
}

/** Turns a stream of poses into moves: punches, slashes, kicks, jumps, arm waves (flaps) and head shakes. */
export class MoveDetector {
  private limbs = LIMBS.map((def) => new LimbTracker(def))
  private jump = new JumpTracker()
  private shake = new ShakeTracker()
  private flapCooldownUntil = 0
  private xPose = new XPoseTracker()
  private torso: number | null = null

  reset() {
    for (const l of this.limbs) l.reset()
    this.jump.reset()
    this.shake.reset()
    this.xPose.reset()
    this.torso = null
  }

  update(lm: NormalizedLandmark[] | null, t: number, aspect: number, settings: InkSettings): { moves: Move[]; debug: DetectorDebug | null } {
    if (!lm) {
      this.reset()
      return { moves: [], debug: null }
    }
    // "Move size" scales every speed and distance threshold at once
    const k = settings.moveSize
    const s: InkSettings = {
      ...settings,
      slashSpeed: settings.slashSpeed * k,
      kickSpeed: settings.kickSpeed * k,
      slashLength: settings.slashLength * k,
      punchSpeed: settings.punchSpeed * k,
      punchExtend: settings.punchExtend * k,
      kickLift: settings.kickLift * k,
      jumpHeight: settings.jumpHeight * k,
      flapSpeed: settings.flapSpeed * k,
      shakeSwing: settings.shakeSwing * k,
    }
    const seen = (i: number) => (lm[i].visibility ?? 1) >= s.minVisibility
    const U = (i: number) => ({ X: 1 - lm[i].x, Y: lm[i].y / aspect })
    const mid = (a: number, b: number) => ({ X: (U(a).X + U(b).X) / 2, Y: (U(a).Y + U(b).Y) / 2 })
    const hipsSeen = seen(P.leftHip) && seen(P.rightHip)
    const shoulders = mid(P.leftShoulder, P.rightShoulder)

    // Body scale: shoulders to hips, or shoulder width when the hips are out of view
    const rawTorso = hipsSeen
      ? dist2(shoulders, mid(P.leftHip, P.rightHip))
      : dist2(U(P.leftShoulder), U(P.rightShoulder)) * 1.5
    this.torso = this.torso === null ? rawTorso : this.torso + (rawTorso - this.torso) * 0.1
    const torso = Math.max(this.torso, 0.02)

    const moves: Move[] = []
    const hips = hipsSeen ? mid(P.leftHip, P.rightHip) : null
    if (hips) {
      const jump = this.jump.update({ x: 1 - hips.X, y: hips.Y * aspect, Y: hips.Y }, t, torso, s)
      if (jump) moves.push(jump)
    } else {
      this.jump.reset()
    }
    const legsQuiet = this.jump.isAirborne || t < this.jump.quietUntil
    for (const limb of this.limbs) {
      // Feet are measured relative to the hips, so legs need the hips in view
      const anchor = limb.def.arm ? shoulders : hips
      if (!anchor) {
        limb.reset()
        continue
      }
      const move = limb.update(lm, t, aspect, torso, anchor, s, !limb.def.arm && legsQuiet)
      if (move) moves.push(move)
    }

    // Arm wave (flap): both hands out to the sides, moving up or down together, mostly vertically.
    // It takes over the arms: any single-arm swoosh from the same motion is dropped.
    const [left, right] = this.limbs.map((l) => l.debug)
    if (left.at && right.at) {
      const vertical = (d: LimbDebug) => Math.abs(d.vel.y) > s.flapSpeed && Math.abs(d.vel.y) > 1.2 * Math.abs(d.vel.x)
      const outToSides = Math.abs(left.rel.x) > 0.6 && Math.abs(right.rel.x) > 0.6 && Math.sign(left.rel.x) !== Math.sign(right.rel.x)
      if (vertical(left) && vertical(right) && Math.sign(left.vel.y) === Math.sign(right.vel.y) && outToSides) {
        for (const arm of this.limbs.slice(0, 2)) arm.hold(t + 300)
        for (let i = moves.length - 1; i >= 0; i--) if (moves[i].kind === 'slash') moves.splice(i, 1)
        if (t >= this.flapCooldownUntil) {
          this.flapCooldownUntil = t + 600
          moves.push({
            kind: 'wave',
            limb: 'body',
            path: [left.at, right.at],
            at: { x: (left.at.x + right.at.x) / 2, y: (left.at.y + right.at.y) / 2 },
            dir: { x: 0, y: Math.sign(left.vel.y) },
            power: clamp(Math.min(Math.abs(left.vel.y), Math.abs(right.vel.y)) / s.flapSpeed, 1, 3),
          })
        }
      }
    }

    // Clear pose: arms crossed in an X and held still. While it's being held, the arms don't do anything else.
    let clear: DetectorDebug['clear'] = null
    if (s.xClear && left.at && right.at) {
      const crossed = (d: LimbDebug, shoulder: number) => {
        const side = Math.sign(U(shoulder).X - shoulders.X)
        // Past the middle toward the other side, between above the head and the belly, and not moving much
        return Math.sign(d.rel.x) === -side && Math.abs(d.rel.x) > 0.05 && d.rel.y > -1.2 && d.rel.y < 1 && d.speed < 1.5
      }
      const close = Math.hypot(left.rel.x - right.rel.x, left.rel.y - right.rel.y) < 0.9
      const posed = crossed(left, P.leftShoulder) && crossed(right, P.rightShoulder) && close
      const fired = this.xPose.update(posed, t, s.clearHoldSeconds * 1000)
      const at = { x: (left.at.x + right.at.x) / 2, y: (left.at.y + right.at.y) / 2 }
      if (posed || this.xPose.progress > 0) {
        for (const arm of this.limbs.slice(0, 2)) arm.hold(t + 300)
        clear = { at, progress: this.xPose.progress }
      }
      if (fired) moves.push({ kind: 'clear', limb: 'body', path: [], at, dir: { x: 0, y: 0 }, power: 1 })
    } else {
      this.xPose.reset()
    }

    // Head shake, measured against the shoulders so swaying the whole body doesn't count
    if (seen(P.nose)) {
      const shake = this.shake.update((U(P.nose).X - shoulders.X) / torso, { x: lm[P.nose].x, y: lm[P.nose].y }, t, s)
      if (shake) moves.push(shake)
    } else {
      this.shake.reset()
    }
    return {
      moves,
      debug: {
        limbs: this.limbs.map((l) => l.debug),
        rise: this.jump.rise,
        airborne: this.jump.isAirborne,
        torso,
        feetVisible: seen(P.leftAnkle) || seen(P.rightAnkle),
        headSwings: this.shake.swingCount,
        clear,
      },
    }
  }
}
