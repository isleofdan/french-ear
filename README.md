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

Every line of an answer is checked on its own (`lib/spoken.js`, `checkLine`):
pattern ids must be in the list, spans must lie inside the line. A line that
fails is saved with its reason and shown as "not yet worked out", with a
"try again".

## Environment

| Name | What |
|---|---|
| `APP_PASSWORD` | the shared passphrase; unset means only the login page serves |
| `COOKIE_SECRET` | signs the 30-day cookie; made once by the deploy workflow |
| `OPENROUTER_API_KEY` | the key for the "as said" pass |
| `DATA_DIR` | where the SQLite file lives (`/data` on Fly, `./var` locally) |
| `MODEL`, `FALLBACK_MODEL` | override the two models |
| `OPENROUTER_URL`, `YT_BASE` | point the app at local mocks in checks |
| `COOKIE_INSECURE=1` | lets the cookie work over plain http locally |

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes under `/api/`, the pages.
- `lib/youtube.js` — the link parser and the caption fetch (title, tracks, lines).
- `lib/spoken.js` — the "as said" pass: the prompt, the call, the checks on each line.
- `lib/tally.js` — the one place the solid / shaky / seen / not met yet rule lives.
- `lib/db.js` — the SQLite tables: videos, lines, kept, events.
- `data/patterns.json` — the twenty patterns, fixed.
- `public/` — the pages: home, watch, kept, patterns, login; the manifest (with Android's share target) and the service worker.
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
