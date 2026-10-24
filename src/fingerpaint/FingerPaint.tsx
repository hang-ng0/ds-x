import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { GestureRecognizer } from '@mediapipe/tasks-vision'
import { Calibration } from './calibration'
import { Dwell } from './dwell'
import GesturePanel from './GesturePanel'
import { CANNED_GESTURES, describeAction, GestureTrigger, isNoneLabel, topGesture } from './gestures'
import { computeView, createRecognizer, FINGERS, PenTracker, type Point, type Rect } from './hand'
import { drawOverlay, drawPreview, hudText } from './overlay'
import { ERASER, Painter } from './painter'
import { BRUSHES, COLORS, TOOLS } from './palette'
import { Recorder, SampleStore, type RecordingState } from './samples'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GestureAction, type Settings, type Tool } from './settings'
import SettingsPanel from './SettingsPanel'
import './FingerPaint.css'

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

function describeError(err: unknown) {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Camera permission was denied. You can still draw with the mouse.'
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'No camera found. You can still draw with the mouse.'
  }
  return `Couldn't start the camera: ${err instanceof Error ? err.message : String(err)}`
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })

export default function FingerPaint() {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLPreElement>(null)

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [color, setColor] = useState(COLORS[4].value)
  const [brush, setBrush] = useState(BRUSHES[1])
  const [tool, setTool] = useState<Tool>('pointer')
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready'>('loading')
  const [videoAspect, setVideoAspect] = useState(4 / 3)
  const [panel, setPanel] = useState<'tune' | 'gestures' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [seenLabels, setSeenLabels] = useState<string[]>([])
  const [sampleCounts, setSampleCounts] = useState<Record<string, number>>({})
  const [recording, setRecording] = useState<RecordingState | null>(null)
  const [sampleStore] = useState(() => new SampleStore())

  // The render loop runs outside React and reads current values through these refs
  const settingsRef = useRef(settings)
  const brushRef = useRef({ color, size: brush, tool })
  const painterRef = useRef<Painter | null>(null)
  const recognizerRef = useRef<GestureRecognizer | null>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const calibrationRef = useRef<Calibration | null>(null)
  const seenLabelsRef = useRef(new Set<string>())
  const pointerDrawingRef = useRef(false)

  useEffect(() => {
    settingsRef.current = settings
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    brushRef.current = { color, size: brush, tool }
  }, [color, brush, tool])

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

  const refreshCounts = useCallback(() => {
    sampleStore.counts().then(setSampleCounts, () => {})
  }, [sampleStore])

  useEffect(refreshCounts, [refreshCounts])

  // (Re)load the gesture model whenever the choice changes; the render loop picks it up from the ref
  useEffect(() => {
    let cancelled = false
    let created: GestureRecognizer | null = null
    const model = settings.gestureModel
    createRecognizer(model, settingsRef.current.minDetect).then(
      (recognizer) => {
        if (cancelled) {
          recognizer.close()
          return
        }
        created = recognizer
        recognizerRef.current = recognizer
        seenLabelsRef.current.clear()
        setSeenLabels([])
        setModelStatus('ready')
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        if (model === 'custom') {
          setNotice(`Couldn't load the custom model. ${message}`)
          setSettings((prev) => ({ ...prev, gestureModel: 'builtin' }))
        } else {
          setStatus({ kind: 'error', message: `Couldn't load hand tracking: ${message}` })
        }
      },
    )
    return () => {
      cancelled = true
      setModelStatus('loading')
      if (recognizerRef.current === created) recognizerRef.current = null
      created?.close()
    }
  }, [settings.gestureModel])

  const beginCalibration = useCallback(() => {
    setSettings((prev) => ({ ...prev, mode: 'reach' }))
    calibrationRef.current = new Calibration(performance.now())
  }, [])

  useEffect(() => {
    const workspace = workspaceRef.current!
    const paper = paperRef.current!
    const video = videoRef.current!
    const overlay = overlayRef.current!
    const preview = previewRef.current!
    const hud = hudRef.current!
    const octx = overlay.getContext('2d')!
    const pctx = preview.getContext('2d')!
    const painter = new Painter(paintRef.current!)
    painterRef.current = painter
    const tracker = new PenTracker()
    const dwell = new Dwell()
    const trigger = new GestureTrigger()
    const recorder = new Recorder(
      (sample) => sampleStore.add(sample).then(refreshCounts, () => {}),
      setRecording,
    )
    recorderRef.current = recorder

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let lastVideoTime = -1
    let lastFrameTime = 0
    let fps = 0
    let lastSeen = performance.now()
    let handPainting = false
    let prevPrint: Point[] | null = null
    let firedAt = -Infinity
    let firedLabel = ''

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
      painter.resize(paper.clientWidth, paper.clientHeight)
      sizeCanvas(preview, pctx, preview.clientWidth, preview.clientHeight)
    })
    observer.observe(paper)
    observer.observe(preview)

    const endHandStrokes = () => {
      for (const f of FINGERS) painter.end(f.name)
      handPainting = false
      prevPrint = null
    }

    const applyAction = (action: GestureAction) => {
      if (action === 'undo') painter.undo()
      else if (action === 'clear') painter.clear()
      else if (action === 'eraser') setColor(ERASER)
      else if (action === 'nextColor') {
        const i = COLORS.findIndex((c) => c.value === brushRef.current.color)
        setColor(COLORS[(i + 1) % COLORS.length].value)
      } else if (action.startsWith('tool:')) setTool(action.slice(5) as Tool)
      else if (action.startsWith('color:')) setColor(action.slice(6))
      else if (action.startsWith('brush:')) setBrush(Number(action.slice(6)))
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const recognizer = recognizerRef.current
      if (!recognizer || video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime
      const now = performance.now()
      if (lastFrameTime) fps = fps * 0.9 + (1000 / (now - lastFrameTime)) * 0.1
      lastFrameTime = now

      const result = recognizer.recognizeForVideo(video, now)
      const s = settingsRef.current
      const { color, size, tool } = brushRef.current
      const area = toRect(workspace.getBoundingClientRect())
      const paperRect = toRect(paper.getBoundingClientRect())
      const landmarks = result.landmarks[0] ?? null
      const gesture = topGesture(result.gestures[0], s)
      if (gesture && !seenLabelsRef.current.has(gesture.label)) {
        seenLabelsRef.current.add(gesture.label)
        setSeenLabels([...seenLabelsRef.current])
      }
      const gesturePen = !!gesture && s.gestureActions[gesture.label] === 'penDown'
      const view = computeView(video.videoWidth, video.videoHeight, area, s.activeArea)
      const hand = tracker.update(landmarks, now, s, tool, gesturePen, view, area)
      if (hand) lastSeen = now

      recorder.update(now, !!landmarks, video)

      // Toolbar buttons are pressed by hovering; never paint while pointing at UI
      const hit = hand ? document.elementFromPoint(hand.cursor.x, hand.cursor.y) : null
      const overUi = !!hit?.closest('[data-ui]')
      dwell.update(hit?.closest<HTMLElement>('[data-dwell]') ?? null, now)

      const calibration = calibrationRef.current
      if (calibration) {
        const res = calibration.update(hand?.palm ?? null, now)
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

      // Gesture actions: not while painting, calibrating, or recording training images
      const triggerState = trigger.update(
        gesture?.label ?? null,
        now,
        s,
        !!hand && !hand.down && !calibrationRef.current && !recorder.active,
      )
      if (triggerState?.fired) {
        applyAction(triggerState.action)
        firedAt = now
        firedLabel = describeAction(triggerState.action)
      }

      // A mouse stroke took over the painter
      if (pointerDrawingRef.current && handPainting) endHandStrokes()
      const local = (p: Point) => ({ x: p.x - paperRect.x, y: p.y - paperRect.y })
      if (hand?.down && !overUi && !calibrationRef.current && !pointerDrawingRef.current) {
        if (!handPainting) {
          painter.checkpoint()
          handPainting = true
        }
        if (hand.kind === 'palm') {
          const pts = hand.points.map(local)
          painter.stampHand(pts, prevPrint, hand.printWidth, color)
          prevPrint = pts
        } else {
          // Pointer paints with the index finger only; Fingers paints with every extended finger
          const width = size * hand.widthScale
          FINGERS.forEach((f, i) => {
            const active = hand.kind === 'pointer' ? f.name === 'index' : hand.extended[i]
            if (!active) return painter.end(f.name)
            const p = local(hand.kind === 'pointer' ? hand.cursor : hand.points[f.tip])
            if (painter.has(f.name)) painter.extend(f.name, p, width)
            else painter.begin(f.name, p, width, color)
          })
        }
      } else if (handPainting) {
        endHandStrokes()
      }

      drawOverlay(octx, {
        w: window.innerWidth,
        h: window.innerHeight,
        now,
        hand,
        area,
        paper: paperRect,
        color,
        brush: size,
        overUi,
        calibration: calibrationRef.current,
        handMissingMs: now - lastSeen,
        trigger: triggerState,
        firedAt,
        firedLabel,
      })
      drawPreview(pctx, {
        w: preview.clientWidth,
        h: preview.clientHeight,
        landmarks,
        hand,
        view,
        area,
        settings: s,
        recording: recorder.status(now),
      })
      if (s.showHud) {
        const top = result.gestures[0]?.[0]
        hud.textContent = hudText(s, hand, fps, top ? `${top.categoryName} ${top.score.toFixed(2)}` : '', overUi)
      }
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
        setVideoAspect(video.videoWidth / video.videoHeight)
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
      window.removeEventListener('resize', resizeOverlay)
      observer.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      recorder.cancel()
      recorderRef.current = null
      painterRef.current = null
    }
  }, [sampleStore, refreshCounts])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const toolIndex = Number(e.key) - 1
      if (TOOLS[toolIndex]) setTool(TOOLS[toolIndex].tool)
      else if (e.key === 'c') beginCalibration()
      else if (e.key === 's') setPanel((p) => (p === 'tune' ? null : 'tune'))
      else if (e.key === 'g') setPanel((p) => (p === 'gestures' ? null : 'gestures'))
      else if (e.key === 'z') painterRef.current?.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [beginCalibration])

  const downloadDataset = async () => {
    const blob = await sampleStore.exportZip()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gestures.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Gestures offered for action mapping
  const recordedLabels = Object.keys(sampleCounts)
  const mappingLabels =
    settings.gestureModel === 'builtin'
      ? CANNED_GESTURES
      : [
          ...new Set([
            ...recordedLabels,
            ...seenLabels,
            ...Object.keys(settings.gestureActions).filter((l) => !CANNED_GESTURES.includes(l)),
          ]),
        ]
          .filter((l) => !isNoneLabel(l))
          .sort()

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerDrawingRef.current = true
    painterRef.current?.checkpoint()
    painterRef.current?.begin('mouse', { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }, brush, color)
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerDrawingRef.current) painterRef.current?.extend('mouse', { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }, brush)
  }
  const onPointerUp = () => {
    if (!pointerDrawingRef.current) return
    pointerDrawingRef.current = false
    painterRef.current?.end('mouse')
  }

  return (
    <div className="fp-app">
      {/* Everything in the workspace is reachable by the hand cursor */}
      <main className="fp-workspace" ref={workspaceRef}>
        <nav className="fp-bar fp-colors" data-ui>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              data-dwell="700"
              aria-label={c.name}
              title={c.name}
              className={`fp-tool fp-color${color === c.value ? ' selected' : ''}`}
              style={{ '--swatch': c.value } as CSSProperties}
              onClick={() => setColor(c.value)}
            />
          ))}
          <button
            type="button"
            data-dwell="700"
            aria-label="Eraser"
            title="Eraser"
            className={`fp-tool${color === ERASER ? ' selected' : ''}`}
            onClick={() => setColor(ERASER)}
          >
            🧽
          </button>
        </nav>

        <nav className="fp-bar fp-rail" data-ui>
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              data-dwell="700"
              aria-label={t.label}
              title={t.label}
              className={`fp-tool${tool === t.tool ? ' selected' : ''}`}
              onClick={() => setTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
          <span className="fp-divider" />
          {BRUSHES.map((size) => (
            <button
              key={size}
              type="button"
              data-dwell="700"
              aria-label={`Brush size ${size}`}
              title={`Brush size ${size}`}
              className={`fp-tool fp-brush${brush === size ? ' selected' : ''}`}
              style={{ '--size': `${size}px` } as CSSProperties}
              onClick={() => setBrush(size)}
            />
          ))}
          <span className="fp-divider" />
          <button type="button" data-dwell="900" aria-label="Undo" title="Undo" className="fp-tool" onClick={() => painterRef.current?.undo()}>
            ↩️
          </button>
          <button type="button" data-dwell="1500" aria-label="Clear" title="Clear" className="fp-tool" onClick={() => painterRef.current?.clear()}>
            🗑️
          </button>
        </nav>

        <div className="fp-paper" ref={paperRef}>
          <canvas
            ref={paintRef}
            className="fp-paint"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {notice && <div className="fp-notice">{notice}</div>}
        </div>
      </main>

      <aside className="fp-sidebar" data-ui>
        <div className="fp-camera" style={{ aspectRatio: videoAspect }}>
          <video ref={videoRef} playsInline muted />
          <canvas ref={previewRef} />
          {status.kind === 'loading' && <div className="fp-camera-status">Starting camera…</div>}
          {status.kind === 'ready' && modelStatus === 'loading' && <div className="fp-camera-status">Loading hand model…</div>}
          {status.kind === 'error' && <div className="fp-camera-status fp-error">{status.message}</div>}
        </div>

        <div className="fp-actions">
          <button type="button" title="Calibrate reach (C)" onClick={beginCalibration}>🎯 Calibrate</button>
          <button
            type="button"
            title="Tune the feel (S)"
            className={panel === 'tune' ? 'active' : ''}
            onClick={() => setPanel((p) => (p === 'tune' ? null : 'tune'))}
          >
            ⚙️ Tune
          </button>
          <button
            type="button"
            title="Gesture actions and training (G)"
            className={panel === 'gestures' ? 'active' : ''}
            onClick={() => setPanel((p) => (p === 'gestures' ? null : 'gestures'))}
          >
            🤟 Gestures
          </button>
        </div>

        <pre className="fp-hud" ref={hudRef} hidden={!settings.showHud} />

        {panel === 'tune' && (
          <SettingsPanel
            settings={settings}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            onReset={() => setSettings({ ...DEFAULT_SETTINGS, gestureActions: settings.gestureActions })}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'gestures' && (
          <GesturePanel
            settings={settings}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            modelStatus={modelStatus}
            labels={mappingLabels}
            counts={sampleCounts}
            recording={recording}
            onRecord={(label) => recorderRef.current?.start(label, performance.now())}
            onCancelRecording={() => recorderRef.current?.cancel()}
            onDeleteLabel={(label) => sampleStore.deleteLabel(label).then(refreshCounts, () => {})}
            onDownload={downloadDataset}
            onClose={() => setPanel(null)}
          />
        )}
      </aside>

      <canvas ref={overlayRef} className="fp-overlay" />
    </div>
  )
}
