# Training custom gestures

The app ships with MediaPipe's built-in gesture model (`public/models/gesture_recognizer.task`). This folder
retrains it on gestures you record, using [MediaPipe Model Maker](https://ai.google.dev/edge/mediapipe/solutions/customization/gesture_recognizer).

```
App: Gestures panel → record → Download dataset (gestures.zip)
        ↓
Colab: train_gestures.ipynb  (or train_gestures.py on Linux/macOS/WSL)
        ↓
custom_gesture_recognizer.task → public/models/ → app: Gestures → Custom (trained)
```

## 1. Record

In the app, open **🤟 Gestures** (or press G), type a gesture name, and press **Record**. After a 3-second
countdown it saves about 30 frames over 5 seconds, but only frames where a hand is visible.

- **Record a `none` class.** Model Maker requires it. Use ordinary hand poses that aren't any of your gestures,
  including the poses kids use while painting (pointing, open hand), so painting doesn't trigger gestures.
- **Aim for 100+ images per gesture,** over several takes: left and right hands, near and far, different angles,
  lighting, and ideally different people. Variety matters more than count.
- Recordings are kept in the browser (IndexedDB), so reloading the page doesn't lose them.

Then press **Download dataset**. The zip contains `gestures/<label>/*.jpg`.

> The images are camera photos of whoever recorded them. Get permission before recording anyone else,
> especially children, and don't commit the zip or share it beyond the people training the model.

## 2. Train

### Google Colab (recommended on Windows)

1. Open `train_gestures.ipynb` in [Colab](https://colab.research.google.com/) (File → Upload notebook).
2. Run all cells. When asked, upload `training/requirements.txt`, `training/train_gestures.py` and your
   `gestures.zip`.
3. The last cell downloads `custom_gesture_recognizer.task`.

### Locally (Linux, macOS or WSL)

Model Maker needs TensorFlow < 2.16, so **Python 3.9–3.11**. It doesn't install on native Windows.

```sh
uv venv --python 3.11 .venv-train
uv pip install --python .venv-train -r training/requirements.txt
.venv-train/bin/python training/train_gestures.py gestures.zip --out exported
```

Options: `--epochs` (30), `--batch-size` (8), `--learning-rate` (0.001), `--dropout` (0.1).

The script prints how many images each label has, how many were usable (a hand was found), and accuracy on
10% of images held out from training. If accuracy is low, record more varied examples before adjusting the options.

## 3. Use it

1. Copy `custom_gesture_recognizer.task` into `public/models/`.
2. In the app, open **Gestures → Model → Custom (trained)**. Your gesture names appear under **Actions**
   (labels you recorded, plus any the model reports).
3. Map each gesture to an action. Use **Min confidence** and **Hold time** to trade speed against accidental
   triggers.

A custom model only knows the gestures it was trained on. If you still want built-in ones like a thumbs-up,
record them as their own labels too.

## Files

- `train_gestures.py`: training script (zip or folder in, `.task` out)
- `train_gestures.ipynb`: Colab wrapper around the script
- `requirements.in`: top-level version pins
- `requirements.txt`: full lockfile for Linux / Python 3.11, generated from `requirements.in` (command at its top)
