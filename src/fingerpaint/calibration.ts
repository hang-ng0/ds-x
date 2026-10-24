const PHASES = [
  { prompt: 'Hold your hand up and relax 👋' },
  { prompt: 'Now reach out and touch the screen! 👉' },
]
const PHASE_MS = 3000
// Ignore the first half of each phase while the child moves into position
const SAMPLE_FROM_MS = 1500
const MIN_SAMPLES = 5

export type CalibrationResult = { far: number; near: number; ok: boolean }

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Two-step "relaxed, then reaching" capture of palm size, driven from the render loop. */
export class Calibration {
  private phase = 0
  private phaseStart: number
  private samples: number[] = []
  private results: number[] = []

  constructor(now: number) {
    this.phaseStart = now
  }

  get prompt() {
    return PHASES[this.phase].prompt
  }

  progress(now: number) {
    return Math.min((now - this.phaseStart) / PHASE_MS, 1)
  }

  secondsLeft(now: number) {
    return Math.max(Math.ceil((PHASE_MS - (now - this.phaseStart)) / 1000), 1)
  }

  update(palm: number | null, now: number): CalibrationResult | null {
    const t = now - this.phaseStart
    if (palm !== null && t >= SAMPLE_FROM_MS) this.samples.push(palm)
    if (t < PHASE_MS) return null

    if (this.samples.length < MIN_SAMPLES) {
      // Didn't see the hand long enough: repeat this step
      this.phaseStart = now
      this.samples = []
      return null
    }
    this.results.push(median(this.samples))
    this.samples = []
    this.phase++
    this.phaseStart = now
    if (this.phase < PHASES.length) return null

    const [far, near] = this.results
    return { far, near, ok: near > far * 1.1 }
  }
}
