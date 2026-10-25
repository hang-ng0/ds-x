import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { Pt } from './inkfx'
import type { DetectorDebug, MoveKind } from './moves'
import { POSE_CONNECTIONS } from './pose'
import type { InkSettings } from './settings'

export const MOVE_LABELS: Record<MoveKind, string> = {
  punch: 'PUNCH!',
  slash: 'SWOOSH!',
  kick: 'KICK!',
  jump: 'JUMP!',
  wave: 'SPLASH!',
  shake: 'SHAKE!',
  clear: 'CLEAR!',
}
const POPUP_MS = 650

export type Popup = { text: string; x: number; y: number; born: number; tilt: number }

export type OverlayFrame = {
  w: number
  h: number
  now: number
  color: string
  /** Hand/foot trails in client pixels, newest last */
  trails: { pts: Pt[]; moving: boolean }[]
  popups: Popup[]
  paper: { x: number; y: number; w: number; h: number }
  hint: string | null
  /** Dark paper: callouts take the ink's neon color with a dark outline and glow */
  dark: boolean
  /** Arms crossed in an X: where (client pixels) and how far along the hold to clear is */
  clear: { at: Pt; progress: number } | null
}

/** Full-window layer: where your hands and feet are, move callouts, and hints */
export function drawOverlay(ctx: CanvasRenderingContext2D, f: OverlayFrame) {
  ctx.clearRect(0, 0, f.w, f.h)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const { pts, moving } of f.trails) {
    if (pts.length === 0) continue
    // Fading brush trail so kids see the path their ink will follow
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length
      ctx.globalAlpha = (moving ? 0.45 : 0.18) * k
      ctx.strokeStyle = f.color
      ctx.lineWidth = (moving ? 10 : 6) * k + 1
      ctx.beginPath()
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
    const p = pts[pts.length - 1]
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(p.x, p.y, moving ? 11 : 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = f.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, moving ? 8 : 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  if (f.clear && f.clear.progress > 0) drawClearRing(ctx, f.clear.at, f.clear.progress, f.dark)
  for (const p of f.popups) drawPopup(ctx, p, f.now, f.dark ? f.color : null)

  if (f.hint) {
    ctx.save()
    ctx.font = 'bold 30px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = f.dark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(40, 30, 20, 0.45)'
    ctx.fillText(f.hint, f.paper.x + f.paper.w / 2, f.paper.y + f.paper.h / 2)
    ctx.restore()
  }
}

// Hold-to-clear feedback: a ring around the crossed arms that fills up, with a label
function drawClearRing(ctx: CanvasRenderingContext2D, at: Pt, progress: number, dark: boolean) {
  const r = 70
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = 14
  ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)'
  ctx.beginPath()
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 10
  ctx.strokeStyle = dark ? '#ffffff' : '#c0182d'
  ctx.beginPath()
  ctx.arc(at.x, at.y, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
  ctx.stroke()
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = dark ? '#ffffff' : '#222'
  ctx.fillText('✖ Hold to clear', at.x, at.y + r + 34)
  ctx.restore()
}

// Comic-book callout that pops in big, settles, and fades
function drawPopup(ctx: CanvasRenderingContext2D, p: Popup, now: number, neon: string | null) {
  const t = (now - p.born) / POPUP_MS
  if (t < 0 || t > 1) return
  const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - Math.min((t - 0.15) / 0.2, 1) * 0.2
  ctx.save()
  ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
  ctx.translate(p.x, p.y - t * 30)
  ctx.rotate(p.tilt)
  ctx.scale(scale, scale)
  ctx.font = 'italic 900 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 10
  ctx.strokeStyle = neon ? '#000' : '#fff'
  ctx.strokeText(p.text, 0, 0)
  if (neon) {
    ctx.shadowColor = neon
    ctx.shadowBlur = 18
  }
  ctx.fillStyle = neon ?? '#c0182d'
  ctx.fillText(p.text, 0, 0)
  ctx.restore()
}

export function popupsAlive(popups: Popup[], now: number) {
  return popups.filter((p) => now - p.born < POPUP_MS)
}

export type PreviewFrame = {
  w: number
  h: number
  landmarks: NormalizedLandmark[] | null
  debug: DetectorDebug | null
  settings: InkSettings
}

/** Over the mirrored camera preview: the skeleton, hands/feet colored when moving fast, and the jump meter */
export function drawPreview(ctx: CanvasRenderingContext2D, f: PreviewFrame) {
  ctx.clearRect(0, 0, f.w, f.h)
  const lm = f.landmarks
  if (!lm) return
  const s = f.settings
  const pt = (p: NormalizedLandmark) => ({ x: (1 - p.x) * f.w, y: p.y * f.h })
  const seen = (p: NormalizedLandmark) => (p.visibility ?? 1) >= s.minVisibility

  if (s.showSkeleton) {
    ctx.save()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.beginPath()
    for (const { start, end } of POSE_CONNECTIONS) {
      if (!seen(lm[start]) || !seen(lm[end])) continue
      const a = pt(lm[start])
      const b = pt(lm[end])
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
    for (const l of f.debug?.limbs ?? []) {
      if (!l.at) continue
      const p = { x: (1 - l.at.x) * f.w, y: l.at.y * f.h }
      ctx.fillStyle = l.moving ? '#ff3b30' : '#ffcc00'
      ctx.beginPath()
      ctx.arc(p.x, p.y, l.moving ? 7 : 5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  if (f.debug && !f.debug.feetVisible) {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, f.h - 26, f.w, 26)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Feet not visible: step back for kicks & jumps', f.w / 2, f.h - 9)
    ctx.restore()
  }

  if (s.showHud && f.debug) {
    // Jump meter: hips height above standing, with the jump threshold
    const max = s.jumpHeight * 3
    const mh = f.h - 24
    const mx = f.w - 22
    const my = 12
    const yOf = (v: number) => my + mh - (Math.min(Math.max(v, 0), max) / max) * mh
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(mx - 3, my - 3, 18, mh + 6)
    ctx.fillStyle = f.debug.airborne ? '#34c759' : '#7aa7ff'
    ctx.fillRect(mx, yOf(f.debug.rise), 12, my + mh - yOf(f.debug.rise))
    ctx.strokeStyle = '#34c759'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(mx - 5, yOf(s.jumpHeight))
    ctx.lineTo(mx + 17, yOf(s.jumpHeight))
    ctx.stroke()
    ctx.restore()
  }
}

export function hudText(debug: DetectorDebug | null, fps: number, lastMove: string) {
  if (!debug) return `${fps.toFixed(0)} fps\nno body: step back into view`
  const names: Record<string, string> = { leftArm: 'L arm', rightArm: 'R arm', leftLeg: 'L leg', rightLeg: 'R leg' }
  return [
    `${fps.toFixed(0)} fps   last move: ${lastMove || '–'}`,
    `jump rise ${debug.rise.toFixed(2)}${debug.airborne ? '  AIRBORNE' : ''}   head swings ${debug.headSwings}`,
    ...debug.limbs.map((l) =>
      l.at
        ? `${names[l.limb].padEnd(6)} speed ${l.speed.toFixed(1).padStart(4)}  ext ${l.extRate.toFixed(1).padStart(5)}${l.limb.endsWith('Leg') ? `  lift ${l.lift.toFixed(2)}` : ''}${l.moving ? '  ●' : ''}`
        : `${names[l.limb].padEnd(6)} not visible`,
    ),
  ].join('\n')
}
