import { Section, Slider, Toggle } from '../fingerpaint/SettingsPanel'
import type { MoveKind } from './moves'
import type { InkSettings } from './settings'

type Props = {
  settings: InkSettings
  onChange: (patch: Partial<InkSettings>) => void
  onDemo: (kind: MoveKind) => void
  onReset: () => void
  onClose: () => void
}

const DEMOS: { kind: MoveKind; label: string }[] = [
  { kind: 'punch', label: '👊 Punch' },
  { kind: 'slash', label: '👋 Swoosh' },
  { kind: 'kick', label: '🦵 Kick' },
  { kind: 'jump', label: '🦘 Jump' },
]

export default function InkPanel({ settings: s, onChange, onDemo, onReset, onClose }: Props) {
  return (
    <div className="fp-panel">
      <header>
        <h2>Ink Dojo tuning</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">✕</button>
      </header>

      <Section title="Try the effects">
        <div className="ink-demos">
          {DEMOS.map((d) => (
            <button key={d.kind} type="button" onClick={() => onDemo(d.kind)}>
              {d.label}
            </button>
          ))}
        </div>
        <p className="fp-note">Keys 1–4 do the same. With the mouse: click the paper to punch, drag to swoosh.</p>
      </Section>

      <Section title="Moves">
        <Slider label="Move size" hint="Scales every threshold below. Higher = only big, fast moves count" value={s.moveSize} min={0.5} max={2} step={0.05} onChange={(moveSize) => onChange({ moveSize })} />
        <p className="fp-note">Distances are in torso lengths, speeds in torso lengths per second, so they work at any distance.</p>
        <Slider label="Swoosh speed" hint="How fast a hand must sweep to paint a slash" value={s.slashSpeed} min={1} max={10} step={0.1} onChange={(slashSpeed) => onChange({ slashSpeed })} />
        <Slider label="Swoosh length" hint="How far the hand must sweep" value={s.slashLength} min={0.3} max={2.5} step={0.05} onChange={(slashLength) => onChange({ slashLength })} />
        <Slider label="Punch speed" hint="How fast the arm must straighten" value={s.punchSpeed} min={1} max={10} step={0.1} onChange={(punchSpeed) => onChange({ punchSpeed })} />
        <Slider label="Punch reach" hint="How much the arm must extend" value={s.punchExtend} min={0.05} max={1.2} step={0.01} onChange={(punchExtend) => onChange({ punchExtend })} />
        <Slider label="Kick speed" value={s.kickSpeed} min={1} max={10} step={0.1} onChange={(kickSpeed) => onChange({ kickSpeed })} />
        <Slider label="Kick height" hint="How high the foot must rise" value={s.kickLift} min={0.1} max={1.5} step={0.01} onChange={(kickLift) => onChange({ kickLift })} />
        <Slider label="Jump height" hint="How far the hips must rise" value={s.jumpHeight} min={0.05} max={0.5} step={0.01} onChange={(jumpHeight) => onChange({ jumpHeight })} />
        <Slider label="Cooldown (ms)" hint="Pause per arm/leg so one move doesn't fire twice" value={s.cooldownMs} min={0} max={800} step={10} onChange={(cooldownMs) => onChange({ cooldownMs })} />
      </Section>

      <Section title="Ink">
        <div className="fp-segmented">
          {(['dark', 'light'] as const).map((paper) => (
            <button key={paper} type="button" className={s.paper === paper ? 'active' : ''} onClick={() => onChange({ paper })}>
              {paper === 'dark' ? 'Neon (dark)' : 'Rice paper'}
            </button>
          ))}
        </div>
        <Slider label="Ink size" value={s.inkScale} min={0.4} max={2.5} step={0.05} onChange={(inkScale) => onChange({ inkScale })} />
        <Slider label="Splatter" hint="How many droplets fly" value={s.splatter} min={0} max={3} step={0.1} onChange={(splatter) => onChange({ splatter })} />
        <Slider label="Ink opacity" hint="Lower = hits layer and darken more" value={s.inkOpacity} min={0.2} max={1} step={0.05} onChange={(inkOpacity) => onChange({ inkOpacity })} />
        <Toggle label="Drips" checked={s.drips} onChange={(drips) => onChange({ drips })} />
      </Section>

      <Section title="Camera">
        <div className="fp-segmented">
          {(['lite', 'full'] as const).map((model) => (
            <button key={model} type="button" className={s.model === model ? 'active' : ''} onClick={() => onChange({ model })}>
              {model === 'lite' ? 'Fast model' : 'Accurate model'}
            </button>
          ))}
        </div>
        <Slider label="Active area" hint="Smaller = moves close to the body still reach the paper edges" value={s.activeArea} min={0.4} max={1} step={0.05} onChange={(activeArea) => onChange({ activeArea })} />
        <Slider label="Min visibility" hint="Ignore hands/feet the camera can barely see" value={s.minVisibility} min={0.1} max={0.9} step={0.05} onChange={(minVisibility) => onChange({ minVisibility })} />
      </Section>

      <Section title="Debug">
        <Toggle label="Show HUD and jump meter" checked={s.showHud} onChange={(showHud) => onChange({ showHud })} />
        <Toggle label="Show skeleton" checked={s.showSkeleton} onChange={(showSkeleton) => onChange({ showSkeleton })} />
      </Section>

      <button type="button" className="fp-reset" onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  )
}
