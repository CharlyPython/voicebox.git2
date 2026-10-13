"""Generate Urdu verification clips through Voicebox's OmniVoice backend.

Run from the repository root: python scripts/verify-urdu.py
Optional: --reference-audio sample.wav --reference-text "accurate transcript"
Requires Voicebox's OmniVoice dependencies and downloads its model on first use.
"""

import argparse
import asyncio
import json
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PASSAGES = [
    "السلام علیکم۔ آج موسم بہت خوشگوار ہے۔",
    "میرا نام علی ہے۔ میں لاہور میں رہتا ہوں اور مجھے کتابیں پڑھنا پسند ہے۔",
    "کیا آپ کل صبح نو بجے میرے ساتھ بازار جائیں گے؟ براہِ کرم وقت پر آ جائیں۔",
]


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-audio", type=Path)
    parser.add_argument("--reference-text")
    parser.add_argument(
        "--output", type=Path, default=ROOT / "backend/tests/results/urdu"
    )
    args = parser.parse_args()
    if bool(args.reference_audio) != bool(args.reference_text):
        parser.error("Provide both --reference-audio and --reference-text for cloning")

    # Keep downloaded model files within the workspace.
    os.environ.setdefault("HF_HOME", str(ROOT / "data/huggingface"))
    if sys.platform == "win32":
        # Verification runs without administrator privileges. Some Windows
        # hosts pass the Hub's symlink probe but reject links during download;
        # use its existing file-copy fallback consistently for this script.
        from huggingface_hub import file_download

        file_download.are_symlinks_supported = lambda cache_dir=None: False
    import soundfile as sf
    import torch
    import transformers
    from huggingface_hub import snapshot_download

    from backend.backends.omnivoice_backend import OmniVoiceBackend

    args.output.mkdir(parents=True, exist_ok=True)
    backend = OmniVoiceBackend()
    report = {
        "platform": platform.platform(),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "seed": 42,
        "listening_review": "pending",
        "clips": [],
    }
    try:
        started = time.perf_counter()
        # Complete any partial download left by an interrupted previous run;
        # upstream may otherwise treat an incomplete snapshot as cached.
        await asyncio.to_thread(snapshot_download, "k2-fsa/OmniVoice")
        await backend.load_model()
        report["load_seconds"] = time.perf_counter() - started
        report["device"] = backend.device
        modes = [("designed", {}, "female")]
        if args.reference_audio:
            prompt, _ = await backend.create_voice_prompt(
                str(args.reference_audio), args.reference_text
            )
            modes.append(("cloned", prompt, None))
        for mode, prompt, instruct in modes:
            for index, text in enumerate(PASSAGES, 1):
                started = time.perf_counter()
                audio, sample_rate = await backend.generate(
                    text, prompt, language="ur", seed=42, instruct=instruct
                )
                path = args.output / f"{mode}-{index}.wav"
                sf.write(path, audio, sample_rate)
                clip = {
                    "path": str(path),
                    "text": text,
                    "mode": mode,
                    "seconds": len(audio) / sample_rate,
                    "sample_rate": sample_rate,
                    "generation_seconds": time.perf_counter() - started,
                }
                report["clips"].append(clip)
                print(json.dumps(clip, ensure_ascii=True), flush=True)
    finally:
        report["completed_clips"] = len(report["clips"])
        backend.unload_model()
        (args.output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    asyncio.run(main())
