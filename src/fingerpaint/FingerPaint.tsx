import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { GestureRecognizer } from '@mediapipe/tasks-vision'
import { Calibration } from './calibration'
import { Dwell } from './dwell'
import { computeView, createRecognizer, PenTracker } from './hand'
import { drawOverlay } from './overlay'
import { ERASER, Painter } from './painter'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings'
import SettingsPanel from './SettingsPanel'
import './FingerPaint.css'

const COLORS = [
  { name: 'Red', value: '#ff3b30' },
  { name: 'Orange', value: '#ff9500' },
  { name: 'Yellow', value: '#ffcc00' },
  { name: 'Green', value: '#34c759' },
  { name: 'Blue', value: '#007aff' },
  { name: 'Purple', value: '#af52de' },
  { name: 'Pink', value: '#ff2d92' },
  { name: 'Brown', value: '#8b5a2b' },
  { name: 'Black', value: '#222222' },
]
const BRUSHES = [8, 18, 36]

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

function describeError(err: unknown) {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Camera permission was denied. You can still draw with the mouse.'
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'No camera found. You can still draw with the mouse.'
  }
  return `Couldn't start hand tracking: ${err instanceof Error ? err.message : String(err)}`
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

export default function FingerPaint() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [color, setColor] = useState(COLORS[4].value)
  const [brush, setBrush] = useState(BRUSHES[1])
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [panelOpen, setPanelOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The render loop runs outside React and reads current values through these refs
  const settingsRef = useRef(settings)
  const brushRef = useRef({ color, size: brush })
  const painterRef = useRef<Painter | null>(null)
  const recognizerRef = useRef<GestureRecognizer | null>(null)
  const calibrationRef = useRef<Calibration | null>(null)
  const pointerDrawingRef = useRef(false)

  useEffect(() => {
    settingsRef.current = settings
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    brushRef.current = { color, size: brush }
  }, [color, brush])

  useEffect(() => {
    const c = settings.minDetect
    recognizerRef.current?.setOptions({
      minHandDetectionConfidence: c,
      minHandPresenceConfidence: c,
      minTrackingConfidence: c,
    })
  }, [settings.minDetect])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  const updateSettings = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }))

  const beginCalibration = useCallback(() => {
    setPanelOpen(false)
    setSettings((prev) => ({ ...prev, mode: 'reach' }))
    calibrationRef.current = new Calibration(performance.now())
  }, [])

  useEffect(() => {
    const video = videoRef.current!
    const paintCanvas = paintRef.current!
    const overlay = overlayRef.current!
    const octx = overlay.getContext('2d')!
    const painter = new Painter(paintCanvas)
    painterRef.current = painter
    const tracker = new PenTracker()
    const dwell = new Dwell()

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let recognizer: GestureRecognizer | null = null
    let lastVideoTime = -1
    let lastFrameTime = 0
    let fps = 0
    let handStroke = false
    let lastSeen = performance.now()

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = window.devicePixelRatio || 1
      painter.resize(w, h)
      overlay.width = Math.round(w * dpr)
      overlay.height = Math.round(h * dpr)
      overlay.style.width = `${w}px`
      overlay.style.height = `${h}px`
      octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!recognizer || video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime
      const now = performance.now()
      if (lastFrameTime) fps = fps * 0.9 + (1000 / (now - lastFrameTime)) * 0.1
      lastFrameTime = now

      const result = recognizer.recognizeForVideo(video, now)
      const s = settingsRef.current
      const w = window.innerWidth
      const h = window.innerHeight
      const landmarks = result.landmarks[0] ?? null
      const view = computeView(video.videoWidth, video.videoHeight, w, h, s.activeArea)
      const pen = tracker.update(landmarks, now, s, view, w, h)
      if (pen) lastSeen = now

      // Toolbar buttons are pressed by hovering; never paint underneath any UI
      const hit = pen ? document.elementFromPoint(pen.x, pen.y) : null
      const overUi = !!hit?.closest('[data-ui]')
      dwell.update(hit?.closest<HTMLElement>('[data-dwell]') ?? null, now)

      const calibration = calibrationRef.current
      if (calibration) {
        const res = calibration.update(pen?.palm ?? null, now)
        if (res) {
          calibrationRef.current = null
          if (res.ok) {
            setSettings((prev) => ({ ...prev, far: round3(res.far), near: round3(res.near) }))
            setNotice('Calibrated! Reach out to paint.')
          } else {
            setNotice("Couldn't see much difference. Try again and reach closer to the screen.")
          }
        }
      }

      // A mouse stroke took over the painter
      if (pointerDrawingRef.current) handStroke = false
      const shouldPaint = !overUi && !calibrationRef.current && !pointerDrawingRef.current
      if (pen?.down && shouldPaint) {
        const { color, size } = brushRef.current
        const width = size * pen.widthScale
        if (handStroke) {
          painter.extend(pen, width)
        } else {
          painter.begin(pen, width, color)
          handStroke = true
        }
      } else if (handStroke) {
        painter.end()
        handStroke = false
      }

      drawOverlay(octx, {
        w,
        h,
        now,
        pen,
        landmarks,
        view,
        settings: s,
        color: brushRef.current.color,
        brush: brushRef.current.size,
        overTarget: overUi,
        calibration: calibrationRef.current,
        fps,
        gesture: result.gestures[0]?.[0]?.categoryName ?? '',
        handMissingMs: now - lastSeen,
      })
    }

    const start = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream = media
        video.srcObject = media
        await video.play()
        const created = await createRecognizer(settingsRef.current.minDetect)
        if (cancelled) {
          created.close()
          return
        }
        recognizer = created
        recognizerRef.current = created
        setStatus({ kind: 'ready' })
        raf = requestAnimationFrame(frame)
      } catch (err) {
        if (!cancelled) setStatus({ kind: 'error', message: describeError(err) })
      }
    }
    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      stream?.getTracks().forEach((t) => t.stop())
      recognizer?.close()
      recognizerRef.current = null
      painterRef.current = null
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'c') beginCalibration()
      else if (e.key === 's') setPanelOpen((open) => !open)
      else if (e.key === 'z') painterRef.current?.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [beginCalibration])

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerDrawingRef.current = true
    painterRef.current?.begin({ x: e.clientX, y: e.clientY }, brush, color)
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerDrawingRef.current) painterRef.current?.extend({ x: e.clientX, y: e.clientY }, brush)
  }
  const onPointerUp = () => {
    if (!pointerDrawingRef.current) return
    pointerDrawingRef.current = false
    painterRef.current?.end()
  }

  return (
    <div className="fp-stage">
      <video
        ref={videoRef}
        className="fp-video"
        playsInline
        muted
        style={{ opacity: settings.videoOpacity, transform: `scaleX(-1) scale(${1 / settings.activeArea})` }}
      />
      <canvas
        ref={paintRef}
        className="fp-paint"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas ref={overlayRef} className="fp-overlay" />

      <nav className="fp-toolbar" data-ui>
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            data-dwell="700"
            aria-label={c.name}
            className={`fp-tool fp-color${color === c.value ? ' selected' : ''}`}
            style={{ '--swatch': c.value } as CSSProperties}
            onClick={() => setColor(c.value)}
          />
        ))}
        <button
          type="button"
          data-dwell="700"
          aria-label="Eraser"
          className={`fp-tool fp-eraser${color === ERASER ? ' selected' : ''}`}
          onClick={() => setColor(ERASER)}
        >
          🧽
        </button>
        <span className="fp-divider" />
        {BRUSHES.map((size) => (
          <button
            key={size}
            type="button"
            data-dwell="700"
            aria-label={`Brush size ${size}`}
            className={`fp-tool fp-brush${brush === size ? ' selected' : ''}`}
            style={{ '--size': `${size}px` } as CSSProperties}
            onClick={() => setBrush(size)}
          />
        ))}
        <span className="fp-divider" />
        <button type="button" data-dwell="900" aria-label="Undo" className="fp-tool" onClick={() => painterRef.current?.undo()}>
          ↩️
        </button>
        <button type="button" data-dwell="1500" aria-label="Clear" className="fp-tool" onClick={() => painterRef.current?.clear()}>
          🗑️
        </button>
      </nav>

      <button type="button" className="fp-gear" data-ui aria-label="Settings (S)" onClick={() => setPanelOpen((open) => !open)}>
        ⚙️
      </button>
      {panelOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onCalibrate={beginCalibration}
          onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {status.kind === 'loading' && <div className="fp-status">Starting camera…</div>}
      {status.kind === 'error' && <div className="fp-status fp-error">{status.message}</div>}
      {notice && <div className="fp-notice">{notice}</div>}
    </div>
  )
}
