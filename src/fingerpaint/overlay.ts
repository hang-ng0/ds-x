import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { Calibration } from './calibration'
import { describeAction, type TriggerState } from './gestures'
import { FINGERS, HAND_CONNECTIONS, type HandState, type Point, type Rect, type View } from './hand'
import { ERASER, traceHand } from './painter'
import type { Settings } from './settings'

const FAR_RING = 44
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** One visible hand */
export type HandView = {
  /** Hand slot, shown as "1" / "2" next to the cursor when two hands are visible */
  id: number
  hand: HandState
  color: string
  overUi: boolean
  trigger: TriggerState | null
  /** When this hand's last gesture action fired, for a short flash */
  firedAt: number
  firedLabel: string
}

export type OverlayFrame = {
  w: number
  h: number
  now: number
  hands: HandView[]
  /** The hand-controlled area (toolbars + paper) and the paper itself, in client pixels */
  area: Rect
  paper: Rect
  brush: number
  calibration: Calibration | null
  handMissingMs: number
}

/** Full-window layer above everything: cursors, gesture feedback, calibration prompt, hints. */
export function drawOverlay(ctx: CanvasRenderingContext2D, f: OverlayFrame) {
  ctx.clearRect(0, 0, f.w, f.h)
  for (const v of f.hands) drawCursor(ctx, f, v)
  if (f.hands.length > 1) for (const v of f.hands) drawHandTag(ctx, v)
  for (const v of f.hands) drawGestureFeedback(ctx, f.now, v)
  if (f.calibration) drawCalibration(ctx, f, f.calibration)
  else if (f.handMissingMs > 1500) drawHint(ctx, f.paper, 'Show me your hand! ✋')
}

// While a mapped gesture is held: a filling ring and the action's name. Then a brief flash when it fires.
function drawGestureFeedback(ctx: CanvasRenderingContext2D, now: number, v: HandView) {
  const flashing = now - v.firedAt < 700
  const t = v.trigger
  if (!flashing && (!t || t.progress === 0)) return
  const text = flashing ? `✓ ${v.firedLabel}` : describeAction(t!.action)
  const x = v.hand.cursor.x + 34
  const y = v.hand.cursor.y - 34
  ctx.save()
  ctx.font = 'bold 16px system-ui, sans-serif'
  const w = ctx.measureText(text).width + 52
  ctx.fillStyle = flashing ? 'rgba(52, 199, 89, 0.95)' : 'rgba(0, 0, 0, 0.75)'
  ctx.beginPath()
  ctx.roundRect(x, y - 18, w, 36, 18)
  ctx.fill()
  if (!flashing) {
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.beginPath()
    ctx.arc(x + 18, y, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#fff'
    ctx.beginPath()
    ctx.arc(x + 18, y, 10, -Math.PI / 2, -Math.PI / 2 + t!.progress * Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + (flashing ? 16 : 38), y + 1)
  ctx.restore()
}

// Matches the hand's badge on the toolbar so kids can tell which color is theirs
function drawHandTag(ctx: CanvasRenderingContext2D, { id, hand, color }: HandView) {
  const x = hand.cursor.x - 30
  const y = hand.cursor.y + 30
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, Math.PI * 2)
  ctx.fillStyle = color === ERASER ? '#888' : color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(id + 1), x, y + 1)
  ctx.restore()
}

function drawCursor(ctx: CanvasRenderingContext2D, f: OverlayFrame, { hand, color, overUi }: HandView) {
  const ink = color === ERASER ? '#888' : color
  const painting = hand.down && !overUi
  ctx.save()
  if (hand.kind === 'palm' && !overUi) {
    // Ghost of the handprint, getting more solid as the hand approaches
    if (!painting) {
      ctx.globalAlpha = 0.12 + 0.3 * Math.min(hand.press, 1)
      ctx.fillStyle = ink
      ctx.strokeStyle = ink
      traceHand(ctx, hand.points, hand.printWidth)
    }
    ring(ctx, hand.cursor, painting ? 10 : lerp(FAR_RING * 1.5, 14, Math.min(hand.press, 1)), ink, painting)
  } else if (hand.kind === 'fingers' && !overUi) {
    const tip = (f.brush * hand.widthScale) / 2
    FINGERS.forEach(({ tip: i }, k) => {
      if (!hand.extended[k]) return
      ring(ctx, hand.points[i], painting ? Math.max(tip, 5) : lerp(FAR_RING * 0.6, Math.max(tip, 6), Math.min(hand.press, 1)), ink, painting)
    })
  } else {
    const tip = (f.brush * hand.widthScale) / 2
    ring(ctx, hand.cursor, painting ? Math.max(tip, 6) : lerp(FAR_RING, Math.max(tip, 8), Math.min(hand.press, 1)), ink, painting)
  }
  ctx.restore()
}

