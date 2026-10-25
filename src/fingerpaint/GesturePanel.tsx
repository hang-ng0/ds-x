import { ACTION_OPTIONS } from './gestures'
import type { GestureAction, Settings } from './settings'
import { Section, Slider } from './SettingsPanel'

type Props = {
    settings: Settings
    onChange: (patch: Partial<Settings>) => void
    modelStatus: 'loading' | 'ready'
    /** Gesture labels to offer for action mapping */
    labels: string[]
    onClose: () => void
}

export default function GesturePanel(props: Props) {
    const { settings: s, onChange } = props
    const setAction = (gesture: string, action: GestureAction) =>
        onChange({ gestureActions: { ...s.gestureActions, [gesture]: action } })

    return (
        <div className="fp-panel">
            <header>
                <h2>Gestures</h2>
                <button type="button" onClick={props.onClose} aria-label="Close gestures">✕</button>
            </header>

            <Section title="Recognition">
                <p className="fp-note">
                    {props.modelStatus === 'loading' && 'Loading model… '}
                    Knows: Closed_Fist, Open_Palm, Pointing_Up, Thumb_Up, Thumb_Down, Victory, ILoveYou.
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
        </div>
    )
}