import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS, type ModeTuning, type PenMode, type Settings } from './settings'

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
}

type SliderProps = {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}

export function Slider({ label, hint, value, min, max, step, onChange }: SliderProps) {
  const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)))
  return (
    <label className="fp-row">
      <span className="fp-row-label">
        {label} <output>{value.toFixed(digits)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="fp-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

const MODE_NAMES: Record<PenMode, string> = { reach: 'Reach', pinch: 'Pinch', gesture: 'Gesture' }

export default function SettingsPanel({ settings: s, onChange, onReset, onClose }: Props) {
  const modeName = MODE_NAMES[s.mode]
  const tuning = s.modeTuning[s.mode]
  const setTuning = (patch: Partial<ModeTuning>) =>
    onChange({ modeTuning: { ...s.modeTuning, [s.mode]: { ...tuning, ...patch } } })

  return (
    <div className="fp-panel">
      <header>
        <h2>Feel tuning</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">✕</button>
      </header>

      <Section title="Pen down by">
        <div className="fp-segmented">
          {(['reach', 'pinch', 'gesture'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={s.mode === mode ? 'active' : ''}
              onClick={() => onChange({ mode })}
            >
              {MODE_NAMES[mode]}
            </button>
          ))}
        </div>
        <p className="fp-note">
          {s.mode === 'pinch' && 'Pinch only applies to the pointer brush. Fingers and handprint use reach.'}
          {s.mode === 'gesture' && 'Paints while you show a gesture mapped to "Pen down" in the Gestures panel.'}
          {s.mode === 'reach' && 'Reach toward the screen to paint.'}
        </p>
      </Section>

      <Section title="Reach">
        <div className="fp-segmented">
          {(['relative', 'fixed'] as const).map((reachStyle) => (
            <button
              key={reachStyle}
              type="button"
              className={s.reachStyle === reachStyle ? 'active' : ''}
              onClick={() => onChange({ reachStyle })}
            >
              {reachStyle === 'relative' ? 'From resting hand' : 'Fixed (calibrated)'}
            </button>
          ))}
        </div>
        <p className="fp-note">
          {s.reachStyle === 'relative'
            ? 'Paints when your hand looks bigger than it did at rest. Adapts as you lean in or sit back.'
            : 'Paints at a fixed distance between your calibrated relaxed and reaching hand.'}
        </p>
        {s.reachStyle === 'relative' ? (
          <>
            <Slider label="Push amount" hint="How much bigger than at rest the hand must look (0.15 = 15%)" value={s.pushAmount} min={0.03} max={0.5} step={0.01} onChange={(pushAmount) => onChange({ pushAmount })} />
            <Slider label="Release gap" hint="How far back to pull before the pen lifts" value={s.pushGap} min={0} max={0.2} step={0.01} onChange={(pushGap) => onChange({ pushGap })} />
            <Slider label="Adapt time (s)" hint="How quickly a new resting position is learned" value={s.adaptSeconds} min={0.5} max={10} step={0.5} onChange={(adaptSeconds) => onChange({ adaptSeconds })} />
          </>
        ) : (
          <>
            <Slider label="Far palm size" hint="Relaxed hand. Set by calibration." value={s.far} min={0.03} max={0.5} step={0.005} onChange={(far) => onChange({ far })} />
            <Slider label="Near palm size" hint="Reaching hand. Set by calibration." value={s.near} min={0.03} max={0.6} step={0.005} onChange={(near) => onChange({ near })} />
            <Slider label="Press point" hint="How far from far→near before paint starts" value={s.pressAt} min={0.2} max={1.2} step={0.01} onChange={(pressAt) => onChange({ pressAt })} />
            <Slider label="Release gap" hint="How far back to pull before the pen lifts" value={s.gap} min={0} max={0.5} step={0.01} onChange={(gap) => onChange({ gap })} />
          </>
        )}
        <Slider label="Depth smoothing" hint="Higher = calmer depth, slower to react" value={s.depthSmoothing} min={0} max={0.95} step={0.05} onChange={(depthSmoothing) => onChange({ depthSmoothing })} />
        <Toggle label="Reach harder = thicker line" checked={s.pressure} onChange={(pressure) => onChange({ pressure })} />
      </Section>

      {s.mode === 'pinch' && (
        <Section title="Pinch">
          <Slider label="Pinch closed at" hint="Thumb–index gap ÷ palm size" value={s.pinchPress} min={0.1} max={0.8} step={0.01} onChange={(pinchPress) => onChange({ pinchPress })} />
          <Slider label="Release gap" hint="Lifts as soon as the gap passes this, with no frame delay" value={s.pinchGap} min={0} max={0.5} step={0.01} onChange={(pinchGap) => onChange({ pinchGap })} />
          <Slider label="Lift when opening faster than" hint="Ends the stroke as the fingers start spreading. Lower = earlier lift, 0 = off" value={s.pinchOpenSpeed} min={0} max={5} step={0.1} onChange={(pinchOpenSpeed) => onChange({ pinchOpenSpeed })} />
        </Section>
      )}

      <Section title="Brushes">
        <Slider label="Paint opacity" hint="Lower = see-through strokes that darken where they overlap" value={s.paintOpacity} min={0.1} max={1} step={0.05} onChange={(paintOpacity) => onChange({ paintOpacity })} />
        <Slider label="Handprint thickness" hint="Finger width in the handprint brush" value={s.handprint} min={0.4} max={2} step={0.05} onChange={(handprint) => onChange({ handprint })} />
      </Section>

      <Section title={`Timing & smoothing: ${modeName}`}>
        <p className="fp-note">
          Each pen-down mode keeps its own values{s.mode === 'pinch' && ' (Fingers and Handprint use Reach’s, since they paint by reaching)'}.
        </p>
        {s.mode === 'pinch' && s.modeTuning.pinch.liftFrames > 1 && (
          <p className="fp-note">Pinch lifts immediately when the fingers open, so Frames to lift rarely matters here.</p>
        )}
        <Slider label="Frames to press" hint="Higher = fewer accidental dots" value={tuning.pressFrames} min={1} max={8} step={1} onChange={(pressFrames) => setTuning({ pressFrames })} />
        <Slider label="Frames to lift" hint="Higher = fewer broken lines" value={tuning.liftFrames} min={1} max={10} step={1} onChange={(liftFrames) => setTuning({ liftFrames })} />
        <Slider label="Steadiness (min cutoff)" hint="Lower = steadier but laggier" value={tuning.minCutoff} min={0.1} max={5} step={0.05} onChange={(minCutoff) => setTuning({ minCutoff })} />
        <Slider label="Speed response (beta)" hint="Higher = less lag on fast strokes" value={tuning.beta} min={0} max={0.08} step={0.001} onChange={(beta) => setTuning({ beta })} />
        <button type="button" className="fp-link" onClick={() => setTuning(DEFAULT_SETTINGS.modeTuning[s.mode])}>
          Restore {modeName} preset
        </button>
      </Section>

      <Section title="Camera">
        <Toggle label="Track two hands" checked={s.twoHands} onChange={(twoHands) => onChange({ twoHands })} />
        <Slider label="Active area" hint="Dashed box in the preview. Smaller = less arm movement." value={s.activeArea} min={0.4} max={1} step={0.05} onChange={(activeArea) => onChange({ activeArea })} />
        <Slider label="Shift area up" hint="Keeps the palm in view at the bottom of the paper. 0 = centered, 1 = top of camera." value={s.areaShiftUp} min={0} max={1} step={0.05} onChange={(areaShiftUp) => onChange({ areaShiftUp })} />
        <Slider label="Detection confidence" hint="Lower helps small hands; too low = ghost hands" value={s.minDetect} min={0.1} max={0.9} step={0.05} onChange={(minDetect) => onChange({ minDetect })} />
      </Section>

      <Section title="Debug">
        <Toggle label="Show HUD and meter" checked={s.showHud} onChange={(showHud) => onChange({ showHud })} />
        <Toggle label="Show hand skeleton" checked={s.showSkeleton} onChange={(showSkeleton) => onChange({ showSkeleton })} />
      </Section>

      <button type="button" className="fp-reset" onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  )
}
