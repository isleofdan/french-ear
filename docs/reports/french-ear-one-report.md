# FIELD REPORT — french-ear-one — 24 Sep 2026

Session: french-ear-one (cloud). Surface: cloud (`flyctl version` failed, as expected). Card: `french-ear`. Origin: Personal Shipyard.

## What stands

**Proven live by Dan**
- https://french-ear-dan.fly.dev is up. The deploy workflow's first run was green: 26 checks, app `french-ear-dan` created in `personal`, volume `ear_data` (1 GB, nrt), secrets staged, deploy, then a live check (`/health` configured, `/api/home` answers 401 without the cookie).
- All three repository secrets existed. The workflow's secrets step passed. The session itself could not list them (no `gh`).
- Live check 1 passed: Dan signed in with the passphrase and saw the home page with the link box, the typed-line box, the three counts (0 / 0 / 20) and "No videos yet". Dark mode, real fonts.
- **Live check 2 failed at the caption text; the test stopped there, as the brief says.** Pasting `https://www.youtube.com/watch?v=flS3MVNXWbw` gave, word for word:
  > YouTube listed a French track but gave no text for it (xml: 429, 1103 characters ("<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>"); json3: 429, 1103 characters ("<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>")).
  - What this shows: from Fly's Tokyo machine, the watch page and the player call both worked, and a French track was listed and chosen. The caption-text address answered **HTTP 429** (an HTML "too many requests" page) in both formats. This is YouTube's usual refusal of data-center servers at the caption-text step.
  - Nothing was saved, by design, since there were no lines to save.
- Live checks 3 and 4 (tap a tinted line; Ear first → "What was that?" → shaky) were **not run live**.

**Checked against mocks only** (26 unit and server checks, plus 33 browser checks on phone 412×915 and computer 1280×800, light and dark; screenshots in `docs/screenshots/`)
- **Link parser:** `watch?v=`, `youtu.be/`, `shorts/`, `m.`, timestamps, and a link inside shared text.
- **Caption fetch:** a French track by hand preferred over auto-generated. Auto-only is used. English-only gives "This video has no French captions I can read" and saves nothing. A bot-refusal is reported as what came back. XML, srv3 and json3 are all read.
- **"As said" pass:**
  - A good batch works.
  - A bad pattern id, or offsets out of range, leaves that line "unworked" with its reason while the rest are saved.
  - A cut-off answer keeps the whole lines that arrived.
  - When the first model fails, the fallback model answers.
  - "Try again" reruns only the unworked lines.
  - The false-rejection case (accents, typographic apostrophes, miscounted offsets) is accepted. That test caught a real bug, now fixed.
- **Tally rule:** 6 clean Ear-first lines make a pattern solid; a keep makes it shaky; never seen is not met yet. Old events drop out after 200.
- **Watch page (with a stand-in YouTube player):**
  - The current line follows the clock.
  - A tapped line flips to the written text and names its patterns.
  - Keep works.
  - Ear first hides the lines. "What was that?" shows two lines and makes their patterns shaky. Lines played through count as heard clean.
  - The mode is remembered.
  - Kept → watch at that line.
  - The typed line records nothing to the tally.
  - Tint contrast is ≥ 6.3:1.
- **Gate:** fails closed when unset; 401 without the cookie; login returns to the page asked for, never off-site. The share target lands the link in the box. The manifest validates.

## What the brief got wrong

1. **"On his word, fast-forward main and push" did not work.** The session's automatic safety check refused `git push origin …:main` as a production deploy, even with Dan's explicit "push to main" in the chat. Dan created `main` himself on GitHub (Branches → New branch). Next briefs must not assume a session can push `main` in the cloud.
2. **In an empty repo, the first branch pushed becomes the default branch.** `claude/eloquent-hopper-727dun` is still the default of `isleofdan/french-ear`. Deploys are unaffected (the workflow triggers on push to `main`), but the default should be `main`.
3. **The caption risk sat in a different place than the brief framed it.** It expected YouTube might refuse "requests from the server". The listing and the video details came through; only the caption *text* was refused (429).
4. **Minor:** the brief asks the report to say which caption tracks the test video had. The failure message names the chosen track's failure but not the list, and this session cannot read Fly's logs. **Unknown**, beyond "at least one French track".

