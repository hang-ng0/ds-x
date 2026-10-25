import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { GestureRecognizer } from '@mediapipe/tasks-vision'
import { Calibration } from './calibration'
import GesturePanel from './GesturePanel'
import { CANNED_GESTURES, describeAction, isNoneLabel, topGesture } from './gestures'
import { computeView, createRecognizer, FINGERS, type HandState, type Point, type Rect } from './hand'
import { assignHands, HandSlot, MAX_HANDS } from './hands'
import { drawOverlay, drawPreview, hudText, type HandView, type HudHand, type PreviewHand } from './overlay'
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

/** Little "1" / "2" tags on a toolbar button showing which hands have it selected */
function HandBadges({ hands, show }: { hands: number[]; show: boolean }) {
  if (!show || hands.length === 0) return null
  return (
    <span className="fp-badges" aria-hidden>
      {hands.map((i) => (
        <span key={i}>{i + 1}</span>
      ))}
    </span>
  )
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })

export default function FingerPaint() {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const paintRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLPreElement>(null)

  const [settings, setSettings] = useState<Settings>(loadSettings)
  // One color per hand slot (blue and red, so two kids can tell their paint apart). The mouse uses hand 1's.
  const [colors, setColors] = useState<string[]>([COLORS[4].value, COLORS[0].value])
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
  const brushRef = useRef({ colors, size: brush, tool })
  // Set while a hand's hover "clicks" a toolbar button, so the click knows which hand it was for
  const clickingHandRef = useRef<number | null>(null)
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
    brushRef.current = { colors, size: brush, tool }
  }, [colors, brush, tool])

  /** `hand` null (a mouse click) sets every hand's color. */
  const setHandColor = useCallback((hand: number | null, value: string) => {
    setColors((prev) => prev.map((c, i) => (hand === null || i === hand ? value : c)))
  }, [])

  useEffect(() => {
    if (painterRef.current) painterRef.current.opacity = settings.paintOpacity
  }, [settings.paintOpacity])

  useEffect(() => {
    const c = settings.minDetect
    recognizerRef.current?.setOptions({
      minHandDetectionConfidence: c,
      minHandPresenceConfidence: c,
      minTrackingConfidence: c,
    })
  }, [settings.minDetect])

  useEffect(() => {
    recognizerRef.current?.setOptions({ numHands: settings.twoHands ? MAX_HANDS : 1 })
  }, [settings.twoHands])

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
    createRecognizer(model, settingsRef.current.minDetect, settingsRef.current.twoHands ? MAX_HANDS : 1).then(
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

  // Calibration also sets the relative push amount: a bit under half of a full reach
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
    const painter = new Painter(paintRef.current!, layerRef.current!)
    painter.opacity = settingsRef.current.paintOpacity
    painterRef.current = painter
    const slots = Array.from({ length: MAX_HANDS }, (_, i) => new HandSlot(i))
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
    // One undo step covers everything from the first hand touching down until the last one lifts
    let session = false

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

    const stopHand = (slot: HandSlot) => {
      for (const f of FINGERS) painter.end(slot.strokeId(f.name))
      slot.painting = false
      slot.prevPrint = null
    }

    const paintHand = (slot: HandSlot, hand: HandState, local: (p: Point) => Point, color: string, size: number) => {
      if (!session) {
        painter.checkpoint()
        session = true
      }
      slot.painting = true
      if (hand.kind === 'palm') {
        const pts = hand.points.map(local)
        painter.stampHand(pts, slot.prevPrint, hand.printWidth, color)
        slot.prevPrint = pts
        return
      }
      // Pointer paints with the index finger only; Fingers paints with every extended finger
      const width = size * hand.widthScale
      FINGERS.forEach((f, i) => {
        const id = slot.strokeId(f.name)
        const active = hand.kind === 'pointer' ? f.name === 'index' : hand.extended[i]
        if (!active) return painter.end(id)
        const p = local(hand.kind === 'pointer' ? hand.cursor : hand.points[f.tip])
        if (painter.has(id)) painter.extend(id, p, width)
        else painter.begin(id, p, width, color)
      })
    }

    // Color actions apply to the hand that made the gesture
    const applyAction = (action: GestureAction, hand: number) => {
      if (action === 'undo') painter.undo()
      else if (action === 'clear') painter.clear()
      else if (action === 'eraser') setHandColor(hand, ERASER)
      else if (action === 'nextColor') {
        const i = COLORS.findIndex((c) => c.value === brushRef.current.colors[hand])
        setHandColor(hand, COLORS[(i + 1) % COLORS.length].value)
      } else if (action.startsWith('tool:')) setTool(action.slice(5) as Tool)
      else if (action.startsWith('color:')) setHandColor(hand, action.slice(6))
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
      const { colors, size, tool } = brushRef.current
      const area = toRect(workspace.getBoundingClientRect())
      const paperRect = toRect(paper.getBoundingClientRect())
      const local = (p: Point) => ({ x: p.x - paperRect.x, y: p.y - paperRect.y })
      const view = computeView(video.videoWidth, video.videoHeight, area, s.activeArea, s.areaShiftUp)
      const calibrating = !!calibrationRef.current
      recorder.update(now, result.landmarks.length > 0, video)

      const views: HandView[] = []
      const previewHands: PreviewHand[] = []
      const hudHands: HudHand[] = []
      const assignment = assignHands(slots, result.landmarks)
      slots.forEach((slot, i) => {
        const d = assignment[i]
        const landmarks = d === null ? null : result.landmarks[d]
        const gesture = d === null ? null : topGesture(result.gestures[d], s)
        if (gesture && !seenLabelsRef.current.has(gesture.label)) {
          seenLabelsRef.current.add(gesture.label)
          setSeenLabels([...seenLabelsRef.current])
        }
        const gesturePen = !!gesture && s.gestureActions[gesture.label] === 'penDown'
        const hand = slot.tracker.update(landmarks, now, s, tool, gesturePen, view, area)

        // Toolbar buttons are pressed by hovering; never paint while pointing at UI
        const hit = hand ? document.elementFromPoint(hand.cursor.x, hand.cursor.y) : null
        const overUi = !!hit?.closest('[data-ui]')
        clickingHandRef.current = slot.id
        slot.dwell.update(hit?.closest<HTMLElement>('[data-dwell]') ?? null, now)
        clickingHandRef.current = null

        // Gesture actions: not while painting, calibrating, or recording training images
        const trigger = slot.trigger.update(gesture?.label ?? null, now, s, !!hand && !hand.down && !calibrating && !recorder.active)
        if (trigger?.fired) {
          applyAction(trigger.action, slot.id)
          slot.firedAt = now
          slot.firedLabel = describeAction(trigger.action)
        }

        const color = colors[slot.id]
        if (hand?.down && !overUi && !calibrating && !pointerDrawingRef.current) paintHand(slot, hand, local, color, size)
        else if (slot.painting) stopHand(slot)

        if (landmarks) previewHands.push({ landmarks, hand })
        if (hand) {
          views.push({ id: slot.id, hand, color, overUi, trigger, firedAt: slot.firedAt, firedLabel: slot.firedLabel })
          const top = result.gestures[d!]?.[0]
          hudHands.push({ hand, overUi, gesture: top ? `${top.categoryName} ${top.score.toFixed(2)}` : '' })
        }
      })
      if (views.length) lastSeen = now

      // Blend the painting in once every hand has lifted
      if (session && !slots.some((slot) => slot.painting) && !pointerDrawingRef.current) {
        painter.commit()
        session = false
      }

      const calibration = calibrationRef.current
      if (calibration) {
        const res = calibration.update(views[0]?.hand.palm ?? null, now)
        if (res) {
          calibrationRef.current = null
          if (res.ok) {
            setSettings((prev) => ({
              ...prev,
              far: round3(res.far),
              near: round3(res.near),
              pushAmount: round3(Math.min(Math.max(0.45 * (res.near / res.far - 1), 0.05), 0.5)),
            }))
            setNotice('Calibrated! Reach out to paint.')
          } else {
            setNotice("Couldn't see much difference. Try again and reach closer to the screen.")
          }
        }
      }

      drawOverlay(octx, {
        w: window.innerWidth,
        h: window.innerHeight,
        now,
        hands: views,
        area,
        paper: paperRect,
        brush: size,
        calibration: calibrationRef.current,
        handMissingMs: now - lastSeen,
      })
      drawPreview(pctx, {
        w: preview.clientWidth,
        h: preview.clientHeight,
        hands: previewHands,
        view,
        area,
        settings: s,
        recording: recorder.status(now),
      })
      if (s.showHud) hud.textContent = hudText(s, hudHands, fps)
    }

    const start = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          // 30 fps where the camera allows it: many webcams default lower in dim light, which makes tracking choppy
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
  }, [sampleStore, refreshCounts, setHandColor])

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

  // Which hands (by slot) currently have this color; with one-hand tracking only hand 1 counts
  const handsWith = (value: string) =>
    colors.flatMap((c, i) => (c === value && (settings.twoHands || i === 0) ? [i] : []))

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerDrawingRef.current = true
    // Finish any hand strokes first so the mouse stroke gets its own undo step
    painterRef.current?.commit()
    painterRef.current?.checkpoint()
    painterRef.current?.begin('mouse', { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }, brush, colors[0])
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerDrawingRef.current) painterRef.current?.extend('mouse', { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }, brush)
  }
  const onPointerUp = () => {
    if (!pointerDrawingRef.current) return
    pointerDrawingRef.current = false
    painterRef.current?.commit()
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
              className={`fp-tool fp-color${handsWith(c.value).length ? ' selected' : ''}`}
              style={{ '--swatch': c.value } as CSSProperties}
              onClick={() => setHandColor(clickingHandRef.current, c.value)}
            >
              <HandBadges hands={handsWith(c.value)} show={settings.twoHands} />
            </button>
          ))}
          <button
            type="button"
            data-dwell="700"
            aria-label="Eraser"
            title="Eraser"
            className={`fp-tool${handsWith(ERASER).length ? ' selected' : ''}`}
            onClick={() => setHandColor(clickingHandRef.current, ERASER)}
          >
            🧽
            <HandBadges hands={handsWith(ERASER)} show={settings.twoHands} />
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
          {/* The stroke in progress, shown at the opacity it will be blended in with */}
          <canvas ref={layerRef} className="fp-paint fp-layer" style={{ opacity: settings.paintOpacity }} />
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
          <button type="button" title="Calibrate reach (C)" onClick={beginCalibration}><span>🎯</span>Calibrate</button>
          <button
            type="button"
            title="Tune the feel (S)"
            className={panel === 'tune' ? 'active' : ''}
            onClick={() => setPanel((p) => (p === 'tune' ? null : 'tune'))}
          >
            <span>⚙️</span>Tune
          </button>
          <button
            type="button"
            title="Gesture actions and training (G)"
            className={panel === 'gestures' ? 'active' : ''}
            onClick={() => setPanel((p) => (p === 'gestures' ? null : 'gestures'))}
          >
            <span>🤟</span>Gestures
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
