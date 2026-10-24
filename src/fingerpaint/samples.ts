import { createZip } from './zip'

// Training images for MediaPipe Model Maker: one folder per gesture label, plus a required "none" folder
const DB_NAME = 'fingerpaint-gestures'
const STORE = 'samples'
const COUNTDOWN_MS = 3000
const RECORD_MS = 5000
const CAPTURE_INTERVAL_MS = 150

type Sample = { label: string; blob: Blob }

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Calls `visit` for every cursor position, all inside the request's own transaction. */
function walk<C extends IDBCursor>(req: IDBRequest<C | null>, visit: (cursor: C) => void) {
  return new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return resolve()
      visit(cursor)
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

/** Recorded samples, kept in IndexedDB so a reload doesn't lose them (in memory if IndexedDB is blocked). */
export class SampleStore {
  private db: Promise<IDBDatabase | null>
  private memory: Sample[] = []

  constructor() {
    this.db = new Promise((resolve) => {
      try {
        const open = indexedDB.open(DB_NAME, 1)
        open.onupgradeneeded = () => {
          open.result.createObjectStore(STORE, { autoIncrement: true }).createIndex('label', 'label')
        }
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }

  private async store(mode: IDBTransactionMode) {
    const db = await this.db
    return db?.transaction(STORE, mode).objectStore(STORE) ?? null
  }

  async add(sample: Sample) {
    const store = await this.store('readwrite')
    if (store) await request(store.add(sample))
    else this.memory.push(sample)
  }

  async counts() {
    const counts: Record<string, number> = {}
    const store = await this.store('readonly')
    if (store) {
      // Key cursor over the label index: reads labels without loading the images
      await walk(store.index('label').openKeyCursor(), (c) => {
        const label = String(c.key)
        counts[label] = (counts[label] ?? 0) + 1
      })
    }
    for (const { label } of this.memory) counts[label] = (counts[label] ?? 0) + 1
    return counts
  }

  async all(): Promise<Sample[]> {
    const store = await this.store('readonly')
    const stored = store ? ((await request(store.getAll())) as Sample[]) : []
    return [...stored, ...this.memory]
  }

  async deleteLabel(label: string) {
    const store = await this.store('readwrite')
    if (store) await walk(store.index('label').openCursor(label), (c) => c.delete())
    this.memory = this.memory.filter((s) => s.label !== label)
  }

  async clear() {
    const store = await this.store('readwrite')
    if (store) await request(store.clear())
    this.memory = []
  }

  /** Zip laid out the way Model Maker's `Dataset.from_folder` expects: gestures/<label>/<n>.jpg */
  async exportZip() {
    const samples = await this.all()
    const perLabel: Record<string, number> = {}
    const entries = await Promise.all(
      samples.map(async ({ label, blob }) => {
        const n = (perLabel[label] = (perLabel[label] ?? 0) + 1)
        return { name: `gestures/${label}/${label}_${String(n).padStart(4, '0')}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) }
      }),
    )
    return createZip(entries)
  }
}

export type RecordingState = { label: string; phase: 'countdown' | 'capturing' }

/**
 * Countdown, then grabs camera frames for a few seconds, skipping frames where no hand is detected
 * (Model Maker drops those anyway). Frames are saved unmirrored, exactly as the recognizer sees them.
 */
export class Recorder {
  private session: { label: string; start: number; end: number; next: number; capturing: boolean } | null = null
  private canvas = document.createElement('canvas')
  private onSample: (sample: Sample) => void
  private onState: (state: RecordingState | null) => void

  constructor(onSample: (sample: Sample) => void, onState: (state: RecordingState | null) => void) {
    this.onSample = onSample
    this.onState = onState
  }

  get active() {
    return this.session !== null
  }

  start(label: string, now: number) {
    this.session = { label, start: now + COUNTDOWN_MS, end: now + COUNTDOWN_MS + RECORD_MS, next: 0, capturing: false }
    this.onState({ label, phase: 'countdown' })
  }

  cancel() {
    this.session = null
    this.onState(null)
  }

  /** For drawing: seconds left in the countdown, or recording progress 0–1 */
  status(now: number) {
    const s = this.session
    if (!s) return null
    return now < s.start
      ? { label: s.label, countdown: Math.ceil((s.start - now) / 1000), progress: 0 }
      : { label: s.label, countdown: 0, progress: Math.min((now - s.start) / RECORD_MS, 1) }
  }

  update(now: number, handVisible: boolean, video: HTMLVideoElement) {
    const s = this.session
    if (!s || now < s.start) return
    if (now >= s.end) {
      this.cancel()
      return
    }
    if (!s.capturing) {
      s.capturing = true
      this.onState({ label: s.label, phase: 'capturing' })
    }
    if (!handVisible || now < s.next) return
    s.next = now + CAPTURE_INTERVAL_MS
    this.canvas.width = video.videoWidth
    this.canvas.height = video.videoHeight
    this.canvas.getContext('2d')!.drawImage(video, 0, 0)
    const label = s.label
    this.canvas.toBlob((blob) => blob && this.onSample({ label, blob }), 'image/jpeg', 0.9)
  }
}
