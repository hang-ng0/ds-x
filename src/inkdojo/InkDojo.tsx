import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { Dwell } from '../fingerpaint/dwell'
import { computeView, toScreen, type Rect } from '../fingerpaint/hand'
import { InkCanvas, paperTexture, type Pt } from './inkfx'
import InkPanel from './InkPanel'
import { MoveDetector, type CamPoint, type MoveKind } from './moves'
import { drawOverlay, drawPreview, hudText, MOVE_LABELS, popupsAlive, type Popup } from './overlay'
import { createPoseLandmarker } from './pose'
import { DEFAULT_INK_SETTINGS, loadInkSettings, saveInkSettings, type InkSettings, type PaperStyle } from './settings'
import '../fingerpaint/FingerPaint.css'
import './inkdojo.css'

// Neon, high-contrast inks. The last swatch ("base") is white on dark paper and black on rice paper.
const BASE_INK = 'base'
const INK_COLORS = [
  { name: 'Neon pink', value: '#ff2bd6' },
  { name: 'Neon green', value: '#39ff14' },
  { name: 'Electric blue', value: '#00e5ff' },
  { name: 'Neon yellow', value: '#faff00' },
  { name: 'Neon orange', value: '#ff6b00' },
  { name: 'Neon violet', value: '#b026ff' },
  { name: 'White / black', value: BASE_INK },
]
const resolveInk = (color: string, paper: PaperStyle) => (color === BASE_INK ? (paper === 'dark' ? '#ffffff' : '#141414') : color)

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })

function describeError(err: unknown) {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Camera permission was denied. You can still play with the mouse.'
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No camera found. You can still play with the mouse.'
  return `Couldn't start the camera: ${err instanceof Error ? err.message : String(err)}`
}

/** A random curved path across the paper, for effect demos */
function demoPath(w: number, h: number, low: boolean): Pt[] {
  const y0 = h * (low ? 0.55 + Math.random() * 0.3 : 0.2 + Math.random() * 0.5)
  const x0 = w * (0.1 + Math.random() * 0.2)
  const x1 = w * (0.7 + Math.random() * 0.2)
  const bend = h * (Math.random() - 0.5) * 0.5
  const flip = Math.random() < 0.5
  return Array.from({ length: 14 }, (_, i) => {
    const t = i / 13
    const x = x0 + (x1 - x0) * t
    return { x: flip ? w - x : x, y: y0 + Math.sin(t * Math.PI) * bend - (low ? t * h * 0.25 : 0) }
  })
}