/** Hovering: hollow ring that shrinks as the hand approaches. Painting: solid dot. */
function ring(ctx: CanvasRenderingContext2D, p: Point, r: number, ink: string, solid: boolean) {
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  if (solid) {
    ctx.fillStyle = ink
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    return
  }
  ctx.lineWidth = 5
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = ink
  ctx.stroke()
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
  ctx.fill()
}


function drawCalibration(ctx: CanvasRenderingContext2D, f: OverlayFrame, c: Calibration) {
  const cx = f.paper.x + f.paper.w / 2
  const cy = f.paper.y + f.paper.h / 2
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillRect(f.paper.x, cy - 110, f.paper.w, 220)
  ctx.fillStyle = '#222'
  ctx.textAlign = 'center'
  ctx.font = 'bold 36px system-ui, sans-serif'
  ctx.fillText(c.prompt, cx, cy - 20)
  ctx.font = 'bold 64px system-ui, sans-serif'
  ctx.fillText(String(c.secondsLeft(f.now)), cx, cy + 60)
  ctx.fillStyle = '#007aff'
  ctx.fillRect(cx - 200, cy + 85, 400 * c.progress(f.now), 8)
  if (f.hands.length === 0) {
    ctx.font = '20px system-ui, sans-serif'
    ctx.fillStyle = '#c00'
    ctx.fillText("I can't see your hand", cx, cy - 75)
  }
  ctx.restore()
}

function drawHint(ctx: CanvasRenderingContext2D, paper: Rect, text: string) {
  ctx.save()
  ctx.font = 'bold 36px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fillText(text, paper.x + paper.w / 2, paper.y + paper.h / 2)
  ctx.restore()
}

/** One detected hand in the camera preview; `hand` is its tracked state (null on its first frame). */
export type PreviewHand = { landmarks: NormalizedLandmark[]; hand: HandState | null }

export type PreviewFrame = {
  w: number
  h: number
  hands: PreviewHand[]
  view: View
  area: Rect
  settings: Settings
}

/** Drawn over the mirrored camera preview: skeletons, the region that maps to the paper, pen meters, recording status. */
export function drawPreview(ctx: CanvasRenderingContext2D, f: PreviewFrame) {
  drawPreviewContent(ctx, f)
}
//
// function drawRecording(ctx: CanvasRenderingContext2D, f: PreviewFrame, r: NonNullable<PreviewFrame['recording']>) {
//   ctx.save()
//   ctx.textAlign = 'center'
//   ctx.textBaseline = 'middle'
//   if (r.countdown > 0) {
//     ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
//     ctx.fillRect(0, 0, f.w, f.h)
//     ctx.fillStyle = '#fff'
//     ctx.font = 'bold 15px system-ui, sans-serif'
//     ctx.fillText(`Get ready: "${r.label}"`, f.w / 2, f.h / 2 - 34)
//     ctx.font = 'bold 54px system-ui, sans-serif'
//     ctx.fillText(String(r.countdown), f.w / 2, f.h / 2 + 12)
//   } else {
//     ctx.strokeStyle = '#ff3b30'
//     ctx.lineWidth = 6
//     ctx.strokeRect(3, 3, f.w - 6, f.h - 6)
//     ctx.fillStyle = '#ff3b30'
//     ctx.fillRect(0, f.h - 6, f.w * r.progress, 6)
//     ctx.beginPath()
//     ctx.arc(18, 18, 7, 0, Math.PI * 2)
//     ctx.fill()
//     ctx.textAlign = 'left'
//     ctx.font = 'bold 14px system-ui, sans-serif'
//     ctx.fillStyle = '#fff'
//     ctx.fillText(`REC "${r.label}"`, 32, 19)
//     if (f.hands.length === 0) {
//       ctx.textAlign = 'center'
//       ctx.fillText('No hand: not saving', f.w / 2, f.h / 2)
//     }
//   }
//   ctx.restore()
// }

