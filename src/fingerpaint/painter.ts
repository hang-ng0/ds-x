import { FINGERS, HAND_CONNECTIONS, PALM, type Point } from './hand'

export const ERASER = 'eraser'
const MAX_UNDO = 10
// Landmarks smeared from the previous frame's handprint so fast moves don't leave gaps
const SMEAR_POINTS = [0, 5, 9, 13, 17, ...FINGERS.map((f) => f.tip)]

type Stroke = { prev: Point; lastMid: Point; color: string; width: number; ctx: CanvasRenderingContext2D }

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
 *
 * Paint goes onto a separate layer canvas at full strength and is blended into the painting at
 * `opacity` on `commit()`. That way a stroke never darkens where it overlaps itself, but separate
 * strokes build up, so you can shade. The layer element should be shown at the same CSS opacity.
 * The eraser skips the layer and always erases fully.
 */
export class Painter {
  opacity = 1
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private layer: HTMLCanvasElement
  private layerCtx: CanvasRenderingContext2D
  private layerDirty = false
  private undoStack: ImageData[] = []
  private strokes = new Map<string, Stroke>()

  constructor(canvas: HTMLCanvasElement, layer: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.layer = layer
    this.layerCtx = layer.getContext('2d')!
  }

  resize(cssW: number, cssH: number) {
    if (cssW === 0 || cssH === 0) return
    this.commit()
    const dpr = window.devicePixelRatio || 1
    const old = document.createElement('canvas')
    old.width = this.canvas.width
    old.height = this.canvas.height
    old.getContext('2d')!.drawImage(this.canvas, 0, 0)

    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(cssW * dpr)
      c.height = Math.round(cssH * dpr)
    }
    this.ctx.drawImage(old, 0, 0)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
    const ctx = this.target(color)
    this.strokes.set(id, { prev: p, lastMid: p, color, width, ctx })
    this.applyStyle(ctx, color, width)
    ctx.beginPath()
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  extend(id: string, p: Point, width: number) {
    const s = this.strokes.get(id)
    if (!s || Math.hypot(p.x - s.prev.x, p.y - s.prev.y) < 0.5) return
    // Midpoint quadratic smoothing: curve through each sample toward the next midpoint
    const mid = { x: (s.prev.x + p.x) / 2, y: (s.prev.y + p.y) / 2 }
    s.width = width
    this.applyStyle(s.ctx, s.color, width)
    s.ctx.beginPath()
    s.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    s.ctx.quadraticCurveTo(s.prev.x, s.prev.y, mid.x, mid.y)
    s.ctx.stroke()
    s.lastMid = mid
    s.prev = p
  }

  end(id: string) {
    const s = this.strokes.get(id)
    if (!s) return
    this.applyStyle(s.ctx, s.color, s.width)
    s.ctx.beginPath()
    s.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    s.ctx.lineTo(s.prev.x, s.prev.y)
    s.ctx.stroke()
    this.strokes.delete(id)
  }

  /** One frame of handprint painting; `prev` is the previous frame's points, to smear between them. */
  stampHand(pts: Point[], prev: Point[] | null, thickness: number, color: string) {
    const ctx = this.target(color)
    this.applyStyle(ctx, color, thickness)
    traceHand(ctx, pts, thickness)
    if (!prev) return
    ctx.beginPath()
    for (const i of SMEAR_POINTS) {
      ctx.moveTo(prev[i].x, prev[i].y)
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.stroke()
  }

  /** Ends any open strokes and blends the layer into the painting. Call when a hand or mouse stops painting. */
  commit() {
    for (const id of [...this.strokes.keys()]) this.end(id)
    if (!this.layerDirty) return
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = this.opacity
    this.ctx.drawImage(this.layer, 0, 0)
    this.ctx.restore()
    this.clearLayer()
  }

  undo() {
    this.strokes.clear()
    this.clearLayer()
    const snapshot = this.undoStack.pop()
    if (snapshot) this.ctx.putImageData(snapshot, 0, 0)
  }

  clear() {
    this.commit()
    this.checkpoint()
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private target(color: string) {
    if (color === ERASER) return this.ctx
    this.layerDirty = true
    return this.layerCtx
  }

  private clearLayer() {
    this.layerCtx.save()
    this.layerCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.layerCtx.clearRect(0, 0, this.layer.width, this.layer.height)
    this.layerCtx.restore()
    this.layerDirty = false
  }

  private applyStyle(ctx: CanvasRenderingContext2D, color: string, width: number) {
    const erasing = color === ERASER
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.strokeStyle = erasing ? '#000' : color
    ctx.fillStyle = ctx.strokeStyle
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }
}
