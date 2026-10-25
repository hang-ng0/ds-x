// Animated ink effects: punch blots, brush slashes (arm sweeps and kicks) and jump splashes.
//
// Each effect animates on its own offscreen canvas with fully opaque ink, so a single effect never
// darkens where it overlaps itself. The live layer shows effects in progress; when one finishes it
// is blended into the base layer at the ink opacity. On light paper the blend is "multiply", so
// separate hits stack up darker like real ink; on dark paper it's "screen", so they glow brighter.
// The layers are shown with the matching CSS mix-blend-mode over a paper texture.

export type Pt = { x: number; y: number }
type Ctx = CanvasRenderingContext2D
type Rand = () => number

const MAX_UNDO = 10
// Effects animating at once; past this the oldest is finished early (each holds a full-size canvas)
const MAX_ACTIVE = 14

function makeRand(seed: number): Rand {
  let s = (Math.floor(Math.abs(seed)) % 2147483646) + 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
const range = (r: Rand, a: number, b: number) => a + (b - a) * r()
/** Roughly normal, mostly within -1..1 */
const gauss = (r: Rand) => (r() + r() + r() - 1.5) / 1.5
const easeOut = (t: number) => 1 - (1 - t) ** 3
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Random wobble for organic outlines: a few harmonics with falling amplitude */
function wobble(rand: Rand, strength: number) {
  const parts = Array.from({ length: 6 }, (_, i) => ({
    k: i + 2,
    a: (range(rand, 0.3, 1) * strength) / Math.sqrt(i + 1),
    phase: range(rand, 0, Math.PI * 2),
  }))
  return (theta: number) => 1 + parts.reduce((sum, p) => sum + p.a * Math.sin(p.k * theta + p.phase), 0)
}

/** Closed smooth path through points (midpoint quadratic curves) */
function smoothClosed(ctx: Ctx, pts: Pt[]) {
  const n = pts.length
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const start = mid(pts[n - 1], pts[0])
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y)
  }
  ctx.closePath()
}

/**
 * A flying drop of ink. While in the air it's only drawn on the live layer (see `drawHead`); when it
 * lands it leaves a permanent splat with a short tail pointing back the way it came.
 */
