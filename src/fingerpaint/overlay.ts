import { GestureRecognizer, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { Calibration } from './calibration'
import { toScreen, type PenState, type View } from './hand'
import { ERASER } from './painter'
import type { Settings } from './settings'

export type OverlayFrame = {
  w: number
  h: number
  now: number
  pen: PenState | null
  landmarks: NormalizedLandmark[] | null
  view: View
  settings: Settings
  color: string
  brush: number
  overTarget: boolean
  calibration: Calibration | null
  fps: number
  gesture: string
  handMissingMs: number
}

const FAR_RING = 44
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Everything redrawn each frame on top of the painting: cursor, skeleton, debug HUD, calibration prompt. */
export function drawOverlay(ctx: CanvasRenderingContext2D, f: OverlayFrame) {
  ctx.clearRect(0, 0, f.w, f.h)
  if (f.settings.showSkeleton && f.landmarks) drawSkeleton(ctx, f.landmarks, f.view)
  if (f.pen) drawCursor(ctx, f)
  if (f.settings.showHud) drawHud(ctx, f)
  if (f.calibration) drawCalibration(ctx, f, f.calibration)
  else if (f.handMissingMs > 1500) drawHint(ctx, f, 'Show me your hand! ✋')
}

function drawCursor(ctx: CanvasRenderingContext2D, f: OverlayFrame) {
  const pen = f.pen!
  const ink = f.color === ERASER ? '#888' : f.color
  const tip = (f.brush * pen.widthScale) / 2
  ctx.save()
  if (pen.down && !f.overTarget) {
    // "Touching the paper": solid dot the size of the brush
    ctx.fillStyle = ink
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(pen.x, pen.y, Math.max(tip, 6), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else {
    // Hovering: ring shrinks toward the brush size as the hand approaches the press point
    const r = lerp(FAR_RING, Math.max(tip, 8), Math.min(pen.press, 1))
    ctx.lineWidth = 5
    ctx.strokeStyle = '#fff'
    ctx.beginPath()
    ctx.arc(pen.x, pen.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.strokeStyle = ink
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.arc(pen.x, pen.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawSkeleton(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], view: View) {
  const pts = lm.map((p) => toScreen(p, view))
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 160, 255, 0.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (const { start, end } of GestureRecognizer.HAND_CONNECTIONS) {
    ctx.moveTo(pts[start].x, pts[start].y)
    ctx.lineTo(pts[end].x, pts[end].y)
  }
  ctx.stroke()
  ctx.fillStyle = 'rgba(0, 160, 255, 0.9)'
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawHud(ctx: CanvasRenderingContext2D, f: OverlayFrame) {
  const s = f.settings
  const pen = f.pen
  const lines = [
    `mode ${s.mode}   ${f.fps.toFixed(0)} fps`,
    `gesture ${f.gesture || '–'}`,
    pen ? `palm ${pen.palm.toFixed(3)}  (far ${s.far.toFixed(3)} / near ${s.near.toFixed(3)})` : 'no hand',
    pen ? `depth ${pen.depth.toFixed(2)}   pinch ${pen.pinch.toFixed(2)}` : '',
    pen ? `pen ${pen.down ? 'DOWN' : 'up'}${f.overTarget ? ' (over button)' : ''}` : '',
  ].filter(Boolean)

  ctx.save()
  ctx.font = '13px ui-monospace, Consolas, monospace'
  const boxW = 330
  const boxH = lines.length * 18 + 14
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(12, f.h - boxH - 12, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((line, i) => ctx.fillText(line, 22, f.h - boxH + 12 + i * 18))

  // Meter: the signal that decides pen down, with press (green) and release (orange) lines
  const max = 1.3
  let value: number
  let press: number
  let release: number
  if (s.mode === 'reach') {
    value = pen?.depth ?? 0
    press = s.pressAt
    release = s.pressAt - s.gap
  } else {
    // Show "closeness" so the bar fills upward as fingers pinch together
    value = pen ? 1.2 - pen.pinch : 0
    press = 1.2 - s.pinchPress
    release = 1.2 - (s.pinchPress + s.pinchGap)
  }
  const mw = 26
  const mh = 220
  const mx = f.w - mw - 24
  const my = f.h - mh - 24
  const yOf = (v: number) => my + mh - (Math.min(Math.max(v, 0), max) / max) * mh
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(mx - 6, my - 24, mw + 12, mh + 30)
  ctx.fillStyle = pen?.down ? '#34c759' : '#7aa7ff'
  ctx.fillRect(mx, yOf(value), mw, my + mh - yOf(value))
  ctx.lineWidth = 2
  ctx.strokeStyle = '#34c759'
  ctx.beginPath()
  ctx.moveTo(mx - 6, yOf(press))
  ctx.lineTo(mx + mw + 6, yOf(press))
  ctx.stroke()
  ctx.strokeStyle = '#ff9500'
  ctx.beginPath()
  ctx.moveTo(mx - 6, yOf(release))
  ctx.lineTo(mx + mw + 6, yOf(release))
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.fillText(s.mode === 'reach' ? 'depth' : 'pinch', mx + mw / 2, my - 8)
  ctx.restore()
}

function drawCalibration(ctx: CanvasRenderingContext2D, f: OverlayFrame, c: Calibration) {
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.fillRect(0, f.h / 2 - 110, f.w, 220)
  ctx.fillStyle = '#222'
  ctx.textAlign = 'center'
  ctx.font = 'bold 40px system-ui, sans-serif'
  ctx.fillText(c.prompt, f.w / 2, f.h / 2 - 20)
  ctx.font = 'bold 64px system-ui, sans-serif'
  ctx.fillText(String(c.secondsLeft(f.now)), f.w / 2, f.h / 2 + 60)
  ctx.fillStyle = '#007aff'
  ctx.fillRect(f.w / 2 - 200, f.h / 2 + 85, 400 * c.progress(f.now), 8)
  if (!f.pen) {
    ctx.font = '20px system-ui, sans-serif'
    ctx.fillStyle = '#c00'
    ctx.fillText("I can't see your hand", f.w / 2, f.h / 2 - 75)
  }
  ctx.restore()
}

function drawHint(ctx: CanvasRenderingContext2D, f: OverlayFrame, text: string) {
  ctx.save()
  ctx.font = 'bold 36px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillText(text, f.w / 2, f.h / 2)
  ctx.restore()
}
