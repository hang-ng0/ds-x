import { useState } from 'react'
import { ACTION_OPTIONS, isNoneLabel } from './gestures'
import type { GestureAction, Settings } from './settings'
import { Section, Slider } from './SettingsPanel'

// Model Maker recommends on the order of 100+ varied images per gesture
const MIN_SAMPLES = 100

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  modelStatus: 'loading' | 'ready'
  /** Gesture labels to offer for action mapping */
  labels: string[]
  counts: Record<string, number>
  recording: RecordingState | null
  onRecord: (label: string) => void
  onCancelRecording: () => void
  onDeleteLabel: (label: string) => void
  onDownload: () => void
  onClose: () => void
}

const sanitize = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')

export default function GesturePanel(props: Props) {
  const { settings: s, onChange, counts, recording } = props
  const [label, setLabel] = useState('')
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const recorded = Object.keys(counts).sort()
  const hasNone = recorded.some(isNoneLabel)
  const setAction = (gesture: string, action: GestureAction) =>
    onChange({ gestureActions: { ...s.gestureActions, [gesture]: action } })

  return (
    <div className="fp-panel">
      <header>
        <h2>Gestures</h2>
        <button type="button" onClick={props.onClose} aria-label="Close gestures">✕</button>
      </header>

      <Section title="Model">
        <div className="fp-segmented">
          {(['builtin', 'custom'] as const).map((model) => (
            <button
              key={model}
              type="button"
              className={s.gestureModel === model ? 'active' : ''}
              onClick={() => onChange({ gestureModel: model })}
            >
              {model === 'builtin' ? 'Built-in' : 'Custom (trained)'}
            </button>
          ))}
        </div>
        <p className="fp-note">
          {props.modelStatus === 'loading' && 'Loading model… '}
          {s.gestureModel === 'custom'
            ? 'Loads public/models/custom_gesture_recognizer.task. It only knows the gestures you trained.'
            : 'Knows: Closed_Fist, Open_Palm, Pointing_Up, Thumb_Up, Thumb_Down, Victory, ILoveYou.'}
        </p>
        <Slider label="Min confidence" hint="Ignore guesses below this score" value={s.gestureMinScore} min={0.3} max={0.95} step={0.05} onChange={(gestureMinScore) => onChange({ gestureMinScore })} />
        <Slider label="Hold time (ms)" hint="How long to hold a gesture before it fires" value={s.gestureHoldMs} min={150} max={2000} step={50} onChange={(gestureHoldMs) => onChange({ gestureHoldMs })} />
      </Section>

      <Section title="Actions">
        {props.labels.length === 0 && <p className="fp-note">Show a gesture to the camera and it will appear here.</p>}
        <table className="fp-table">
          <tbody>
            {props.labels.map((gesture) => (
              <tr key={gesture}>
                <td>{gesture}</td>
                <td>
                  <select
                    value={s.gestureActions[gesture] ?? 'none'}
                    onChange={(e) => setAction(gesture, e.target.value as GestureAction)}
                  >
                    {ACTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.values(s.gestureActions).includes('penDown') && s.mode !== 'gesture' && (
          <p className="fp-note">
            "Pen down" gestures only work when Tune → Pen down by is set to Gesture.{' '}
            <button type="button" className="fp-link" onClick={() => onChange({ mode: 'gesture' })}>Switch now</button>
          </p>
        )}
      </Section>

      <Section title="Record training images">
        <p className="fp-note">
          Type a gesture name, press Record, and hold the gesture for 5 seconds after the countdown. Move it around: both
          hands, near and far, different angles. You also need a <b>none</b> class of ordinary hand poses that aren't any
          gesture.
        </p>
        <form
          className="fp-record"
          onSubmit={(e) => {
            e.preventDefault()
            if (sanitize(label)) props.onRecord(sanitize(label))
          }}
        >
          <input
            value={label}
            placeholder="gesture name, e.g. rock"
            disabled={!!recording}
            onChange={(e) => setLabel(e.target.value)}
          />
          {recording ? (
            <button type="button" onClick={props.onCancelRecording}>Stop</button>
          ) : (
            <button type="submit" className="fp-rec" disabled={!sanitize(label) || props.modelStatus !== 'ready'}>● Record</button>
          )}
        </form>
        {recording && (
          <p className="fp-note">
            {recording.phase === 'countdown' ? 'Get ready…' : `Recording "${recording.label}"…`}
          </p>
        )}

        {recorded.length > 0 && (
          <table className="fp-table">
            <tbody>
              {recorded.map((l) => (
                <tr key={l}>
                  <td>
                    <button type="button" className="fp-link" disabled={!!recording} onClick={() => setLabel(l)}>{l}</button>
                  </td>
                  <td className={counts[l] < MIN_SAMPLES ? 'fp-low' : ''}>{counts[l]}</td>
                  <td>
                    <button
                      type="button"
                      className="fp-link"
                      aria-label={`Delete ${l}`}
                      disabled={!!recording}
                      onClick={() => {
                        if (window.confirm(`Delete all ${counts[l]} "${l}" images?`)) props.onDeleteLabel(l)
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {recorded.length > 0 && !hasNone && <p className="fp-warn">Add a "none" class: Model Maker requires it.</p>}
        {recorded.some((l) => counts[l] < MIN_SAMPLES) && (
          <p className="fp-note">Aim for {MIN_SAMPLES}+ images per gesture (record a few takes).</p>
        )}
        <button type="button" className="fp-reset" disabled={total === 0 || !!recording} onClick={props.onDownload}>
          ⬇ Download dataset ({total} images)
        </button>
        <p className="fp-note">
          Then train it with <code>training/train_gestures.ipynb</code> in Google Colab, put the resulting{' '}
          <code>custom_gesture_recognizer.task</code> in <code>public/models/</code>, and choose Custom above.
        </p>
      </Section>
    </div>
  )
}