function drawPreviewContent(ctx: CanvasRenderingContext2D, f: PreviewFrame) {
  ctx.clearRect(0, 0, f.w, f.h)
  const s = f.settings

  // The part of the camera image that maps onto the toolbars + paper
  const rx = ((f.area.x - f.view.x) / f.view.w) * f.w
  const ry = ((f.area.y - f.view.y) / f.view.h) * f.h
  ctx.save()
  ctx.setLineDash([6, 5])
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.strokeRect(rx, ry, (f.area.w / f.view.w) * f.w, (f.area.h / f.view.h) * f.h)
  ctx.restore()

  if (s.showSkeleton) for (const h of f.hands) drawSkeleton(ctx, f, h)
  if (s.showHud) f.hands.forEach((h, i) => drawMeter(ctx, f, h.hand, i))
}

function drawSkeleton(ctx: CanvasRenderingContext2D, f: PreviewFrame, { landmarks, hand }: PreviewHand) {
  const pts = landmarks.map((p) => ({ x: (1 - p.x) * f.w, y: p.y * f.h }))
  ctx.save()
  ctx.strokeStyle = hand?.down ? '#34c759' : 'rgba(0, 170, 255, 0.9)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (const { start, end } of HAND_CONNECTIONS) {
    ctx.moveTo(pts[start].x, pts[start].y)
    ctx.lineTo(pts[end].x, pts[end].y)
  }
  ctx.stroke()
  // Fingertips: filled when the finger counts as extended
  FINGERS.forEach(({ tip }, k) => {
    ctx.beginPath()
    ctx.arc(pts[tip].x, pts[tip].y, 4, 0, Math.PI * 2)
    ctx.fillStyle = hand?.extended[k] ? '#ffcc00' : 'rgba(255, 255, 255, 0.6)'
    ctx.fill()
  })
  ctx.restore()
}

/** The signal that decides pen down for this hand, and its press and release thresholds. */
function meterValues(s: Settings, hand: HandState | null) {
  if (s.mode === 'gesture') return { value: hand?.press === 1 ? 1 : 0, press: 0.9, release: 0.5, max: 1.3 }
  if (s.mode === 'pinch' && hand?.kind === 'pointer') {
    // Show "closeness" so the bar fills upward as fingers pinch together
    return { value: hand ? 1.2 - hand.pinch : 0, press: 1.2 - s.pinchPress, release: 1.2 - (s.pinchPress + s.pinchGap), max: 1.3 }
  }
  if (s.reachStyle === 'relative') {
    return { value: hand?.push ?? 0, press: s.pushAmount, release: s.pushAmount - s.pushGap, max: Math.max(s.pushAmount * 2, 0.3) }
  }
  return { value: hand?.depth ?? 0, press: s.pressAt, release: s.pressAt - s.gap, max: 1.3 }
}

// Bar on the right edge (one per hand), with press (green) and release (orange) lines
function drawMeter(ctx: CanvasRenderingContext2D, f: PreviewFrame, hand: HandState | null, index: number) {
  const { value, press, release, max } = meterValues(f.settings, hand)
  const mw = 12
  const mh = f.h - 24
  const mx = f.w - mw - 10 - index * (mw + 14)
  const my = 12
  const yOf = (v: number) => my + mh - (Math.min(Math.max(v, 0), max) / max) * mh
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6)
  ctx.fillStyle = hand?.down ? '#34c759' : '#7aa7ff'
  ctx.fillRect(mx, yOf(value), mw, my + mh - yOf(value))
  ctx.lineWidth = 2
  for (const [v, color] of [[press, '#34c759'], [release, '#ff9500']] as const) {
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(mx - 5, yOf(v))
    ctx.lineTo(mx + mw + 5, yOf(v))
    ctx.stroke()
  }
  ctx.restore()
}

export type HudHand = { hand: HandState; gesture: string; overUi: boolean }

export function hudText(s: Settings, hands: HudHand[], fps: number) {
  const reach = s.reachStyle === 'relative' ? 'relative' : 'fixed'
  const lines = [`${fps.toFixed(0)} fps   model ${s.gestureModel}`, `pen-down by ${s.mode}${s.mode === 'reach' ? ` (${reach})` : ''}`]
  if (hands.length === 0) lines.push('no hand')
  hands.forEach(({ hand, gesture, overUi }, i) => {
    const fingers = FINGERS.filter((_, k) => hand.extended[k]).map((f) => f.name).join(' ') || '–'
    lines.push(
      '',
      `hand ${i + 1}  ${hand.kind}   pen ${hand.down ? 'DOWN' : 'up'}${overUi ? ' (over button)' : ''}`,
      `  gesture ${gesture || '–'}`,
      `  fingers ${fingers}`,
      `  push ${(hand.push * 100).toFixed(0)}%   depth ${hand.depth.toFixed(2)}   pinch ${hand.pinch.toFixed(2)}`,
    )
  })
  return lines.join('\n')
}
