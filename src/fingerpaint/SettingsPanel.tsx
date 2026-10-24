import type { ReactNode } from 'react'
import type { Settings } from './settings'

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

export default function SettingsPanel({ settings: s, onChange, onReset, onClose }: Props) {
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
              {{ reach: 'Reach', pinch: 'Pinch', gesture: 'Gesture' }[mode]}
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
        <Slider label="Far palm size" hint="Relaxed hand. Set by calibration." value={s.far} min={0.03} max={0.5} step={0.005} onChange={(far) => onChange({ far })} />
        <Slider label="Near palm size" hint="Reaching hand. Set by calibration." value={s.near} min={0.03} max={0.6} step={0.005} onChange={(near) => onChange({ near })} />
        <Slider label="Press point" hint="How far from far→near before paint starts" value={s.pressAt} min={0.2} max={1.2} step={0.01} onChange={(pressAt) => onChange({ pressAt })} />
        <Slider label="Release gap" hint="How far back to pull before the pen lifts" value={s.gap} min={0} max={0.5} step={0.01} onChange={(gap) => onChange({ gap })} />
        <Toggle label="Reach harder = thicker line" checked={s.pressure} onChange={(pressure) => onChange({ pressure })} />
      </Section>

      {s.mode === 'pinch' && (
        <Section title="Pinch">
          <Slider label="Pinch closed at" hint="Thumb–index gap ÷ palm size" value={s.pinchPress} min={0.1} max={0.8} step={0.01} onChange={(pinchPress) => onChange({ pinchPress })} />
          <Slider label="Release gap" value={s.pinchGap} min={0} max={0.5} step={0.01} onChange={(pinchGap) => onChange({ pinchGap })} />
        </Section>
      )}

      <Section title="Brushes">
        <Slider label="Handprint thickness" hint="Finger width in the handprint brush" value={s.handprint} min={0.4} max={2} step={0.05} onChange={(handprint) => onChange({ handprint })} />
      </Section>

      <Section title="Timing">
        <Slider label="Frames to press" hint="Higher = fewer accidental dots" value={s.pressFrames} min={1} max={8} step={1} onChange={(pressFrames) => onChange({ pressFrames })} />
        <Slider label="Frames to lift" hint="Higher = fewer broken lines" value={s.liftFrames} min={1} max={10} step={1} onChange={(liftFrames) => onChange({ liftFrames })} />
      </Section>

      <Section title="Smoothing">
        <Slider label="Steadiness (min cutoff)" hint="Lower = steadier but laggier" value={s.minCutoff} min={0.1} max={5} step={0.05} onChange={(minCutoff) => onChange({ minCutoff })} />
        <Slider label="Speed response (beta)" hint="Higher = less lag on fast strokes" value={s.beta} min={0} max={0.08} step={0.001} onChange={(beta) => onChange({ beta })} />
        <Slider label="Depth smoothing" hint="Higher = calmer depth, slower to react" value={s.depthSmoothing} min={0} max={0.95} step={0.05} onChange={(depthSmoothing) => onChange({ depthSmoothing })} />
      </Section>

      <Section title="Camera">
        <Slider label="Active area" hint="Dashed box in the preview. Smaller = less arm movement." value={s.activeArea} min={0.4} max={1} step={0.05} onChange={(activeArea) => onChange({ activeArea })} />
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
