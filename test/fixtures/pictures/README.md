# Picture fixtures

Pictures the checks send through the screenshot path and the TV-photo path.
The stand-in OpenRouter (`scripts/mock-openrouter.mjs`) knows each one by its
bytes (sha256) and answers with its entry in `answers.json`, the way a model
would.

| File | Real or drawn | What it is |
|---|---|---|
| `shot-1.png` | drawn | the YouTube app's transcript panel, one row per entry (time beside the text), the Easy French video's opening |
| `shot-2.png` | drawn | the next screen of the same panel: one entry cut off at the top, one at the bottom, one overlapping `shot-1.png` |
| `shot-accents.png` | drawn | a panel with accents and apostrophes to copy exactly |
| `no-transcript.png` | drawn | a picture with no transcript in it |
| `tv-english.png` | drawn | a dark TV frame paused on an English subtitle |
| `tv-french.png` | drawn | a dark TV frame paused on a French subtitle |
| `tv-none.png` | drawn | a TV frame with no subtitle on it |

Drawn pictures are made by `scripts/make-picture-fixtures.mjs`
(`node scripts/make-picture-fixtures.mjs`); the one-row layout is the one
Dan's phone showed on 25 Sep.

Real pictures: none yet. Dan said yes on 25 Sep to committing his own
screenshots of the YouTube app's transcript as test pictures, cropped of the
phone's status bar. They were not in reach of the session that wrote this
(a cloud session, 25 Sep); the next session on the laptop adds them here,
marked "real", with their expected lines in `answers.json`.
