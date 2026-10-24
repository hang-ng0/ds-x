import type { Point } from './hand'

export const ERASER = 'eraser'
const MAX_UNDO = 10

/** Owns the paint canvas: smooth variable-width strokes, eraser, undo, and resize without losing the drawing. */
export class Painter {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private undoStack: ImageData[] = []
  private stroke: { prev: Point; lastMid: Point; color: string; width: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  get stroking() {
    return this.stroke !== null
  }

  resize(cssW: number, cssH: number) {
    const dpr = window.devicePixelRatio || 1
    const old = document.createElement('canvas')
    old.width = this.canvas.width
    old.height = this.canvas.height
    old.getContext('2d')!.drawImage(this.canvas, 0, 0)

    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    this.ctx.drawImage(old, 0, 0)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Snapshots no longer match the canvas size
    this.undoStack = []
  }

  begin(p: Point, width: number, color: string) {
    this.end()
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height))
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.stroke = { prev: p, lastMid: p, color, width }
    this.applyStyle(width)
    this.ctx.beginPath()
    this.ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
    this.ctx.fill()
  }

  extend(p: Point, width: number) {
    const s = this.stroke
    if (!s || Math.hypot(p.x - s.prev.x, p.y - s.prev.y) < 0.5) return
    // Midpoint quadratic smoothing: curve through each sample toward the next midpoint
    const mid = { x: (s.prev.x + p.x) / 2, y: (s.prev.y + p.y) / 2 }
    s.width = width
    this.applyStyle(width)
    this.ctx.beginPath()
    this.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    this.ctx.quadraticCurveTo(s.prev.x, s.prev.y, mid.x, mid.y)
    this.ctx.stroke()
    s.lastMid = mid
    s.prev = p
  }

  end() {
    const s = this.stroke
    if (!s) return
    this.applyStyle(s.width)
    this.ctx.beginPath()
    this.ctx.moveTo(s.lastMid.x, s.lastMid.y)
    this.ctx.lineTo(s.prev.x, s.prev.y)
    this.ctx.stroke()
    this.stroke = null
  }

  undo() {
    this.end()
    const snapshot = this.undoStack.pop()
    if (snapshot) this.ctx.putImageData(snapshot, 0, 0)
  }

  clear() {
    this.end()
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height))
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private applyStyle(width: number) {
    const color = this.stroke?.color ?? '#000'
    const erasing = color === ERASER
    this.ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    this.ctx.strokeStyle = erasing ? '#000' : color
    this.ctx.fillStyle = this.ctx.strokeStyle
    this.ctx.lineWidth = width
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
  }
}
