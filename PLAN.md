# French ear — plan and decisions

## Session one (french-ear-one, 24 Sep 2026): the YouTube side

From the brief filed on the `french-ear` card (Personal Shipyard):

- **Stack.** Plain Node (`node:http`, no framework), `better-sqlite3`, plain
  HTML/CSS/JS pages. The deploy pattern is copied from `isleofdan/hebrew-reader`.
- **Hosting.** Fly app `french-ear-dan`, region `nrt`, 512 MB, always on;
  volume `ear_data` mounted at `/data` — never change that mount path.
  Deploys only through `.github/workflows/deploy.yml`, on push to `main`.
- **Gate.** One shared passphrase (`APP_PASSWORD`), a signed 30-day cookie,
  fail closed when unset. Dan and his father share it for now.
- **Captions.** Server side: the watch page, then YouTube's player call as
  the Android client; a French track not auto-generated, else the French
  auto-generated one, else "This video has no French captions I can read" and
  nothing saved. No speech recognition this session.
- **As said.** One OpenRouter call per 40 lines; `anthropic/claude-sonnet-4.6`
  then `google/gemini-2.5-flash`. Every line checked on its own; a failed line
  is saved `unworked` with its reason and offered again. Time limits come from
  the expected answer size (`budget()` in `lib/spoken.js`).
- **Pull-only.** Nothing notifies or reminds.
- **Tally.** The rule in `docs/DESIGN.md` and `lib/tally.js`.

Out of scope this session: the photo-of-the-TV path (session two), practice
clips (session three), speech recognition, suggesting videos, second users,
downloading any video or audio.

## Close-out, session one (24 Sep 2026)

- **Live:** https://french-ear-dan.fly.dev, deployed by the workflow on the
  first push to `main` (run 1 green: checks, app, volume `ear_data`, secrets,
  deploy, live answer). Dan signed in and saw the home page.
- **Stopped at live check 2, as the brief says.** From Fly, YouTube listed the
  test video's French track, then answered HTTP 429 (an HTML "too many
  requests" page, 1,103 characters) for the track's text, as XML and as json3.
  Nothing was saved. Checks 3 and 4 (tapping a tinted line, Ear first) were
  not run live. The fallback is the Personal Shipyard chat's decision.
- `main` was created by Dan on GitHub: the session's safety check refused the
  push to `main` even with his word. The repo's default branch is still
  `claude/eloquent-hopper-727dun` (the first branch pushed to the empty repo).
- Report: `docs/reports/french-ear-one-report.md`.