## Deliberate divergences — DO NOT REVERSE

- **Span text is trusted over span offsets.** The model is asked for start, end *and* the text. When the offsets miscount, the span is moved to where the text actually occurs. Without this, correct answers are refused.
- **`patterns` is the union of the listed ids and the spans' ids.** An id listed without a span is kept (valid ids only). An unknown id anywhere still refuses the line.
- **"Watched clean" timing.** An Ear-first line counts as heard clean once it has played through and is older than the last two lines (the ones "What was that?" could still show), or when he leaves the page or switches to Follow along.
- **"Last 200 events" means 200 event rows** (one per pattern per line), not 200 lines.
- **Secrets are set only if missing** (the hebrew-reader pattern). Changing the passphrase later needs `flyctl secrets set APP_PASSWORD=… --app french-ear-dan`, not just a new repository secret.
- **The service worker leaves other sites' requests alone** (YouTube's player, fonts). It exists only so Android offers Install and with it the Share target.
- **Fallback model is `google/gemini-2.5-flash`** (first model `anthropic/claude-sonnet-4.6`), named in the README.
- **A video whose captions cannot be fetched is not saved at all,** since it has no written lines. Save-and-warn applies from the moment lines exist.

## Dan's decisions this session

- Gave the word "push to main". When the safety check blocked it, he created `main` on GitHub himself.
- Said, in his words: "We should be able to create a different set of instructions by which I can indeed give you the authority to just fucking do it". He wants a standing way to authorize pushes to `main`. In this cloud window, `/permissions` opens only the Mode menu (Auto, Accept edits, Plan), with no Allow tab, so it could not be granted here.

## What the next brief needs to contain

- **The caption decision** from the asks below, and which path session two builds.
- If link-only remains the goal, a way past the 429 that does not run from a data-center address, or one that is paid for (see the asks).
- A check that names the full track list in the failure message (a one-line change in `lib/youtube.js`, `fetchVideo`: include `names` in the "gave no text" error).
- How `main` gets pushed: either Dan creates or merges it on GitHub as a named step, or a standing permission exists first (ask 3).
- The live checks 3 and 4, still owed, to run once lines arrive.

## Asks for Personal Shipyard

1. **How should lines get in when YouTube refuses the caption text from the server?**
   **Recommended: build a "paste the transcript" path next.** On a laptop, YouTube's own "Show transcript" panel can be copied with its timestamps. The app would read that paste as the video's lines, keep the player, and everything else works unchanged. It is free and does not depend on YouTube's goodwill. Alternatives:
   - (b) a paid transcript service called from the server **[DAN GATE — money]**;
   - (c) a residential proxy **[DAN GATE — money]**;
   - (d) fetching in his browser — not possible, since YouTube's caption address does not allow other sites to read it.
2. **Retry the same link once later, to see whether the 429 is lasting?** Recommended: yes, as the first thing session two does. It costs one paste, and the answer decides whether option (a) is the main path or the fallback.
3. **Standing authority for sessions to push `main` (which deploys).** **[DAN GATE — widens what sessions do unasked]** Recommended: yes, as an allow rule `Bash(git push origin *:main)` in the permission settings every session loads. The cloud window's `/permissions` has no Allow tab, so it needs setting where cloud sessions read settings from; the chat should pick where and write the one step for Dan.
4. **Make `main` the repository's default branch.** Recommended: yes. Dan does it once (GitHub → Settings → Default branch); the next session can then delete `claude/eloquent-hopper-727dun`.
