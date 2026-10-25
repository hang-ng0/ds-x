// the user can rank their top3
// remember to do npm install idb-keyval
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { get, set, del } from 'idb-keyval'
import './gallery.css'

type Rank = 1 | 2 | 3
const RANKS: Rank[] = [1, 2, 3]
const SCREEN_ORDER: Rank[] = [2, 1, 3] // classic podium: 2nd, 1st, 3rd
const MAX_BYTES = 10 * 1024 * 1024
const key = (rank: Rank) => `podium:${rank}`

type Urls = Record<Rank, string | null>

export default function Gallery() {
    const [urls, setUrls] = useState<Urls>({ 1: null, 2: null, 3: null })
    const [error, setError] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)
    const targetRank = useRef<Rank>(1)

    // Mirror of urls so handlers and cleanup always see the latest object URLs
    const urlsRef = useRef(urls)
    urlsRef.current = urls

    // Load saved podium images on mount
    useEffect(() => {
        let cancelled = false
        Promise.all(RANKS.map((r) => get<Blob>(key(r)))).then((blobs) => {
            if (cancelled) return
            const next = { 1: null, 2: null, 3: null } as Urls
            RANKS.forEach((r, i) => {
                const blob = blobs[i]
                next[r] = blob ? URL.createObjectURL(blob) : null
            })
            setUrls(next)
        })
        return () => {
            cancelled = true
        }
    }, [])

    // Free the object URLs when leaving the page
    useEffect(() => {
        return () => Object.values(urlsRef.current).forEach((u) => u && URL.revokeObjectURL(u))
    }, [])

    const place = async (rank: Rank, blob: Blob) => {
        await set(key(rank), blob)
        const old = urlsRef.current[rank]
        if (old) URL.revokeObjectURL(old)
        setUrls((prev) => ({ ...prev, [rank]: URL.createObjectURL(blob) }))
    }

    const remove = async (rank: Rank) => {
        await del(key(rank))
        const old = urlsRef.current[rank]
        if (old) URL.revokeObjectURL(old)
        setUrls((prev) => ({ ...prev, [rank]: null }))
    }

    const pickFile = (rank: Rank) => {
        targetRank.current = rank
        inputRef.current?.click()
    }

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = '' // so the same file can be chosen again later
        if (!file) return
        if (!file.type.startsWith('image/')) return setError('Please choose an image file.')
        if (file.size > MAX_BYTES) return setError('That image is over 10 MB.')
        setError('')
        await place(targetRank.current, file)
    }

    return (
        <div className="gallery-page">
            <h1>My Top 3</h1>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
            {error && <p className="gallery-error">{error}</p>}

            <div className="podium">
                {SCREEN_ORDER.map((rank) => {
                    const url = urls[rank]
                    return (
                        <div key={rank} className={`podium-slot rank-${rank}`}>
                            <div className="podium-frame">
                                {url ? <img src={url} alt={`Place ${rank}`} /> : <span className="podium-empty">???</span>}
                            </div>
                            <div className="podium-step">
                                <span className="podium-rank">{rank}</span>
                                <button type="button" onClick={() => pickFile(rank)}>
                                    {url ? 'Replace' : 'Upload'}
                                </button>
                                {url && (
                                    <button type="button" onClick={() => remove(rank)}>
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            <Link to="/paint">← Back to Painting</Link>
        </div>
    )
}