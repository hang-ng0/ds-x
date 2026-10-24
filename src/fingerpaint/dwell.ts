/**
 * Hover-to-press for toolbar buttons. Any element with `data-dwell="<ms>"` gets clicked after the
 * cursor rests on it that long. Progress is exposed as the `--dwell` CSS variable (0–1).
 */
export class Dwell {
  private el: HTMLElement | null = null
  private start = 0
  private fired = false

  update(el: HTMLElement | null, now: number) {
    if (el !== this.el) {
      this.clear()
      this.el = el
      this.start = now
      this.fired = false
      el?.setAttribute('data-hover', '')
    }
    if (!el || this.fired) return
    const ms = Number(el.dataset.dwell) || 800
    const p = Math.min((now - this.start) / ms, 1)
    el.style.setProperty('--dwell', String(p))
    if (p >= 1) {
      // Require leaving the button before it can fire again
      this.fired = true
      el.style.removeProperty('--dwell')
      el.click()
    }
  }

  private clear() {
    this.el?.style.removeProperty('--dwell')
    this.el?.removeAttribute('data-hover')
  }
}
