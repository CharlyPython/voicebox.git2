# Urdu generation with OmniVoice

Select **OmniVoice (non-commercial)** and **Urdu** in the generation form.
Urdu uses `ur`, the code accepted directly by upstream OmniVoice:
https://github.com/k2-fsa/OmniVoice/blob/main/omnivoice/utils/lang_map.py
Voicebox exposes 24 languages for this engine. This adds a speech generation
language; it does not translate the application interface.

## Checks without model downloads

```powershell
python -m pytest backend/tests/test_urdu_requests.py
bun test tests/languages.test.ts
python -m pytest backend/tests/test_omnivoice_compat.py
```

The existing OmniVoice compatibility suite checks that every advertised
language resolves against the installed upstream language map.

### Local automated results (2026-10-13)

- OmniVoice compatibility and Urdu request tests: **33 passed** on Windows,
  Python 3.12.13, PyTorch/torchaudio 2.11.0, Transformers 4.57.6,
  OmniVoice 0.2.1. Includes upstream resolution of the advertised `ur` code.
- Frontend selector tests: **2 passed**.
- TypeScript checks and web production build: passed.
- Audio listening review: pending.

### Audio generation results (2026-10-13)

The verification script generated all three designed-voice passages through
`OmniVoiceBackend` on Windows CPU with seed 42 and the `female` attribute.
All clips are 24 kHz and contain finite, non-silent audio.

| Passage | Clip duration | Generation time |
| --- | --- | --- |
| 1 | 2.82 s | 88.93 s |
| 2 | 5.48 s | 198.25 s |
| 3 | 5.21 s | 194.50 s |

Artifacts: `backend/tests/results/urdu/designed-{1,2,3}.wav` and `report.json`.
These local results are ignored by Git. This proves successful generation,
not pronunciation quality. Native-speaker listening and generation with a
reference voice have separate validation results below.

### Manual UI validation

The contributor reports that Urdu voice cloning through the local Voicebox
UI runs successfully. Detailed pronunciation and speaker-similarity scores
were not recorded, so this report does not claim quantified audio quality.

## Audio verification before submitting

Generate the three designed-voice clips and a JSON timing report from the
repository root with `python scripts/verify-urdu.py`. To also generate cloned
clips, pass `--reference-audio sample.wav --reference-text "accurate transcript"`.
Outputs go to the ignored `backend/tests/results/urdu/` directory. The script
downloads the model into `data/huggingface/` on first use.

Audio quality has not yet been verified by listening. With the model
installed, create a cloned profile from a clear Urdu recording you have
permission to use, and enter its accurate reference transcript. Select Urdu
and OmniVoice, generate each passage below, and save the audio. Also repeat
with a designed profile to check generation without a cloned reference.

1. السلام علیکم۔ آج موسم بہت خوشگوار ہے۔
2. میرا نام علی ہے۔ میں لاہور میں رہتا ہوں اور مجھے کتابیں پڑھنا پسند ہے۔
3. کیا آپ کل صبح نو بجے میرے ساتھ بازار جائیں گے؟ براہِ کرم وقت پر آ جائیں۔

Record hardware, OS, dependency versions, seed, generation time, and clip
duration. Have an Urdu speaker assess pronunciation, intelligibility,
pauses, and speaker similarity for cloned output. A transcription alone is
not sufficient evidence of natural speech. Attach audio only with the
speaker's permission, and describe any errors honestly in the PR.

Check that switching to Qwen or Chatterbox removes Urdu from the selector
and resets an unsupported selected language. Confirm English generation
still works after switching engines. OmniVoice remains opt-in and its
weights remain labelled non-commercial.
