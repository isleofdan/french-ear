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
