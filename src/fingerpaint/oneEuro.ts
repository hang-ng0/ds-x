// One-Euro filter (Casiez et al. 2012): heavy smoothing when the hand is still,
// light smoothing when it moves fast, so strokes are steady without feeling laggy.

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuroFilter {
  minCutoff: number
  beta: number
  dCutoff = 1
  private value: number | null = null
  private deriv = 0
  private lastTime = 0

  constructor(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff
    this.beta = beta
  }

  filter(x: number, timeMs: number) {
    if (this.value === null) {
      this.value = x
      this.lastTime = timeMs
      return x
    }
    const dt = Math.max((timeMs - this.lastTime) / 1000, 1e-3)
    this.lastTime = timeMs
    const rawDeriv = (x - this.value) / dt
    this.deriv += alpha(this.dCutoff, dt) * (rawDeriv - this.deriv)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.deriv)
    this.value += alpha(cutoff, dt) * (x - this.value)
    return this.value
  }

  reset() {
    this.value = null
    this.deriv = 0
  }
}