class Droplet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  drag: number
  gravity: number
  /** Longest it can fly (seconds) before it hits the paper */
  life: number
  /** It also lands when it falls back down to this height (jump jets landing in the pool) */
  landY: number
  /** Leave a thinning streak for this long after launch (jump tendrils) */
  streakFor: number
  age = 0
  alive = true
  apexed = false

  constructor(
    x: number, y: number, vx: number, vy: number, r: number,
    o: { drag: number; gravity: number; life: number; landY?: number; streakFor?: number },
  ) {
    this.x = x
    this.y = y
    this.vx = vx
    this.vy = vy
    this.r = r
    this.drag = o.drag
    this.gravity = o.gravity
    this.life = o.life
    this.landY = o.landY ?? Infinity
    this.streakFor = o.streakFor ?? 0
  }

  /** Moves the drop; draws onto the effect's own (persistent) canvas only for a streak or the final splat */
  step(ctx: Ctx, dt: number) {
    if (!this.alive) return
    this.age += dt
    const px = this.x
    const py = this.y
    const damp = Math.exp(-this.drag * dt)
    this.vx *= damp
    this.vy = this.vy * damp + this.gravity * dt
    this.x += this.vx * dt
    this.y += this.vy * dt
    if (this.age < this.streakFor) {
      ctx.lineWidth = Math.max(0.6, this.r * 1.4 * (1 - this.age / this.streakFor))
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(this.x, this.y)
      ctx.stroke()
    }
    const speed = Math.hypot(this.vx, this.vy)
    if (this.age >= this.life || speed < 40 || (this.y >= this.landY && this.vy > 0)) this.land(ctx, speed)
  }

  private land(ctx: Ctx, speed: number) {
    this.alive = false
    const angle = Math.atan2(this.vy, this.vx)
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    // Tapered tail behind the splat: longer the faster it hit
    const tail = Math.min(speed * 0.035, this.r * 7)
    if (tail > this.r) {
      ctx.beginPath()
      ctx.moveTo(this.x - uy * this.r * 0.8, this.y + ux * this.r * 0.8)
      ctx.lineTo(this.x - ux * tail, this.y - uy * tail)
      ctx.lineTo(this.x + uy * this.r * 0.8, this.y - ux * this.r * 0.8)
      ctx.closePath()
      ctx.fill()
    }
    ctx.beginPath()
    ctx.ellipse(this.x, this.y, this.r * 1.5, this.r * 1.05, angle, 0, Math.PI * 2)
    ctx.fill()
  }

  /** The drop in flight, stretched along its motion. Drawn fresh every frame on the live layer. */
  drawHead(ctx: Ctx) {
    if (!this.alive) return
    const speed = Math.hypot(this.vx, this.vy)
    const stretch = 1 + Math.min(speed / 600, 2.5)
    ctx.beginPath()
    ctx.ellipse(this.x, this.y, this.r * stretch, this.r, Math.atan2(this.vy, this.vx), 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Ink running down the paper, thinning as it goes, ending in a small bead */
class Drip {
  x: number
  y: number
  vy: number
  width: number
  length: number
  delay: number
  traveled = 0
  done = false

  constructor(x: number, y: number, width: number, length: number, delay: number, vy: number) {
    this.x = x
    this.y = y
    this.width = width
    this.length = length
    this.delay = delay
    this.vy = vy
  }

  step(ctx: Ctx, dt: number, age: number) {
    if (this.done || age < this.delay) return
    const step = this.vy * dt
    this.vy *= Math.exp(-0.7 * dt)
    const w = this.width * Math.sqrt(1 - Math.min(this.traveled / this.length, 1)) + 1.2
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(this.x, this.y)
    this.y += step
    this.traveled += step
    ctx.lineTo(this.x, this.y)
    ctx.stroke()
    if (this.traveled >= this.length || this.vy < 6) {
      this.done = true
      ctx.beginPath()
      ctx.arc(this.x, this.y + w * 0.4, w * 0.9, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

type FxOptions = { splatter: number; drips: boolean }

abstract class Effect {
  readonly canvas: HTMLCanvasElement
  protected ctx: Ctx
  protected age = 0
  protected rand: Rand
  protected droplets: Droplet[] = []

  constructor(canvas: HTMLCanvasElement, color: string, seed: number) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.ctx.fillStyle = color
    this.ctx.strokeStyle = color
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.rand = makeRand(seed)
  }

  /** Advance by `dt` seconds, drawing new ink. Returns true once the effect has settled. */
  abstract step(dt: number): boolean

  /** Things in motion that shouldn't leave a mark yet (drops in flight), drawn on the live layer */
  drawTransient(ctx: Ctx) {
    ctx.fillStyle = this.ctx.fillStyle
    for (const d of this.droplets) d.drawHead(ctx)
  }

  protected stepDroplets(dt: number) {
    for (const d of this.droplets) d.step(this.ctx, dt)
    return this.droplets.every((d) => !d.alive)
  }
}

/** Punch: an ink blot bursts open, throws spikes and droplets in the punch's direction, then drips. */
class BlotEffect extends Effect {
  private c: Pt
  private R: number
  private shape: (theta: number) => number
  private dir: Pt
  private spikes: { angle: number; len: number; width: number; delay: number; done: boolean }[]
  private drips: Drip[] = []
  private grown = false

  constructor(canvas: HTMLCanvasElement, color: string, seed: number, c: Pt, dir: Pt, power: number, R: number, o: FxOptions) {
    super(canvas, color, seed)
    const rand = this.rand
    this.c = c
    this.R = R
    this.dir = dir
    this.shape = wobble(rand, 0.24)
    const aimed = Math.hypot(dir.x, dir.y) > 0
    const dirAngle = Math.atan2(dir.y, dir.x)
    const pickAngle = () => (aimed ? dirAngle + gauss(rand) * 1.2 : range(rand, 0, Math.PI * 2))
    const forward = (a: number) => (aimed ? 0.55 + 0.45 * Math.cos(a - dirAngle) : 1)

    this.spikes = Array.from({ length: Math.round(5 + 3 * power) }, () => {
      const angle = pickAngle()
      return { angle, len: R * range(rand, 0.3, 1.2) * forward(angle), width: R * range(rand, 0.08, 0.2), delay: range(rand, 0, 0.08), done: false }
    })
    const drops = Math.round((8 + 12 * power) * o.splatter)
    for (let i = 0; i < drops; i++) {
      const a = pickAngle()
      const speed = R * range(rand, 4, 17) * forward(a)
      this.droplets.push(
        new Droplet(c.x + Math.cos(a) * R * 0.6, c.y + Math.sin(a) * R * 0.6, Math.cos(a) * speed, Math.sin(a) * speed, R * range(rand, 0.025, 0.09), {
          drag: 4,
          gravity: 120,
          life: range(rand, 0.12, 0.45),
        }),
      )
    }
    if (o.drips) {
      const n = 1 + Math.floor(rand() * (1 + power))
      for (let i = 0; i < n; i++) {
        const x = c.x + range(rand, -0.6, 0.6) * R
        this.drips.push(new Drip(x, c.y + R * 0.75, R * range(rand, 0.07, 0.13), R * range(rand, 0.6, 2.2), range(rand, 0.25, 0.55), range(rand, 60, 130)))
      }
    }
  }

  step(dt: number) {
    this.age += dt
    const ctx = this.ctx
    const g = easeOut(clamp01(this.age / 0.18))
    if (!this.grown) {
      // Main blot, slightly pushed forward in the punch direction, with a soft bleeding edge
      const pts = Array.from({ length: 64 }, (_, i) => {
        const th = (i / 40) * Math.PI * 2
        const ux = Math.cos(th)
        const uy = Math.sin(th)
        const push = Math.max(0, ux * this.dir.x + uy * this.dir.y) * 0.35
        const r = this.R * g * (this.shape(th) + push)
        return { x: this.c.x + ux * r, y: this.c.y + uy * r }
      })
      ctx.save()
      ctx.shadowColor = ctx.fillStyle as string
      ctx.shadowBlur = this.R * 0.05
      smoothClosed(ctx, pts)
      ctx.fill()
      ctx.restore()
      this.grown = g >= 1
    }
    let spikesDone = true
    for (const s of this.spikes) {
      if (s.done) continue
      const q = easeOut(clamp01((this.age - s.delay) / 0.13))
      if (q <= 0) {
        spikesDone = false
        continue
      }
      const base = this.R * 0.7
      const tip = base + (this.R * 0.3 + s.len) * q
      const ux = Math.cos(s.angle)
      const uy = Math.sin(s.angle)
      const nx = -uy * s.width * 0.5
      const ny = ux * s.width * 0.5
      ctx.beginPath()
      ctx.moveTo(this.c.x + ux * base + nx, this.c.y + uy * base + ny)
      ctx.lineTo(this.c.x + ux * tip, this.c.y + uy * tip)
      ctx.lineTo(this.c.x + ux * base - nx, this.c.y + uy * base - ny)
      ctx.closePath()
      ctx.fill()
      if (q >= 1) {
        s.done = true
        ctx.beginPath()
        ctx.arc(this.c.x + ux * tip, this.c.y + uy * tip, s.width * 0.35, 0, Math.PI * 2)
        ctx.fill()
      } else {
        spikesDone = false
      }
    }
    const dropsDone = this.stepDroplets(dt)
    for (const d of this.drips) d.step(ctx, dt, this.age)
    return this.grown && spikesDone && dropsDone && this.drips.every((d) => d.done)
  }
}

/** Chaikin corner cutting: rounds off a jittery tracked path */
function chaikin(pts: Pt[]) {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Evenly spaced points along a path */
function resample(pts: Pt[], spacing: number) {
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    let d = spacing - carry
    while (d <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * d) / seg, y: a.y + ((b.y - a.y) * d) / seg })
      d += spacing
    }
    carry = seg - (d - spacing)
  }
  if (out.length < 2) out.push(pts[pts.length - 1])
  return out
}

/**
 * Sweep or kick: a calligraphy brush stroke along the path, drawn in a quick swish. A solid body, then
 * individual bristles that run dry toward the tail, with ink flung off the tip.
 */
class SlashEffect extends Effect {
  private pts: Pt[]
  private normals: Pt[]
  private s: number[]
  private W: number
  private phase: number
  private duration: number
  private bristles: { o: number; width: number; start: number; end: number; alpha: number }[]
  private drawn = 0
  private flung = false
  private power: number
  private o: FxOptions

  constructor(canvas: HTMLCanvasElement, color: string, seed: number, path: Pt[], power: number, W: number, heavy: boolean, o: FxOptions) {
    super(canvas, color, seed)
    const rand = this.rand
    this.power = power
    this.o = o
    this.W = W
    this.phase = range(rand, 0, 10)
    let pts = resample(chaikin(chaikin(path)), 3)
    // Follow-through: the brush keeps going a little past the hand
    if (pts.length >= 2) {
      const a = pts[pts.length - 2]
      const b = pts[pts.length - 1]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const extra = pts.length * 3 * 0.15
      pts = resample([...pts, { x: b.x + ((b.x - a.x) / len) * extra, y: b.y + ((b.y - a.y) / len) * extra }], 3)
    }
    this.pts = pts
    this.normals = pts.map((_, i) => {
      const a = pts[Math.max(i - 1, 0)]
      const b = pts[Math.min(i + 1, pts.length - 1)]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
    })
    this.s = pts.map((_, i) => i / Math.max(pts.length - 1, 1))
    this.duration = 0.14 + 0.06 * power + (heavy ? 0.06 : 0)
    const K = Math.round(10 + 4 * power + (heavy ? 6 : 0))
    this.bristles = Array.from({ length: K }, (_, k) => {
      const o = k / (K - 1) - 0.5 + gauss(rand) * 0.03
      return {
        o,
        width: (W / K) * range(rand, 1.6, 2.8),
        start: range(rand, 0, 0.05) * (1 + Math.abs(o) * 3),
        end: Math.max(0.4, 1 - Math.abs(o) * range(rand, 0.2, 0.9) - range(rand, 0, 0.15)),
        alpha: range(rand, 0.75, 1),
      }
    })
  }

  /** Brush width along the stroke: quick attack, full body, long tapering tail, slight pressure wobble */
  private widthAt(s: number) {
    return this.W * Math.min(1, s / 0.07) * (1 - 0.8 * s ** 1.6) * (1 + 0.12 * Math.sin(s * 17 + this.phase))
  }

  private at(i: number, o: number) {
    const w = this.widthAt(this.s[i])
    return { x: this.pts[i].x + this.normals[i].x * o * w, y: this.pts[i].y + this.normals[i].y * o * w }
  }

  step(dt: number) {
    this.age += dt
    const ctx = this.ctx
    const rand = this.rand
    const n = this.pts.length
    if (n < 3) return true
    const reveal = 1 - (1 - clamp01(this.age / this.duration)) ** 2
    const upto = Math.floor(reveal * (n - 1))
    for (let i = Math.max(this.drawn, 1); i <= upto; i++) {
      const s = this.s[i]
      // Solid body of the stroke for the first part
      if (s < 0.7) {
        const a0 = this.at(i - 1, -0.33)
        const a1 = this.at(i, -0.33)
        const b1 = this.at(i, 0.33)
        const b0 = this.at(i - 1, 0.33)
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(a0.x, a0.y)
        ctx.lineTo(a1.x, a1.y)
        ctx.lineTo(b1.x, b1.y)
        ctx.lineTo(b0.x, b0.y)
        ctx.closePath()
        ctx.fill()
      }
      // Bristles, breaking up into dry streaks toward the tail
      for (const b of this.bristles) {
        if (s < b.start || s > b.end) continue
        if (s > 0.5 && rand() < (s - 0.5) * 0.9) continue
        const p0 = this.at(i - 1, b.o)
        const p1 = this.at(i, b.o)
        ctx.globalAlpha = b.alpha
        ctx.lineWidth = b.width * (0.4 + (0.6 * this.widthAt(s)) / this.W)
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // Ink thrown off the moving brush
      if (s > 0.25 && rand() < 0.16 * this.o.splatter * this.power) this.fling(i, range(rand, 500, 1300) * Math.sqrt(this.power), 250)
    }
    this.drawn = Math.max(this.drawn, upto)
    if (reveal >= 1 && !this.flung) {
      this.flung = true
      const count = Math.round((5 + 4 * this.power) * this.o.splatter)
      for (let k = 0; k < count; k++) this.fling(n - 1, range(rand, 700, 1800), 320)
    }
    const dropsDone = this.stepDroplets(dt)
    return reveal >= 1 && dropsDone
  }

  private fling(i: number, speed: number, sideways: number) {
    const rand = this.rand
    const a = this.pts[Math.max(i - 1, 0)]
    const b = this.pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const tx = (b.x - a.x) / len
    const ty = (b.y - a.y) / len
    const side = gauss(rand) * sideways
    this.droplets.push(
      new Droplet(b.x, b.y, tx * speed + this.normals[i].x * side, ty * speed + this.normals[i].y * side, this.W * range(rand, 0.03, 0.09), {
        drag: 4,
        gravity: 150,
        life: range(rand, 0.1, 0.35),
      }),
    )
  }
}

/**
 * Jump: ink bursts up from the bottom of the paper where the jumper lands. A pool spreads along the
 * bottom, a crown of spikes rises from it, and jets arc up and rain back down.
 */
class SplashEffect extends Effect {
  private x: number
  private floor: number
  private PW: number
  private PH: number
  private shape: (theta: number) => number
  private crown: { x: number; h: number; w: number; lean: number; delay: number }[]
  private pending: { delay: number; drop: Droplet }[] = []

  constructor(canvas: HTMLCanvasElement, color: string, seed: number, x: number, floor: number, power: number, paperW: number, paperH: number, scale: number, o: FxOptions) {
    super(canvas, color, seed)
    const rand = this.rand
    this.x = x
    this.floor = floor
    this.PW = paperW * (0.1 + 0.07 * power) * scale
    this.PH = paperH * (0.05 + 0.025 * power) * scale
    this.shape = wobble(rand, 0.18)
    const gravity = 2400
    const jets = Math.round((6 + 4 * power) * o.splatter)
    for (let i = 0; i < jets; i++) {
      const x0 = x + gauss(rand) * this.PW * 0.35
      // Jets lean outward the farther they start from the middle
      const lean = ((x0 - x) / (this.PW / 2)) * 0.6 + gauss(rand) * 0.25
      const h = Math.min(paperH * range(rand, 0.12, 0.4) * power ** 0.6 * scale, paperH * 0.85)
      const v0 = Math.sqrt(2 * gravity * h)
      const drop = new Droplet(x0, floor - this.PH * 0.6, Math.sin(lean) * v0, -Math.cos(lean) * v0, range(rand, 3, 7) * (0.8 + 0.2 * power) * scale, {
        drag: 0.3,
        gravity,
        life: range(rand, 0.25, 1),
        landY: floor,
        // A short tendril where the jet leaves the pool; the rest of the arc is just the flying drop
        streakFor: 0.06,
      })
      this.pending.push({ delay: range(rand, 0, 0.1), drop })
    }
    // Crown: short, wide spikes around the rim, fanning outward like a drop hitting a puddle
    this.crown = Array.from({ length: Math.round(6 + 3 * power) }, () => {
      const u = range(rand, -0.45, 0.45)
      return {
        x: x + u * this.PW,
        h: this.PH * range(rand, 0.4, 1.4),
        w: range(rand, 5, 11) * scale,
        lean: u * 1.4 + gauss(rand) * 0.15,
        delay: range(rand, 0.04, 0.18),
      }
    })
  }

  step(dt: number) {
    this.age += dt
    const ctx = this.ctx
    const g = easeOut(clamp01(this.age / 0.22))
    // Pool hugging the bottom edge, with a wavy top
    const pts: Pt[] = []
    for (let i = 0; i <= 32; i++) {
      const u = (i / 32) * 2 - 1
      const top = this.PH * g * Math.sqrt(1 - u * u) * this.shape(u * Math.PI)
      pts.push({ x: this.x + (u * this.PW * g) / 2, y: this.floor - top })
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x, this.floor + 4)
    for (const p of pts) ctx.lineTo(p.x, p.y)
    ctx.lineTo(pts[pts.length - 1].x, this.floor + 4)
    ctx.closePath()
    ctx.fill()

    for (const c of this.crown) {
      const q = easeOut(clamp01((this.age - c.delay) / 0.16))
      if (q <= 0) continue
      const baseY = this.floor - this.PH * 0.5
      const tipX = c.x + Math.sin(c.lean) * c.h * q
      const tipY = baseY - Math.cos(c.lean) * c.h * q
      ctx.beginPath()
      ctx.moveTo(c.x - c.w, baseY)
      ctx.quadraticCurveTo(c.x - c.w * 0.2, baseY - c.h * q * 0.5, tipX, tipY)
      ctx.quadraticCurveTo(c.x + c.w * 0.2, baseY - c.h * q * 0.5, c.x + c.w, baseY)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.arc(tipX, tipY, c.w * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const p of this.pending.filter((p) => this.age >= p.delay)) {
      this.droplets.push(p.drop)
      this.pending.splice(this.pending.indexOf(p), 1)
    }
    // Jets sometimes break into smaller drops at the top of their arc
    for (const d of [...this.droplets]) {
      if (d.alive && !d.apexed && d.vy > 0 && d.gravity > 1000) {
        d.apexed = true
        if (this.rand() < 0.5) {
          for (let k = 0; k < 2; k++) {
            this.droplets.push(
              new Droplet(d.x, d.y, d.vx + gauss(this.rand) * 120, d.vy - range(this.rand, 0, 150), d.r * 0.55, {
                drag: 0.3,
                gravity: d.gravity,
                life: 2.5,
                landY: d.landY,
              }),
            )
          }
        }
      }
    }
    const dropsDone = this.stepDroplets(dt)
    return g >= 1 && this.pending.length === 0 && dropsDone && this.age > 0.2
  }
}

/** The ink layers on the paper: runs effects, keeps the finished painting, undo and clear. */
export class InkCanvas {
  color = '#ff2bd6'
  opacity = 0.9
  splatter = 1
  drips = true
  scale = 1
  /** Dark paper: ink adds light ("screen"), so overlaps glow brighter. Light paper: ink darkens ("multiply"). */
  dark = true
  private base: HTMLCanvasElement
  private baseCtx: Ctx
  private live: HTMLCanvasElement
  private liveCtx: Ctx
  private glow: { base: HTMLCanvasElement; live: HTMLCanvasElement } | null
  private effects: Effect[] = []
  private pool: HTMLCanvasElement[] = []
  private undoStack: ImageData[] = []
  private dpr = 1
  private w = 0
  private h = 0
  private seed = Date.now()

  /** `glow`: optional canvases that get a half-size copy of each layer, blurred with CSS for a neon glow */
  constructor(base: HTMLCanvasElement, live: HTMLCanvasElement, glow?: { base: HTMLCanvasElement; live: HTMLCanvasElement }) {
    this.base = base
    this.baseCtx = base.getContext('2d')!
    this.live = live
    this.liveCtx = live.getContext('2d')!
    this.glow = glow ?? null
  }

  get size() {
    return { w: this.w, h: this.h }
  }

  private get blend(): GlobalCompositeOperation {
    return this.dark ? 'screen' : 'multiply'
  }

  resize(cssW: number, cssH: number) {
    if (cssW === 0 || cssH === 0) return
    this.finishAll()
    this.dpr = window.devicePixelRatio || 1
    const old = document.createElement('canvas')
    old.width = this.base.width
    old.height = this.base.height
    old.getContext('2d')!.drawImage(this.base, 0, 0)
    for (const c of [this.base, this.live]) {
      c.width = Math.round(cssW * this.dpr)
      c.height = Math.round(cssH * this.dpr)
    }
    for (const c of this.glow ? [this.glow.base, this.glow.live] : []) {
      c.width = Math.round(cssW / 2)
      c.height = Math.round(cssH / 2)
    }
    this.baseCtx.drawImage(old, 0, 0)
    this.w = cssW
    this.h = cssH
    this.pool = []
    this.undoStack = []
    this.syncGlow(this.base, this.glow?.base)
  }

  /** Base sizes scale with the paper so effects look the same on any screen */
  private get unit() {
    return Math.min(this.w, this.h) * this.scale
  }

  punch(at: Pt, dir: Pt, power: number) {
    const R = this.unit * 0.05 * (0.8 + 0.4 * power)
    this.add((c, seed) => new BlotEffect(c, this.color, seed, at, dir, power, R, this.options))
  }

  /** `heavy` for kicks: a wider, wetter brush */
  slash(path: Pt[], power: number, heavy = false) {
    const W = this.unit * 0.03 * (0.8 + 0.3 * power) * (heavy ? 1.5 : 1)
    this.add((c, seed) => new SlashEffect(c, this.color, seed, path, power, W, heavy, this.options))
  }

  splash(x: number, power: number) {
    this.add((c, seed) => new SplashEffect(c, this.color, seed, x, this.h, power, this.w, this.h, this.scale, this.options))
  }

  /** Advance animations by `dt` seconds and redraw the live layer */
  frame(dt: number) {
    for (const e of [...this.effects]) if (e.step(Math.min(dt, 0.05))) this.finish(e)
    const ctx = this.liveCtx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.live.width, this.live.height)
    ctx.globalAlpha = this.opacity
    ctx.globalCompositeOperation = this.blend
    for (const e of this.effects) ctx.drawImage(e.canvas, 0, 0)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    for (const e of this.effects) e.drawTransient(ctx)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    this.syncGlow(this.live, this.glow?.live)
  }

  /** Removes the newest effect still animating, otherwise the last finished one */
  undo() {
    const active = this.effects.pop()
    if (active) {
      this.pool.push(active.canvas)
      return
    }
    const snapshot = this.undoStack.pop()
    if (snapshot) this.baseCtx.putImageData(snapshot, 0, 0)
    this.syncGlow(this.base, this.glow?.base)
  }

  clear() {
    for (const e of this.effects) this.pool.push(e.canvas)
    this.effects = []
    this.snapshot()
    this.baseCtx.clearRect(0, 0, this.base.width, this.base.height)
    this.syncGlow(this.base, this.glow?.base)
  }

  private get options(): FxOptions {
    return { splatter: this.splatter, drips: this.drips }
  }

  private add(make: (canvas: HTMLCanvasElement, seed: number) => Effect) {
    if (this.w === 0) return
    if (this.effects.length >= MAX_ACTIVE) this.finish(this.effects[0])
    const canvas = this.pool.pop() ?? document.createElement('canvas')
    canvas.width = this.base.width
    canvas.height = this.base.height
    canvas.getContext('2d')!.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.effects.push(make(canvas, this.seed++))
  }

  private finish(e: Effect) {
    this.effects.splice(this.effects.indexOf(e), 1)
    this.snapshot()
    const ctx = this.baseCtx
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = this.blend
    ctx.globalAlpha = this.opacity
    ctx.drawImage(e.canvas, 0, 0)
    ctx.restore()
    this.pool.push(e.canvas)
    this.syncGlow(this.base, this.glow?.base)
  }

  private finishAll() {
    for (const e of [...this.effects]) this.finish(e)
  }

  private snapshot() {
    if (this.base.width === 0) return
    this.undoStack.push(this.baseCtx.getImageData(0, 0, this.base.width, this.base.height))
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
  }

  /** Copies a layer into its glow canvas (half size; CSS blurs it), only when the glow is shown */
  private syncGlow(from: HTMLCanvasElement, to: HTMLCanvasElement | undefined) {
    if (!to || !this.dark || to.width === 0) return
    const ctx = to.getContext('2d')!
    ctx.clearRect(0, 0, to.width, to.height)
    ctx.drawImage(from, 0, 0, to.width, to.height)
  }

  /** Redraw the glow copies, e.g. after switching paper */
  refreshGlow() {
    this.syncGlow(this.base, this.glow?.base)
    this.syncGlow(this.live, this.glow?.live)
  }
}

/** A tileable paper texture (fibers and speckles), as a data URL for a CSS background */
export function paperTexture(dark: boolean) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = dark ? '#0b0a12' : '#f5eedd'
  ctx.fillRect(0, 0, size, size)
  const rand = makeRand(7)
  for (let i = 0; i < 900; i++) {
    const x = rand() * size
    const y = rand() * size
    const a = rand() * Math.PI
    const len = range(rand, 4, 22)
    const fiber = dark
      ? rand() < 0.5
        ? `rgba(140, 120, 255, ${range(rand, 0.02, 0.05)})`
        : `rgba(255, 255, 255, ${range(rand, 0.015, 0.04)})`
      : rand() < 0.5
        ? `rgba(120, 100, 70, ${range(rand, 0.03, 0.08)})`
        : `rgba(255, 255, 255, ${range(rand, 0.1, 0.3)})`
    ctx.strokeStyle = fiber
    ctx.lineWidth = range(rand, 0.4, 1.2)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = dark ? `rgba(255, 255, 255, ${range(rand, 0.03, 0.08)})` : `rgba(90, 70, 40, ${range(rand, 0.04, 0.12)})`
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  return c.toDataURL()
}
