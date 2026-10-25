# Finger Paint: Project Guide

A finger-painting website for kids. A webcam tracks the child's hands with Google's
[MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) and they paint by
**reaching toward the screen**. No mouse or touch screen is needed. Everything runs in the browser, and no video leaves the computer.

This guide explains what each file does and how the pieces fit together.

- [Running the demo](#running-the-demo)
- [Using the demo](#using-the-demo)
- [How it works](#how-it-works)
- [What's in `src/`](#whats-in-src)
- [What's in `training/`](#whats-in-training)
- [Ink Dojo (full-body version)](#ink-dojo-full-body-version)
- [Other files](#other-files)
- [Key ideas](#key-ideas)
- [Common changes](#common-changes)
- [Current status and known gaps](#current-status-and-known-gaps)

---

## Running the demo

```sh
npm install      # once, and again whenever package.json changes
npm run dev      # starts the site; open the address it prints (usually http://localhost:5173)
```

- Use **Chrome or Edge** and allow camera access.
- The camera only works on `localhost` or an `https://` address.
- `npm run build` checks types and builds a production version into `dist/`. `npm run lint` checks code style.
- The full-body **Ink Dojo** app is at `/ink.html` on the same server (e.g. http://localhost:5173/ink.html).

## Using the demo

| Area | What it is |
|---|---|
| **Paper** (big white area) | Where painting happens. You can also draw on it with the mouse. |
| **Top bar** | Colors and the eraser 🧽 |
| **Left rail** | Brush type (☝️ Pointer, ✌️ Fingers, ✋ Handprint, ✨ Auto), brush size, undo ↩️, clear 🗑️ |
| **Sidebar** (right) | Camera preview, **Calibrate**, **Tune** (feel settings), **Gestures** (actions and training), debug readout |

**With your hand:** move it to move the cursor. Push toward the screen to paint and pull back to stop. Hover over a
toolbar button for about 0.7 s to press it. Clear takes 1.5 s so it isn't pressed by accident.

**Keyboard shortcuts:** `1`–`4` brush type · `C` calibrate · `S` Tune panel · `G` Gestures panel · `Z` undo

**Two hands / two kids:** each hand has its own cursor and its own color. The small **1** and **2** badges on the color
buttons show which hand has which color. Hovering a color changes it for that hand only. Clicking with the mouse sets both.

---

## How it works

Every camera frame goes through this pipeline:

```
Webcam (640×480)
  │
  ▼
MediaPipe GestureRecognizer ──► for each hand: 21 landmarks + a gesture label ("Thumb_Up", …)
  │
  ▼
assignHands()      keep each hand in the same "slot" frame to frame (by position)
  │
  ▼  per hand slot:
PenTracker         smooth the landmarks, estimate reach from apparent hand size,
  │                decide pen up/down, decide brush type (pointer / fingers / handprint)
  ├──► Dwell            hovering over a toolbar button long enough "clicks" it
  ├──► GestureTrigger   a held gesture fires its mapped action (undo, color, …)
  ▼
Painter            draws strokes / handprints onto the paper canvas
  │
  ▼
drawOverlay / drawPreview   cursors, gesture feedback, camera skeleton, meters
```

This loop runs every animation frame, **outside of React**. It reads settings through refs and draws directly on
`<canvas>` elements, so React doesn't re-render 30 times a second. React only renders the toolbars and panels.

---

## What's in `src/`

### Top level (app shell)

| File | What it does |
|---|---|
| `main.tsx` | Entry point. Mounts `<App />` into the page. |
| `App.tsx` | Currently renders `<FingerPaint />` directly (the whole demo). |
| `pages/Home.tsx`, `pages/Paint.tsx`, `pages/Gallery.tsx` | Placeholder pages for the planned multi-page site. Each only shows a heading so far. |
| `components/Root.tsx` | Route table: `/` → Home, `/paint` → Paint, `/gallery` → Gallery (react-router). **Not used by `main.tsx` yet.** |
| `components/Nav.tsx` | Links to the three pages. Used by `Root.tsx`. |
| `assets/` | Images left over from the Vite starter template. Not used. |

### `src/fingerpaint/`: the demo

**The main component and its UI**

| File | What it does |
|---|---|
| `FingerPaint.tsx` | **Start here.** The whole screen: layout, toolbars, sidebar, camera startup, model loading, and the per-frame loop that ties everything together (the diagram above). Also handles mouse drawing and keyboard shortcuts. |
| `FingerPaint.css` | All styles for the demo: layout grid, toolbar buttons and their hover-progress ring, sidebar, panels, badges. |
| `SettingsPanel.tsx` | The **⚙️ Tune** panel: sliders and toggles for every feel setting. Also exports the shared `Slider`, `Toggle` and `Section` controls. |
| `GesturePanel.tsx` | The **🤟 Gestures** panel: choose the built-in or custom model, map gestures to actions, record training images, download the dataset. |
| `palette.ts` | The colors, brush sizes and brush types shown in the toolbars. |

**Hand tracking and "feel"**

| File | What it does |
|---|---|
| `hand.ts` | Loads the MediaPipe model (`createRecognizer`). Hand math: palm size (the depth signal), which fingers are extended, picking a brush from the hand shape, and mapping camera coordinates to the screen. Contains **`PenTracker`**, which turns raw landmarks into a smoothed cursor plus pen up/down. It covers the resting-hand reach, fixed (calibrated) reach, pinch and gesture pen modes, and the press/lift frame counts. **The file to edit to change how painting feels.** |
| `hands.ts` | Two-hand support. `HandSlot` holds everything that belongs to one hand (its tracker, dwell, gesture trigger, stroke state). `assignHands` matches each detected hand to the same slot every frame. |
| `oneEuro.ts` | The One-Euro filter that smooths jittery landmark positions without making fast strokes laggy. |
| `calibration.ts` | The 2-step "relax, then reach" calibration that measures a child's hand size at both distances. |
| `settings.ts` | Every tunable setting, its **default value**, and saving/loading them in the browser (`localStorage`, key `fingerpaint-settings`). |

**Drawing**

| File | What it does |
|---|---|
| `painter.ts` | Owns the paper canvas: smooth strokes (several at once, one per finger per hand), handprints, eraser, see-through paint, undo and clear. |
| `overlay.ts` | Everything drawn on top that isn't paint: hand cursors (rings that shrink as you reach in), the handprint preview, hand number tags, gesture progress bubbles, the calibration prompt, plus the camera preview's skeleton, active-area box, reach meters, and the debug text. |
| `dwell.ts` | Hover-to-press for toolbar buttons. Any element with `data-dwell="<ms>"` gets clicked after the cursor rests on it that long. |

**Gestures and training data**

| File | What it does |
|---|---|
| `gestures.ts` | The list of actions a gesture can trigger, the built-in gesture names, and `GestureTrigger` (a gesture must be held for the hold time, fires once, then waits for a new gesture). |
| `samples.ts` | Recording training images: `Recorder` (3 s countdown, then about 30 frames over 5 s, only frames with a hand) and `SampleStore` (keeps them in the browser's IndexedDB, `fingerpaint-gestures`, and exports a zip). |
| `zip.ts` | A tiny zip-file writer used for the dataset download (no extra library needed). |

---

## What's in `training/`

Turns gestures you record in the app into a custom MediaPipe model. Step-by-step instructions are in
[`training/README.md`](training/README.md).

| File | What it does |
|---|---|
| `README.md` | How to record, train (Colab or Linux/macOS/WSL) and use a custom model. |
| `train_gestures.ipynb` | Google Colab notebook. Sets up Python 3.11, installs Model Maker, runs the script, downloads the model. **Use this on Windows.** |
| `train_gestures.py` | The training script: `gestures.zip` in → `custom_gesture_recognizer.task` out. Prints image counts per label and test accuracy. |
| `requirements.in` | The few top-level package versions training needs. Model Maker requires TensorFlow < 2.16, which means Python 3.9–3.11. |
| `requirements.txt` | Full locked list of every package version, generated from `requirements.in` (the command is at the top of the file). |

The flow end to end:
**App: Gestures → record → Download dataset** → **Colab: run notebook** → put `custom_gesture_recognizer.task` in
`public/models/` → **App: Gestures → Custom (trained)** → map each gesture to an action.

---

## Ink Dojo (full-body version)

A second app at `ink.html`, built on the same pieces. Kids stand back from the camera, and their moves become
animated ink: glowing neon on dark paper by default, softer colors on white paper, or ink on rice paper (the three
paper buttons in the toolbar). The 🖼️ button saves the painting as a PNG, exactly as it looks on screen.

| Move | Ink |
|---|---|
| 👊 **Punch** (at the camera, or out to the side) | A blot bursts open, throws spikes and droplets in the punch's direction, then drips |
| 👋 **Swoosh** (sweep or wave an arm) | A calligraphy brush slash along the hand's path, breaking into dry bristles at the tail and flinging ink off the tip. Waving back and forth paints one slash per swing. |
| 🦵 **Kick** | A heavier slash along the foot's rising arc |
| 🦘 **Jump** | A splash spread along the bottom of the paper where you land: several pools with crowns of spikes, and jets fanning out that fly up and spatter |
| 🙌 **Arm wave** (flap both arms up or down together, out to the sides) | Splashes come in from both side edges, at the height of each hand |
| 🐶 **Head shake** (side to side, about three swings in a second) | Paint sprays off your head mostly sideways, like a wet dog shaking itself dry |
| ✖ **Cross your arms in an X** and hold still (2.5 s) | Clears the paper: a ring fills while you hold, then the painting fades away. Undo brings it back. |

**Speed gradient:** slower moves paint less neon (dimmer and greyer on dark paper, paler on light paper). Within one
swoosh or kick, the slow start and end of the motion fade and the fast middle is full strength. Adjust or turn off with
**Tune → Ink → Speed gradient**.

Moves are detected with simple rules on MediaPipe **PoseLandmarker** body points (no training needed). Distances are
measured in torso lengths, so the same thresholds work for any kid at any distance. Hands are measured relative to the
shoulders and feet relative to the hips, so jumping or walking doesn't count as an arm or leg move. Everything can be
tuned in **⚙️ Tune**. **Move size** raises or lowers every threshold at once (the defaults only react to big, deliberate moves). Tune also has buttons (and keys `1`–`6`) to try each effect without moving. With the mouse, click
the paper to punch or drag to swoosh.

| File (`src/inkdojo/`) | What it does |
|---|---|
| `InkDojo.tsx` | The screen and per-frame loop: camera, pose model, moves → ink, hover-to-press toolbar, mouse fallback |
| `moves.ts` | **Move detection.** `MoveDetector` follows each arm and leg (`LimbTracker`), the hips (`JumpTracker`) and the head (`ShakeTracker`), and reports punches, swooshes, kicks, jumps, arm waves and head shakes. The file to edit to change what counts as a move. |
| `inkfx.ts` | **The ink engine.** `BlotEffect`, `SlashEffect`, `SplashEffect` (bottom or side edge) and `SprayEffect` animate on their own layers with flying droplets and drips, then blend into the paper so overlapping hits darken. Also generates the paper texture. |
| `overlay.ts` | Hand and foot trails, comic-style move callouts, and the camera preview's skeleton and jump meter |
| `InkPanel.tsx`, `settings.ts` | The tuning panel and its settings (saved under `inkdojo-settings`) |
| `pose.ts` | Loads the pose model. Body point names. |
| `main.tsx`, `/ink.html`, `inkdojo.css` | Entry point, page, and the few styles that differ from the finger paint app |

It reuses from `src/fingerpaint/`: the layout and panel styles, the `Slider`/`Toggle`/`Section` controls, hover-to-press
buttons (`dwell.ts`), smoothing (`oneEuro.ts`) and camera-to-screen mapping (`hand.ts`). Models:
`public/models/pose_landmarker_lite.task` (fast) and `pose_landmarker_full.task` (accurate), switchable in Tune.

---

## Other files

| File | What it does |
|---|---|
| `public/models/gesture_recognizer.task` | MediaPipe's built-in hand + gesture model (8 MB). Stored in the repo so the app doesn't download it from Google at runtime. |
| `public/models/custom_gesture_recognizer.task` | *(not in the repo until you train one)* Your custom model. |
| `package.json` | Dependencies: React, `@mediapipe/tasks-vision` (pinned to 1.1.0), `react-router`. |
| `vite.config.ts`, `tsconfig*.json`, `eslint.config.js` | Build, TypeScript and lint configuration. `vite.config.ts` builds both pages (`index.html` and `ink.html`). |
| `.gitignore` | Also excludes `gestures*.zip` (recorded camera photos) and training outputs. |
| `prototype.js`, `README.md` | Currently empty. |

---

## Key ideas

**Depth from hand size.** MediaPipe's `z` value only says how the fingers sit relative to the wrist. It can't tell
how far the hand is from the camera. Instead the app measures how big the palm looks: a bigger palm means closer to
the screen.

**Resting-hand reach (the default).** The app keeps track of how big each hand looks "at rest". Paint starts when the
hand looks *Push amount* bigger than that (12% by default) and stops when it pulls back below *Push amount* minus
*Release gap*. The resting size slowly follows the hand, so leaning in or sitting back doesn't start painting. The
alternative, **Fixed (calibrated)**, compares against the two sizes measured during calibration.

**Debouncing.** The pen only changes state after the signal holds for a few frames (*Frames to press / lift*). That
prevents stray dots and broken lines. Pinch is the exception when lifting: it lifts immediately once the fingers pass
the release point or start opening quickly, so spreading the fingers doesn't drag a line.

**Each pen-down mode has its own feel.** Reach, Pinch and Gesture each keep their own frame counts and cursor smoothing
(`modeTuning` in `settings.ts`), starting from a preset for that mode. Pinch is the snappiest because touching fingertips
is a clear signal. Gesture is the most cautious because gesture labels flicker. Tuning one mode never changes another.

**Smoothing.** Landmarks jitter. The One-Euro filter smooths heavily when the hand is still and lightly when it moves
fast. *Steadiness* and *Speed response* in Tune control it.

**Active area.** Only part of the camera image (the dashed box in the preview) maps to the screen, so kids can reach
the screen edges without their hand leaving the camera's view. The box is shifted toward the **top** of the camera
image (*Shift area up*). The cursor follows the fingertip, but MediaPipe needs to see the palm, which hangs well below
the fingertip. With a centered box, reaching the bottom of the paper pushes the palm out of the camera's view and the
hand is lost.

**Brush types.** *Pointer* paints with the index fingertip. *Fingers* paints one line per extended finger.
*Handprint* stamps the whole hand shape. *Auto* picks one from the hand shape: 1 finger, 2–3 fingers, or an open hand.
A stroke keeps its brush type until the pen lifts.

**See-through paint and shading.** Strokes are drawn on a separate layer and blended in at *Paint opacity* when the
pen lifts. A stroke never darkens where it overlaps itself, but separate strokes stack, so kids can shade.

**Gesture actions.** Any gesture the model recognizes can be mapped to an action. *Pen down* is special: in
*Pen down by → Gesture* mode, holding that gesture paints.

**Privacy.** Hand tracking runs on the device and the video is never uploaded. The only images saved are training
recordings, kept in that browser until downloaded. Get permission before recording anyone, especially children.

---

## Common changes

| I want to… | Edit |
|---|---|
| Change a default setting (push amount, opacity, …) | `DEFAULT_SETTINGS` in `settings.ts`. Saved browser settings override defaults, so press **Tune → Reset to defaults** to see the change. |
| Add or change colors / brush sizes | `palette.ts` |
| Change how painting feels | `PenTracker` in `hand.ts` (thresholds come from settings) |
| Change what a brush draws | `paintHand` in `FingerPaint.tsx`, `painter.ts` |
| Change cursors or on-screen feedback | `overlay.ts` |
| Add a new gesture action | The `GestureAction` type in `settings.ts`, `ACTION_OPTIONS` in `gestures.ts`, and `applyAction` in `FingerPaint.tsx` |
| Add a setting to the Tune panel | Add it to `Settings` and `DEFAULT_SETTINGS` in `settings.ts`, then add a `Slider`/`Toggle` in `SettingsPanel.tsx` |
| Train new gestures | [`training/README.md`](training/README.md) |

---

## Current status and known gaps

- **The router isn't connected.** `main.tsx` renders `App` → `FingerPaint` directly. To switch to the multi-page
  site:
  1. Wrap `Root` in `BrowserRouter` in `main.tsx`.
  2. Render `<FingerPaint />` inside `pages/Paint.tsx`.
  3. Note that `FingerPaint.css` currently makes the demo **fill the whole window** (`.fp-app { position: fixed; inset: 0 }`)
     and hides page scrolling (`html, body, #root { overflow: hidden }`). Those rules need to change for `Nav` to stay
     visible.
- **Gallery** is a placeholder. There's no "save painting" feature yet.
- **Tested with simulated hands, not real children.** The logic (reach, hand matching, brush detection, see-through
  paint, zip export) has automated checks with made-up landmark data. How it *feels* still needs tuning with real
  kids.
- **Custom gesture training hasn't been run end-to-end yet.** The script matches the Model Maker library's real API
  and its package versions resolve correctly, but the first real Colab run is the true test.
- Brush size and brush type are shared between hands. Only color is per hand.
