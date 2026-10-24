import type { Category } from '@mediapipe/tasks-vision'
import { BRUSHES, COLORS, TOOLS } from './palette'
import type { GestureAction, Settings } from './settings'

/** Labels the built-in model can output (besides "None") */
export const CANNED_GESTURES = ['Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou']

/** The built-in model says "None", Model Maker requires a "none" class */
export const isNoneLabel = (label: string) => label.toLowerCase() === 'none'

export const ACTION_OPTIONS: { value: GestureAction; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'penDown', label: 'Pen down (while held)' },
  { value: 'undo', label: 'Undo' },
  { value: 'clear', label: 'Clear' },
  { value: 'nextColor', label: 'Next color' },
  { value: 'eraser', label: 'Eraser' },
  ...TOOLS.map((t) => ({ value: `tool:${t.tool}` as const, label: `Brush: ${t.name}` })),
  ...BRUSHES.map((b) => ({ value: `brush:${b}` as const, label: `Size: ${b}` })),
  ...COLORS.map((c) => ({ value: `color:${c.value}` as const, label: `Color: ${c.name}` })),
]

export function describeAction(action: GestureAction) {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action
}

/** The model's top gesture, if it's confident enough and not "none". */
export function topGesture(categories: Category[] | undefined, s: Settings) {
  const top = categories?.[0]
  if (!top || isNoneLabel(top.categoryName) || top.score < s.gestureMinScore) return null
  return { label: top.categoryName, score: top.score }
}

export type TriggerState = { label: string; action: GestureAction; progress: number; fired: boolean }

/**
 * Fires a gesture's action once it has been held for `gestureHoldMs`. It won't fire again until
 * the gesture changes or the hand goes away, so holding a thumbs-up doesn't undo ten times.
 */
export class GestureTrigger {
  private label: string | null = null
  private since = 0
  private fired = false

  update(label: string | null, now: number, s: Settings, enabled: boolean): TriggerState | null {
    const action = label ? (s.gestureActions[label] ?? 'none') : 'none'
    const actionable = label !== null && action !== 'none' && action !== 'penDown'
    if (!actionable || label !== this.label || !enabled) {
      this.label = actionable ? label : null
      this.since = now
      this.fired = false
      return actionable ? { label, action, progress: 0, fired: false } : null
    }
    const progress = Math.min((now - this.since) / s.gestureHoldMs, 1)
    if (progress >= 1 && !this.fired) {
      this.fired = true
      return { label, action, progress, fired: true }
    }
    return { label, action, progress, fired: false }
  }
}
