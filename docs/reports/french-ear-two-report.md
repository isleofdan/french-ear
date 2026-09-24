# FIELD REPORT — french-ear-two — 24 Sep 2026

**For Dan:** this report is in its own pull request, https://github.com/isleofdan/french-ear/pull/3. Tap **Merge pull request**, then **Confirm merge**. The session already opened it, so there is no "Create pull request" tap. The app's own changes are already live: pull requests isleofdan/french-ear#1 and isleofdan/french-ear#2 were merged and deployed.

Session: french-ear-two (cloud). Surface: cloud (`flyctl version` failed, as expected). Card: `french-ear`. Origin: Personal Shipyard.

## What stands

**Proven live by Dan** (https://french-ear-dan.fly.dev, 24 Sep 2026)
- **The failure names the tracks.** With the link `flS3MVNXWbw` and no paste, the page said "YouTube wouldn't give me the captions…" and gave YouTube's answer word for word: 429 for both xml and json3, 1,103 characters, ending "Captions the video offers: Français (générés automatiquement)." So the test video has **one track, French auto-generated**. The paste box sat right under it.
- **"Try YouTube again" got the same 429,** hours after session one's. The refusal is lasting, and the paste is the main way in.
- **A real paste is read correctly.** Dan copied the whole YouTube page with Ctrl+A and pasted it. "Here's how I read your paste" showed:
  - `0:00 Bonjour les amis et bienvenue dans un`
  - `0:02 nouvel épisode d'iz French. Aujourd'hui,`
  - `0:06 nous allons simplement demander aux`

  These are the video's opening lines.
- **Lines came in tinted.** A tapped line showed "Est-ce que vous êtes heureux ?" → "Vous êtes heureux ?", naming **question by tone alone** with its explanation.
- **Ear first works.** "What was that?" at about 0:10 showed the last two lines. Neither had a pattern, so nothing was counted. At 0:19 it caught the "Vous êtes heureux ?" line, and the patterns page then listed **question by tone alone under Shaky**.
- These close session one's owed live checks 3 and 4.
- **Deploys.** Run 2 (pull request 1) was green. Run 3 (pull request 2) died at the step that downloads Fly's tool (`read ECONNRESET`), after all 40 checks had passed. One re-run was green, including the live-answer check.

**Checked against mocks only** (40 unit and server checks, 49 browser checks; screenshots on phone 412×915 and computer 1280×800, light and dark, in `docs/screenshots/`)
- **Paste shapes.** The four shapes the brief lists each give the expected lines and times:
  - a time on its own line, then the text;
  - time and text on one line;
  - `h:mm:ss` times;
  - no times at all.
- **Other paste details.** Text wrapped over several lines is joined. Screen-reader length labels ("5 seconds") are dropped. A time of day inside a sentence ("10:30") is not taken for a timestamp.
- **Paste with no times.** The lines are saved with no times. The page says "No timings in this transcript — lines won't follow the video". Nothing follows the clock, and Ear first is not offered.
- **Paste on the video's page.** Pasting on the failed-fetch page saves the video, and the "as said" pass runs on the pasted lines.
- **Title fallback.** When YouTube gives no details, the link stands in as the title.
- **"Try YouTube again"** saves the video when the captions come through, and says what came back when they don't.
- **An empty paste** is refused in plain words.

## What the brief got wrong

1. **"Select all the text in that panel" doesn't work.** On YouTube's page, Ctrl+A selects the whole page, not the transcript panel. Dan hit this live.
   - The app now takes the whole page and picks out the transcript.
   - The on-screen wording now says "…tap Show transcript, then press Ctrl+A and Ctrl+C to copy the whole page, and paste it here. I'll pick the transcript out of it."
2. **"Dan taps Create pull request and Merge."** The session opens the pull request itself with the GitHub tool, so Dan only taps Merge.
3. **"`main` holds everything session one built" was not quite true.** It lacked session one's close-out commit (the PLAN note and `docs/reports/french-ear-one-report.md`). This session carried it in through pull request 1.
4. **The tidy step could not finish.** After pull request 1, `main` contains every commit of `claude/eloquent-hopper-727dun`. Deleting that branch, and even the fetch run alongside the delete, was refused by the session's safety check ("Git Destructive"). The branch is left in place, and it is harmless.
5. **Two parts of the brief pulled against each other.** It asked for a "video page with no lines" where the paste box and "Try YouTube again" live, while session one's DO-NOT-REVERSE rule says a video without lines is not saved. The fix is the second divergence below.

## Deliberate divergences — DO NOT REVERSE

- **Picking the transcript out of a whole-page paste.**
  - The page carries other times: each suggested video's length, followed by "New", the title, the channel, the views and the age.
  - So the transcript is the **longest run** of timed entries whose times never go backwards and whose text is at most **3 lines** (`MAX_WRAP`).
  - An entry with more text lines ends its run and keeps only its first line. That stops the page's "All / From Easy French / Related…" from being glued onto the last line, "[Musique]".
  - A paste of the panel alone reads as before.
- **A failed fetch still saves nothing.**
  - It lands on `/watch?yt=<id>`, which shows the player, the failure, the paste box and "Try YouTube again".
  - The failure text is kept in memory only. After a restart, the page gives general wording instead of YouTube's exact answer.
- **Untimed pastes hide Ear first.** It needs times to know which lines were just said. They also keep his remembered mode unchanged.
- **Pasting for a video that's already saved returns the saved video.** It does not replace the lines, so a bad parse can't be fixed by pasting again (see ask 4).
- **The title on the paste path comes from YouTube's player details, else the link.** oEmbed is not tried there.
- **The browser checks let one expected 502 through.** The app answers 502 when YouTube refuses, and the browser logs that as an error. Every other console error still fails the run.

## Dan's decisions this session

- Merged pull requests 1 and 2 himself. The 502 fix-up re-run was the session's.
- Asked why this is the first app where he has to tap Merge. The answer given:
  - This app publishes whenever code lands on `main` (GitHub's deploy workflow), so getting code onto `main` is the publish step.
  - The standing permission from 4 September lives only on the laptop. This cloud session loads no permission rules at all.
  - Its safety check refused both pushing `main` (session one) and deleting a branch (this session).
  - The session cannot see his other apps' repos, so it could not confirm how they reached production from the cloud. The chat may know.

## What the next brief needs to contain

- **The real shape of YouTube's copy.** Ctrl+A copies the whole page. Inside it the transcript appears as:
  - a `m:ss` line, then the words on the next line;
  - after "NoteGPT / Transcript / Search in video" (NoteGPT is probably a browser extension on Dan's laptop — unverified);
  - followed by "All / From Easy French / Podcasts / Related / For you / Recently uploaded / Watched" and the suggested videos.

  A shortened copy, without commenters' names, is `test/fixtures/youtube-page-copy.txt`.
- **Transcript lines are caption fragments, cut mid-sentence** ("Bonjour les amis et bienvenue dans un" / "nouvel épisode d'iz French"). The "as said" pass sees one fragment at a time, so a pattern split across two fragments is missed. Auto-generated text also has errors ("d'iz French" for "d'Easy French", "queon", "sans lot"). See ask 1.
- **The paste needs a computer.** Ctrl+A and the "Show transcript" panel are laptop steps. Nobody has checked whether his father watches on a laptop, a tablet or a phone (see ask 5).
- **The standing authority for cloud sessions to put code on `main`,** if Dan grants it (ask 2).

## Asks for Personal Shipyard

1. **Join caption fragments into whole sentences before the "as said" pass?**
   - Recommended: **yes**, next session.
   - Join fragments until one ends in `.`, `?` or `!` (with a cap, say 4 fragments or 12 seconds). The joined line keeps the first fragment's start and the last one's end.
   - This applies to pasted and fetched lines alike, and nothing else changes.
2. **Standing authority for cloud sessions to put code on `main` (which publishes) and delete merged branches? [DAN GATE — widens what sessions do unasked]**
   - Recommended: **yes, tried as a settings file inside the repo**: `.claude/settings.json` with allow rules `Bash(git push origin *:main)` and `Bash(git push origin --delete claude/*)`. Dan's one Merge adds it.
   - **Untested:** whether the cloud safety check honors a repo settings file. The next session tries it on its first change and reports.
   - The fallback is today's rule: the session opens the pull request, and Dan taps Merge.
3. **Delete `claude/eloquent-hopper-727dun`?** Recommended: leave it for the next session to try under ask 2. It is harmless.
4. **Let a new paste replace a saved video's lines?** Recommended: **yes**, small. Today a bad parse can't be fixed by pasting again.
5. **How does his father watch: laptop, tablet or phone?**
   - Recommended: **Dan confirms.**
   - If not on a laptop, the next session needs a phone path for the transcript. That path is not checked yet, and the YouTube app's copy may not exist.
