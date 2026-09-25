# French ear

A personal web app for one learner of French, Dan's father, whose trouble is
that spoken French sounds nothing like the French he reads: *je ne sais pas*
comes out as *chais pas*, *il y a* as *y a*, *tu as* as *t'as*.

He pastes a link to a YouTube video he is watching. The app reads the video's
French captions and shows every line twice: as written, and as you'll hear it,
with the changed parts tinted and named — each one is one of a fixed list of
twenty spoken-French patterns (`data/patterns.json`). The video plays in the
page through YouTube's own player, the current line kept in view. Two ways to
watch: **Follow along** (lines showing) and **Ear first** (lines hidden; one
button, "What was that?", shows the last two). The app keeps a tally of which
patterns keep getting past him, and a list of the lines he chose to keep.
A second box takes one typed or pasted French sentence and shows the same.

YouTube often refuses to hand caption text to a server (session one met HTTP
429 from Fly). So a video's lines can also come from its transcript, copied
from YouTube's own "Show transcript" panel and pasted under the link, or on
the video's page when the fetch fails. The paste is read with or without
timestamps (`lib/transcript.js`); without them, the lines are a plain list
that does not follow the video. On a phone or tablet the YouTube app will not
let the transcript be copied, so screenshots of it can be added instead; the
lines are read out of the pictures (`lib/pictures.js`). Sharing a screenshot
to French ear from Android's Share lands it on the home page.

The TV is the other place lines get past him. "Add a photo from the TV" on
the home page takes one photo of the screen, paused or not; the subtitle on
it is read, and he can note in a few words what it sounded like and what is
happening, then "Save for later". The app works out the French later
(`lib/tv.js`): a French subtitle goes through the ordinary "as said" pass; an
English one (or none, with a sound note) goes to one call that gives the most
likely French line, as written and as said, its patterns, and how sure it is.
The photos are listed on "From the TV", newest first.

Nothing in the app notifies, reminds or counts days. It answers when opened.

## Running it

```
npm install
APP_PASSWORD=... COOKIE_SECRET=... OPENROUTER_API_KEY=... COOKIE_INSECURE=1 node server.js
```

Open http://localhost:8080. `npm test` runs the checks against mocks;
`npm run screenshots` captures every page on phone and computer, light and
dark, into `docs/screenshots/`.

## The models

The "as said" pass calls OpenRouter, one call per batch of up to 40 lines:

- first **`anthropic/claude-sonnet-4.6`** (`MODEL` overrides it);
- when that call fails outright (unreachable, an error, no answer in time, no
  JSON), the same batch goes once to **`google/gemini-2.5-flash`**
  (`FALLBACK_MODEL` overrides it).

Screenshots of the transcript (a phone or tablet, where the YouTube app will
not let the transcript be copied) are read by a model that reads pictures,
one OpenRouter call per picture:

- first **`google/gemini-2.5-flash`** (`IMAGE_MODEL` overrides it);
- when that call fails outright, the same picture goes once to
  **`anthropic/claude-sonnet-4.6`** (`IMAGE_FALLBACK_MODEL` overrides it).

A cost per screenshot has not yet been read from the live log; the figure
below is an estimate at Flash's list price, not a measured one: about
$0.002 or less per phone screenshot (~1,300 tokens in, ~300–500 out). The
server log's `screenshots: … cost $…` line gives the real one.

Photos from the TV go to the same two picture models, with a prompt of their
own: the subtitle on the photo, exactly as printed, and its language. The
answer is checked (`checkSubtitleLine`): some text and English or French, or
"no subtitle" (a state, not a failure). An English subtitle is then worked
out into French by the "as said" models (`MODEL`, then `FALLBACK_MODEL`), one
call per photo, its answer checked with the "as said" pass's own check plus a
French line and a sure word (high, medium, low). The server log names the
model and cost of each (`tv: …`).

Each line it reads is checked (`lib/pictures.js`, `checkPictureLine`): the
time must read as a time and never go backwards within a picture, the text
must not be empty. A line that fails is dropped and counted, never guessed.
Overlapping screenshots are merged by time. The server log names the model
and the cost of each picture.

Every line of an "as said" answer is checked on its own (`lib/spoken.js`, `checkLine`):
pattern ids must be in the list, spans must lie inside the line. A line that
fails is saved with its reason and shown as "not yet worked out", with a
"try again".

## Environment

| Name | What |
|---|---|
| `APP_PASSWORD` | the shared passphrase; unset means only the login page serves |
| `COOKIE_SECRET` | signs the 30-day cookie; made once by the deploy workflow |
| `OPENROUTER_API_KEY` | the key for the "as said" pass |
| `DATA_DIR` | where the SQLite file and the `photos/` folder live (`/data` on Fly, `./var` locally) |
| `MODEL`, `FALLBACK_MODEL` | override the two "as said" models |
| `IMAGE_MODEL`, `IMAGE_FALLBACK_MODEL` | override the two models that read screenshots |
| `OPENROUTER_URL`, `YT_BASE` | point the app at local mocks in checks |
| `COOKIE_INSECURE=1` | lets the cookie work over plain http locally |

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes under `/api/`, the pages.
- `lib/youtube.js` — the link parser and the caption fetch (title, tracks, lines).
- `lib/transcript.js` — a transcript pasted from YouTube's panel, read into lines.
- `lib/pictures.js` — lines read out of pictures (screenshots of the transcript): the call, the checks, the merge.
- `lib/tv.js` — photos from the TV: stored, the subtitle read, the French worked out, the tally.
- `lib/spoken.js` — the "as said" pass: the prompt, the call, the checks on each line.
- `lib/tally.js` — the one place the solid / shaky / seen / not met yet rule lives.
- `lib/db.js` — the SQLite tables: videos, lines, kept, events, moments (photos from the TV; the photos themselves in `photos/` beside the database).
- `data/patterns.json` — the twenty patterns, fixed.
- `public/` — the pages: home, watch, From the TV, one photo (moment), kept, patterns, login; the manifest (with Android's share target) and the service worker.
- `test/` — the checks (`node --test`); `scripts/` — the mock servers and the screenshot run.
- `docs/DESIGN.md` — the design decisions; `docs/screenshots/`, `docs/reports/`.

## Deploying

`.github/workflows/deploy.yml` runs on every push to `main` (and by hand): it
runs the checks, creates the Fly app `french-ear-dan` and its volume if they
are missing, sets the secrets that are not yet set, deploys, and checks the
live site answers. It needs the repository secrets `FLY_API_TOKEN`,
`APP_PASSWORD` and `OPENROUTER_API_KEY`. The site is
https://french-ear-dan.fly.dev.

A secret already set on Fly is left alone: to change the passphrase, change
it on Fly (`flyctl secrets set APP_PASSWORD=... --app french-ear-dan`), not
only in the repository.
