import { FINGERS, HAND_CONNECTIONS, PALM, type Point } from './hand'

export const ERASER = 'eraser'
const MAX_UNDO = 10
// Landmarks smeared from the previous frame's handprint so fast moves don't leave gaps
const SMEAR_POINTS = [0, 5, 9, 13, 17, ...FINGERS.map((f) => f.tip)]

type Stroke = { prev: Point; lastMid: Point; color: string; width: number }

/** Draws a hand silhouette (filled palm plus thick bones). Uses the context's current fill/stroke. */
export function traceHand(ctx: CanvasRenderingContext2D, pts: Point[], thickness: number) {
  ctx.lineWidth = thickness
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  PALM.forEach((i, k) => (k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y)))
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  for (const { start, end } of HAND_CONNECTIONS) {
    ctx.moveTo(pts[start].x, pts[start].y)
    ctx.lineTo(pts[end].x, pts[end].y)
  }
  ctx.stroke()
}

/**
 * Owns the paint canvas: several simultaneous smooth strokes (one per finger), handprints,
 * eraser, undo, and resize without losing the drawing. Coordinates are canvas-local CSS pixels.
 */
export class Painter {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private undoStack: ImageData[] = []
  private strokes = new Map<string, Stroke>()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  resize(cssW: number, cssH: number) {
    if (cssW === 0 || cssH === 0) return
    const dpr = window.devicePixelRatio || 1
    const old = document.createElement('canvas')
    old.width = this.canvas.width
    old.height = this.canvas.height
    old.getContext('2d')!.drawImage(this.canvas, 0, 0)

    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.ctx.drawImage(old, 0, 0)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Snapshots no longer match the canvas size
    this.undoStack = []
  }

  /** Saves an undo point. Call once when a hand or mouse starts painting. */
  checkpoint() {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height))
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
  }

  has(id: string) {
    return this.strokes.has(id)
  }

  begin(id: string, p: Point, width: number, color: string) {
    this.end(id)
    this.strokes.set(id, { prev: p, lastMid: p, color, width })
    this.applyStyle(color, width)
    this.ctx.beginPath()
    this.ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
    this.ctx.fill()
  }

  extend(id: string, p: Point, width: number) {
    const s = this.strokes.get(id)
    if (!s || Math.hypot(p.x - s.prev.x, p.y - s.prev.y) < 0.5) return
    // Midpoint quadratic smoothing: curve through each sample toward the next midpoint
    const mid = { x: (s.prev.x + p.x) / 2, y: (s.prev.y + p.y) / 2 }
    s.width = width
    this.applyStyle(s.color, width)
    this.ctx.beginPath()
    this.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    this.ctx.quadraticCurveTo(s.prev.x, s.prev.y, mid.x, mid.y)
    this.ctx.stroke()
    s.lastMid = mid
    s.prev = p
  }

  end(id: string) {
    const s = this.strokes.get(id)
    if (!s) return
    this.applyStyle(s.color, s.width)
    this.ctx.beginPath()
    this.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    this.ctx.lineTo(s.prev.x, s.prev.y)
    this.ctx.stroke()
    this.strokes.delete(id)
  }

  /** One frame of handprint painting; `prev` is the previous frame's points, to smear between them. */
  stampHand(pts: Point[], prev: Point[] | null, thickness: number, color: string) {
    this.applyStyle(color, thickness)
    traceHand(this.ctx, pts, thickness)
    if (!prev) return
    this.ctx.beginPath()
    for (const i of SMEAR_POINTS) {
      this.ctx.moveTo(prev[i].x, prev[i].y)
      this.ctx.lineTo(pts[i].x, pts[i].y)
    }
    this.ctx.stroke()
  }

  undo() {
    for (const id of [...this.strokes.keys()]) this.end(id)
    const snapshot = this.undoStack.pop()
    if (snapshot) this.ctx.putImageData(snapshot, 0, 0)
  }

  clear() {
    for (const id of [...this.strokes.keys()]) this.end(id)
    this.checkpoint()
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private applyStyle(color: string, width: number) {
    const erasing = color === ERASER
    this.ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    this.ctx.strokeStyle = erasing ? '#000' : color
    this.ctx.fillStyle = this.ctx.strokeStyle
    this.ctx.lineWidth = width
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
  }
}
