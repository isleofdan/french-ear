# FIELD REPORT — french-ear-four — 25 Sep 2026

**For Dan:** the app change is live. isleofdan/french-ear#6 was merged and deployed green. This report is in its own pull request, which holds documents only: https://github.com/isleofdan/french-ear/pull/7. Tap **Merge pull request**, then **Confirm merge**.

Session: french-ear-four (cloud). Surface: cloud (`flyctl version` failed: not installed). `main` held session three's commits at the start.

## What stands

**Proven live by Dan (phone, 25 Sep):**
- Screenshots of the YouTube app's transcript in, on the phone: he added two screenshots of https://www.youtube.com/watch?v=flS3MVNXWbw to the home page with the link. "Here's how I read your screenshots" showed:
  - 0:00 "Bonjour les amis et bienvenue dans un nouvel épisode d'iz French."
  - 0:04 "Aujourd'hui, nous allons simplement demander aux passants si ils sont heureux."
  - 0:10 "C'est parti."
  - "Screenshot 1: 4 lines. Screenshot 2: 6 lines (1 already in an earlier screenshot)." and "17 lines in all".
- The overlap between the two pictures was merged without a duplicate. The title came from YouTube ("The Secrets of French Happiness | Easy French 236"). Tinted lines appeared under the player ("nous allons" shown as **on va**, on-for-nous).
- Android Share: Dan installed French ear from Chrome's menu, but it **does not appear in the YouTube app's share list**. Treated as a finding, per the brief (see below).

**Checked against mocks only:**
- The fallback model: the first model failing sends the same picture to the second.
- The refusal of a picture with no transcript ("I couldn't find a transcript in this picture.", nothing saved).
- A bad line being dropped and counted.
- Resubmitting screenshots replacing the lines, with kept lines surviving.
- The shared-picture landing on the home page ("1 screenshot added.", link box empty, "Paste the video's link too"). Not proven live, because Share itself did not appear.

**What was built:**
- `lib/pictures.js`: `readPictures(files)` takes pictures and returns `{ lines: [{ start_s, end_s, written }], pictures: [per-picture counts] }`, with nothing about YouTube in its signature.
  - One OpenRouter call per picture, 3 at a time, asking for JSON `{transcript, lines: [{time, text}]}`.
  - Checks on each line: the time must read as m:ss or h:mm:ss, times never go backwards within one picture, the text must not be empty. A failing line is dropped with its reason counted.
  - Pictures are merged by time; the first text seen for a time is kept.
  - Time limit ~73 s per picture, from ~1,700 expected output tokens.
- Route `POST /api/screenshots` (multipart: `link`, `screenshots`, optional `shared`): sentences → "as said" → saved as `caption_track = 'screenshots'`, or replacing an existing video's lines (session three's rule).
- On screen, "Add screenshots of the transcript" appears:
  - on the home page, under the link box;
  - on the video page in its no-lines state;
  - under "Add the transcript again" (renamed from "Paste the transcript again").
- The readback lists lines per screenshot and lines dropped. The brief's phone wording is on the video page and the home page.
- Manifest share target: POST, `multipart/form-data`, a `screenshots` file field accepting images (Web Share Target API). The server holds shared pictures in memory for an hour. `/share` still takes GET for installs made before this change.
- Checks: `npm test` 68 pass. The browser run passes, with new captures in `docs/screenshots/` (`home-screenshots-added-*`, `watch-screenshots-readback-*`, `home-shared-screenshot-phone-light`), phone and computer, light and dark.

## What the brief got wrong

- **The YouTube app's transcript layout on Dan's phone puts the time beside the text, on one row** ("0:00 Bonjour les amis…"), not the time on one line and the text on the next as the brief described. The model prompt accepts both, and the live read was right. My synthetic fixtures (`test/fixtures/pictures/`, drawn by `scripts/make-picture-fixtures.mjs`) follow the brief's layout and are marked synthetic. Dan's first picture (from his laptop, a scrolling screenshot) shows the one-row layout too.
- **"If Dan attaches screenshots, commit them as fixtures" was refused by the session's safety check** ("out-of-place publication": Dan's own picture going to GitHub). The picture is not in the repo. See ask 2.
- **A phone screenshot of the panel holds only 4–6 lines**, not the 8–15 the brief implied, because the video player takes the top of the screen. A whole transcript is many screenshots. Dan used a scrolling screenshot on the laptop, which captures the whole list in one picture; on the phone he took two ordinary screenshots.
- **The brief expects the share list to work once installed.** It did not appear (see divergences and asks).