export default function InkDojo() {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const baseGlowRef = useRef<HTMLCanvasElement>(null)
  const liveGlowRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLPreElement>(null)

  const [settings, setSettings] = useState<InkSettings>(loadInkSettings)
  const [color, setColor] = useState(INK_COLORS[0].value)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready'>('loading')
  const [videoAspect, setVideoAspect] = useState(4 / 3)
  const [panelOpen, setPanelOpen] = useState(false)

  // The render loop runs outside React and reads current values through these refs
  const settingsRef = useRef(settings)
  const inkRef = useRef<InkCanvas | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const demoRef = useRef<(kind: MoveKind) => void>(() => {})
  const pointerPathRef = useRef<{ pts: Pt[]; start: number } | null>(null)

  useEffect(() => {
    settingsRef.current = settings
    saveInkSettings(settings)
    const ink = inkRef.current
    if (!ink) return
    ink.opacity = settings.inkOpacity
    ink.splatter = settings.splatter
    ink.drips = settings.drips
    ink.scale = settings.inkScale
  }, [settings])

  useEffect(() => {
    if (inkRef.current) inkRef.current.color = resolveInk(color, settings.paper)
  }, [color, settings.paper])

  // Paper style: texture, how ink blends, and the glow layers
  useEffect(() => {
    const dark = settings.paper === 'dark'
    paperRef.current!.style.backgroundImage = `url(${paperTexture(dark)})`
    const ink = inkRef.current
    if (!ink) return
    ink.dark = dark
    ink.refreshGlow()
  }, [settings.paper])

  // (Re)load the pose model when the choice changes; the loop picks it up from the ref
  useEffect(() => {
    let cancelled = false
    let created: PoseLandmarker | null = null
    createPoseLandmarker(settings.model).then(
      (landmarker) => {
        if (cancelled) {
          landmarker.close()
          return
        }
        created = landmarker
        landmarkerRef.current = landmarker
        setModelStatus('ready')
      },
      (err: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: `Couldn't load body tracking: ${err instanceof Error ? err.message : String(err)}` })
      },
    )
    return () => {
      cancelled = true
      setModelStatus('loading')
      if (landmarkerRef.current === created) landmarkerRef.current = null
      created?.close()
    }
  }, [settings.model])

  useEffect(() => {
    const workspace = workspaceRef.current!
    const paper = paperRef.current!
    const video = videoRef.current!
    const overlay = overlayRef.current!
    const preview = previewRef.current!
    const hud = hudRef.current!
    const octx = overlay.getContext('2d')!
    const pctx = preview.getContext('2d')!
    const ink = new InkCanvas(baseRef.current!, liveRef.current!, { base: baseGlowRef.current!, live: liveGlowRef.current! })
    const s0 = settingsRef.current
    Object.assign(ink, { opacity: s0.inkOpacity, splatter: s0.splatter, drips: s0.drips, scale: s0.inkScale, dark: s0.paper === 'dark' })
    inkRef.current = ink
    const detector = new MoveDetector()
    const dwells = [new Dwell(), new Dwell()]

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let lastVideoTime = -1
    let lastTick = performance.now()
    let lastFrameTime = 0
    let fps = 0
    let lastSeen = performance.now()
    let lastMove = ''
    let popups: Popup[] = []
    let trails: { pts: Pt[]; moving: boolean }[] = []

    const sizeCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const resizeOverlay = () => sizeCanvas(overlay, octx, window.innerWidth, window.innerHeight)
    resizeOverlay()
    window.addEventListener('resize', resizeOverlay)
    const observer = new ResizeObserver(() => {
      ink.resize(paper.clientWidth, paper.clientHeight)
      sizeCanvas(preview, pctx, preview.clientWidth, preview.clientHeight)
    })
    observer.observe(paper)
    observer.observe(preview)

    const popup = (kind: MoveKind, at: Pt) => {
      popups.push({ text: MOVE_LABELS[kind], x: at.x, y: at.y, born: performance.now(), tilt: (Math.random() - 0.5) * 0.35 })
      lastMove = kind
    }

    // Effect demos (Tune panel buttons, keys 1–4): random spots on the paper
    demoRef.current = (kind) => {
      const { w, h } = ink.size
      const p = paper.getBoundingClientRect()
      const power = 1.3 + Math.random() * 1.5
      if (kind === 'punch') {
        const at = { x: w * (0.2 + Math.random() * 0.6), y: h * (0.2 + Math.random() * 0.5) }
        const a = Math.random() * Math.PI * 2
        ink.punch(at, { x: Math.cos(a), y: Math.sin(a) }, power)
        popup(kind, { x: p.left + at.x, y: p.top + at.y })
      } else if (kind === 'slash' || kind === 'kick') {
        const path = demoPath(w, h, kind === 'kick')
        ink.slash(path, power, kind === 'kick')
        const end = path[path.length - 1]
        popup(kind, { x: p.left + end.x, y: p.top + end.y })
      } else {
        const x = w * (0.2 + Math.random() * 0.6)
        ink.splash(x, power)
        popup(kind, { x: p.left + x, y: p.top + h * 0.75 })
      }
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      // Ink animates every display frame, independently of the camera
      ink.frame((now - lastTick) / 1000)
      lastTick = now

      const s = settingsRef.current
      const area = toRect(workspace.getBoundingClientRect())
      const paperRect = toRect(paper.getBoundingClientRect())
      const landmarker = landmarkerRef.current
      if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        if (lastFrameTime) fps = fps * 0.9 + (1000 / (now - lastFrameTime)) * 0.1
        lastFrameTime = now

        const result = landmarker.detectForVideo(video, now)
        const lm = result.landmarks[0] ?? null
        const view = computeView(video.videoWidth, video.videoHeight, area, s.activeArea, 0)
        const screen = (p: CamPoint) => toScreen(p, view)
        const toPaper = (p: CamPoint) => {
          const q = screen(p)
          return { x: q.x - paperRect.x, y: q.y - paperRect.y }
        }
        const { moves, debug } = detector.update(lm, now, video.videoWidth / video.videoHeight, s)
        if (lm) lastSeen = now

        for (const m of moves) {
          if (m.kind === 'punch') ink.punch(toPaper(m.at), m.dir, m.power)
          else if (m.kind === 'slash' || m.kind === 'kick') ink.slash(m.path.map(toPaper), m.power, m.kind === 'kick')
          else ink.splash(toPaper(m.at).x, m.power)
          const at = m.kind === 'jump' ? { x: screen(m.at).x, y: paperRect.y + paperRect.h * 0.75 } : screen(m.at)
          popup(m.kind, at)
        }

        // Hands can press toolbar buttons by hovering
        const arms = debug?.limbs.filter((l) => l.limb.endsWith('Arm')) ?? []
        dwells.forEach((dwell, i) => {
          const at = arms[i]?.at
          const p = at ? screen(at) : null
          const hit = p ? document.elementFromPoint(p.x, p.y) : null
          dwell.update(hit?.closest<HTMLElement>('[data-dwell]') ?? null, now)
        })

        trails = (debug?.limbs ?? []).filter((l) => l.at).map((l) => ({ pts: l.trail.map(screen), moving: l.moving }))
        drawPreview(pctx, { w: preview.clientWidth, h: preview.clientHeight, landmarks: lm, debug, settings: s })
        if (s.showHud) hud.textContent = hudText(debug, fps, lastMove)
      }

      popups = popupsAlive(popups, now)
      const noBody = landmarker !== null && now - lastSeen > 1500
      drawOverlay(octx, {
        w: window.innerWidth,
        h: window.innerHeight,
        now,
        color: ink.color,
        trails: noBody ? [] : trails,
        popups,
        paper: paperRect,
        hint: noBody ? 'Step back so I can see you 🥋' : null,
        dark: s.paper === 'dark',
      })
    }

    const start = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: { ideal: 30 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream = media
        video.srcObject = media
        await video.play()
        setVideoAspect(video.videoWidth / video.videoHeight)
        setStatus({ kind: 'ready' })
      } catch (err) {
        if (!cancelled) setStatus({ kind: 'error', message: describeError(err) })
      }
    }
    raf = requestAnimationFrame(frame)
    start()

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const demo = (['punch', 'slash', 'kick', 'jump'] as const)[Number(e.key) - 1]
      if (demo) demoRef.current(demo)
      else if (e.key === 's') setPanelOpen((open) => !open)
      else if (e.key === 'z') ink.undo()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resizeOverlay)
      window.removeEventListener('keydown', onKey)
      observer.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      inkRef.current = null
    }
  }, [])

  // Mouse/touch: click to punch, drag to swoosh (handy for testing without standing up)
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerPathRef.current = { pts: [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }], start: performance.now() }
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    pointerPathRef.current?.pts.push({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
  }
  const onPointerUp = () => {
    const drag = pointerPathRef.current
    const ink = inkRef.current
    pointerPathRef.current = null
    if (!drag || !ink) return
    const pts = drag.pts
    let len = 0
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (len < 15) {
      ink.punch(pts[0], { x: 0, y: 0 }, 1.5)
    } else {
      const speed = len / Math.max((performance.now() - drag.start) / 1000, 0.05)
      ink.slash(pts, Math.min(Math.max(speed / 900, 1), 3))
    }
  }

  return (
    <div className="fp-app">
      <main className="fp-workspace ink-workspace" ref={workspaceRef}>
        <nav className="fp-bar fp-colors" data-ui>
          {INK_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              data-dwell="900"
              aria-label={c.name}
              title={c.name}
              className={`fp-tool fp-color${color === c.value ? ' selected' : ''}`}
              style={{ '--swatch': resolveInk(c.value, settings.paper) } as CSSProperties}
              onClick={() => setColor(c.value)}
            />
          ))}
          <span className="fp-divider ink-divider" />
          <button type="button" data-dwell="900" aria-label="Undo" title="Undo (Z)" className="fp-tool" onClick={() => inkRef.current?.undo()}>
            ↩️
          </button>
          <button type="button" data-dwell="1500" aria-label="Clear" title="Clear" className="fp-tool" onClick={() => inkRef.current?.clear()}>
            🗑️
          </button>
        </nav>

        <div className={`fp-paper ink-paper${settings.paper === 'dark' ? ' ink-dark' : ''}`} ref={paperRef}>
          {/* Blurred half-size copies of the ink layers, for the neon glow on dark paper */}
          <canvas ref={baseGlowRef} className="ink-layer ink-glow" />
          <canvas
            ref={baseRef}
            className="ink-layer ink-base"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <canvas ref={liveGlowRef} className="ink-layer ink-glow" />
          <canvas ref={liveRef} className="ink-layer ink-live" />
        </div>
      </main>

      <aside className="fp-sidebar" data-ui>
        <div className="fp-camera" style={{ aspectRatio: videoAspect }}>
          <video ref={videoRef} playsInline muted />
          <canvas ref={previewRef} />
          {status.kind === 'loading' && <div className="fp-camera-status">Starting camera…</div>}
          {status.kind === 'ready' && modelStatus === 'loading' && <div className="fp-camera-status">Loading body tracking…</div>}
          {status.kind === 'error' && <div className="fp-camera-status fp-error">{status.message}</div>}
        </div>
        <p className="ink-tip">Stand back so your whole body fits in the camera. Punch, swoosh your arms, kick and jump!</p>

        <div className="fp-actions">
          <button type="button" title="Tune moves and ink (S)" className={panelOpen ? 'active' : ''} onClick={() => setPanelOpen((open) => !open)}>
            <span>⚙️</span>Tune
          </button>
          <a href={`${import.meta.env.BASE_URL}`} title="Back to the finger painting app">
            <span>✋</span>Finger Paint
          </a>
        </div>

        <pre className="fp-hud" ref={hudRef} hidden={!settings.showHud} />

        {panelOpen && (
          <InkPanel
            settings={settings}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            onDemo={(kind) => demoRef.current(kind)}
            onReset={() => setSettings({ ...DEFAULT_INK_SETTINGS })}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </aside>

      <canvas ref={overlayRef} className="fp-overlay" />
    </div>
  )
}
