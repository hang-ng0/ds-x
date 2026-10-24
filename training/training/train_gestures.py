"""Train a custom MediaPipe gesture recognizer from the finger paint app's dataset export.

Usage:
    python train_gestures.py gestures.zip [--out exported] [--epochs 30]

Needs Python 3.9-3.11 with training/requirements.txt installed, on Linux, macOS, WSL or Colab
(Model Maker's TensorFlow dependencies have no native Windows build). See training/README.md.

Writes <out>/custom_gesture_recognizer.task. Copy it into public/models/ and pick
"Custom (trained)" in the app's Gestures panel.
"""

import argparse
import sys
import tempfile
import zipfile
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
RECOMMENDED_PER_LABEL = 100
OUTPUT_NAME = "custom_gesture_recognizer.task"


def find_dataset_root(path: Path) -> Path:
    """The folder whose subfolders are the labels, i.e. the one with a 'none' subfolder."""
    for candidate in [path, *sorted(p for p in path.rglob("*") if p.is_dir())]:
        if any(d.is_dir() and d.name.lower() == "none" for d in candidate.iterdir()):
            return candidate
    sys.exit(f"No 'none' folder found in {path}. Model Maker requires a 'none' class: record one in the app.")


def summarize(root: Path) -> dict[str, int]:
    counts = {
        d.name: sum(1 for f in d.iterdir() if f.suffix.lower() in IMAGE_EXTS)
        for d in sorted(root.iterdir())
        if d.is_dir()
    }
    print("Images per label:")
    for label, n in counts.items():
        warning = f"   <- few; aim for {RECOMMENDED_PER_LABEL}+" if n < RECOMMENDED_PER_LABEL else ""
        print(f"  {label:24s}{n:6d}{warning}")
    return counts


def train(root: Path, args: argparse.Namespace) -> None:
    # Imported here so --help works without TensorFlow installed
    from mediapipe_model_maker import gesture_recognizer

    counts = summarize(root)
    if len(counts) < 2:
        sys.exit("Need at least one gesture besides 'none'.")

    print("\nFinding hands in every image (images with no detected hand are skipped)...")
    data = gesture_recognizer.Dataset.from_folder(
        dirname=str(root),
        hparams=gesture_recognizer.HandDataPreprocessingParams(),
    )
    print(f"Usable images: {data.size} of {sum(counts.values())}. Labels: {data.label_names}")
    train_data, rest = data.split(0.8)
    validation_data, test_data = rest.split(0.5)

    options = gesture_recognizer.GestureRecognizerOptions(
        hparams=gesture_recognizer.HParams(
            export_dir=args.out,
            epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.learning_rate,
        ),
        model_options=gesture_recognizer.ModelOptions(dropout_rate=args.dropout),
    )
    model = gesture_recognizer.GestureRecognizer.create(
        train_data=train_data,
        validation_data=validation_data,
        options=options,
    )

    loss, accuracy = model.evaluate(test_data, batch_size=1)
    print(f"\nTest accuracy: {accuracy:.1%} (loss {loss:.3f}) on {test_data.size} held-out images")

    model.export_model(model_name=OUTPUT_NAME)
    print(f"Wrote {Path(args.out) / OUTPUT_NAME}. Copy it into public/models/.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", help="gestures.zip from the app, or an extracted folder")
    parser.add_argument("--out", default="exported", help="output folder (default: exported)")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--dropout", type=float, default=0.1)
    args = parser.parse_args()

    dataset = Path(args.dataset)
    if dataset.suffix.lower() == ".zip":
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(dataset) as z:
                z.extractall(tmp)
            train(find_dataset_root(Path(tmp)), args)
    else:
        train(find_dataset_root(dataset), args)


if __name__ == "__main__":
    main()