## Deliberate divergences — DO NOT REVERSE

- **Picture model: `google/gemini-2.5-flash` first, `anthropic/claude-sonnet-4.6` as fallback.** This is the reverse of the "as said" pass order. Reading printed text from a screenshot is a cheap, fast job for Flash; Sonnet is the safety net.
- **One call per picture, not one call for all.** The per-picture counts and the "never backwards within one picture" check depend on it, and a failure costs one picture, not the batch.
- **Pictures are checked by their first bytes (PNG or JPEG), not by the name or type the phone gives.** WebP and HEIC are refused with a plain message ("isn't a picture I can read. Screenshots (PNG or JPEG) only."). Dan's phone sent PNG or JPEG. Nothing was refused.
- **The share target is now POST.** GET cannot carry files. Link shares still land in the link box by either method.
- **Shared pictures are held in server memory for an hour, not in the service worker.** This works whether or not the service worker is active and is covered by the server tests. A restart forgets them, and the home page says so.
- **Screenshots and a pasted transcript together are refused** ("Use either the screenshots or the pasted transcript, not both"), rather than one silently winning.
- **The per-screenshot counts are kept in the browser tab (sessionStorage), not in the database.** Opened later, the readback shows the three lines without the counts. This was a choice to add no database column.

## Dan's decisions this session

- Took the phone test with two ordinary screenshots; the result is recorded above.
- Installed French ear from Chrome's menu for the Share test.

## What the next brief needs

- **Model and cost:** `google/gemini-2.5-flash`, fallback `anthropic/claude-sonnet-4.6`. The cost per screenshot was not read. It is in the server log (`screenshots: … cost $…`, from OpenRouter's `usage` block), and Fly's log was out of reach from the cloud session. An estimate at Flash's list price: ~1,300 input tokens and ~300–500 output tokens per phone screenshot, about $0.002 or less per picture. The next session reads one real line from `flyctl logs` to replace the estimate.
- **Share target:** it did not appear after a manual install from Chrome's menu. Two things to check first:
  1. whether Chrome made a real installed app (a WebAPK: it shows in Android's app list and app settings) or only a home-screen shortcut, since only a WebAPK registers share targets;
  2. whether Chrome has re-read the manifest since it changed from GET to POST. Chrome refreshes an installed app's manifest in the background, which can take a day; uninstall and reinstall forces it.

  Whether it could carry an image is unproven.
- **What the TV-photo path can reuse:** `readPictures` (picture in, timed lines out) and its checks and merge. Its prompt and its check that every line has a time are transcript-specific. A TV photo has no times, so that path needs its own prompt and a no-time variant of the check (`checkPictureLine`), not a change to this one.
- **Fixtures:** the four synthetic pictures and `answers.json` in `test/fixtures/pictures/`. The mock OpenRouter knows pictures by their bytes (sha256).

## Asks for the origin chat

1. **Should the next session diagnose the missing Share entry before the TV-photo path?** Recommended: yes, as a short first step. Uninstall and reinstall from Chrome's menu, confirm it lands in Android's app list, and if the entry is still missing, read Chrome's `chrome://webapks` page on the phone.
2. **[DAN GATE] May Dan's real screenshots of the transcript be committed to the repo as test fixtures?** They are pictures of a public video's transcript, but they are his screenshots, and the safety check wants his explicit yes. Recommended: yes. Say so in the next brief, and have the session commit only the transcript picture, cropped of any status-bar details.
3. **Should the per-screenshot counts be kept in the database so they survive leaving the page?** Recommended: no. Three lines plus "17 lines in all" is enough to see whether the read was right, and the counts matter only at the moment of sending.
