# FIELD REPORT — french-ear-three — 24 Sep 2026

**For Dan:** this report and the PLAN note are in their own pull request, PR_LINK. Tap **Merge pull request**, then **Confirm merge**. It holds documents only. The app's changes are already live: isleofdan/french-ear#4 was merged and deployed green.

Session: french-ear-three (cloud). Surface: cloud (`flyctl version` failed, as expected). Card: `french-ear`. Origin: Personal Shipyard.

## What stands

**Proven live by Dan** (https://french-ear-dan.fly.dev, 24 Sep 2026)
- **Saved videos are now sentences.** The Easy French video (`flS3MVNXWbw`) was saved as caption fragments in session two. The server joined its lines when it restarted. Its first line now reads "Bonjour les amis et bienvenue dans un nouvel épisode d'iz French.", and the tinted parts came back after the "as said" pass reran.
- **Pasting again replaces the lines.** Dan did a fresh Ctrl+A copy of the YouTube page and pasted it through "Paste the transcript again" on the saved video. "Here's how I read your paste" showed the same three opening sentences. Home lists the video once, not twice.
- **The YouTube app will not copy its transcript.** On Dan's phone the app has **Show transcript** under the expanded description. A long-press on a line selects nothing; the video jumps to that moment instead.
- **Phone wording shows on the phone.** French ear's paste help on his phone reads "On a phone or tablet, open the video in the YouTube app…".
- **Deploy.** Run 5 (pull request 4) was green first time.

**Checked against mocks only** (49 unit and server checks, 9 of them new; 41 browser checks; screenshots on phone 412×915 and computer 1280×800, light and dark, in `docs/screenshots/`)
- The five joining cases from the brief:
  - a run that ends on `?` after two fragments;
  - a run that hits the 4-fragment cap;
  - a run that hits the 12-second cap;
  - a paste with no times;
  - the real whole-page copy, which makes 17 fragments into 16 lines.
- Lines that are already sentences come back unchanged, so session one's mock checks pass untouched.
- A kept line whose text is still there stays kept on the new line. One whose text is gone is kept anyway and shows "from an earlier paste" on the kept page.
- A video saved before this change is joined when the server starts.
- The paste help shows the laptop wording on a computer and the phone wording on a phone, at both sizes.

## What the brief got wrong

1. **The joining rule could not give its own expected line.** The brief said to join fragments "until a fragment ends in `.`, `?` or `!`". In the real transcript, sentences end *inside* fragments: "nouvel épisode d'iz French. Aujourd'hui,". Under that rule the first line would have run on into "Aujourd'hui, nous allons…". The app now cuts a fragment where a sentence ends inside it (see divergences).
2. **Step 1 was refused at the first step,** a third outcome the brief did not list as (a) or (b). The safety check would not let the session *write* `.claude/settings.json`: it called writing Claude's own permission rules "self-modification". So the file was never committed, and the push to `main` was never tried. After that refusal the same check also blocked running the app's code (tests, screenshots) for a while, until Dan said in the chat: "Yes — run the test suite and the screenshot script."
3. **Deleting `claude/eloquent-hopper-727dun` was refused again** ("Git Destructive"), as in session two. `main` does contain every commit of it (checked: `git log origin/main..origin/claude/eloquent-hopper-727dun` is empty). It is left in place and does no harm.
4. **"Lines are now whole sentences" on the saved video** needed more than step 2 described. Joining only new pastes would have left the saved video as fragments. The server now joins videos saved earlier when it starts (see divergences).

## Deliberate divergences — DO NOT REVERSE

- **Fragments are cut where a sentence ends inside them.**
  - Each piece takes its share of the fragment's time by its length in characters. The first line of the real copy runs 0:00 to 4.8 s, and the next starts at 4.8 s.
  - Pieces then join until one ends a sentence, or the line reaches 4 pieces, or 12 seconds from its start to the piece's end.
  - This is the only way the brief's expected first line comes out.
- **A sound in brackets ("[Musique]", "[Applaudissements]") is a line of its own.** Otherwise it would be glued onto speech and sent through the "as said" pass.
- **Videos saved before joining are joined when the server starts.**
  - A new column, `videos.joined`, marks the ones already done, so this runs once.
  - Their lines go back through the "as said" pass. The tally events already recorded are kept.
- **Kept lines survive a new paste.**
  - A kept line moves to the new line with the same text, else to the new line that *contains* its text. That second case is how a kept fragment lands on its sentence.
  - One that matches no new line goes to a new table, `kept_earlier`, with its text and "as said" result. It shows "from an earlier paste" and opens the video at the top.
- **Session two's "pasting for a saved video returns the saved video" is reversed,** by Dan's decision (ask 4, 24 Sep). A paste now replaces the lines.
- **Phone wording shows on screens under 900 pixels wide, or on any touch screen with no mouse.** That covers tablets held sideways, which are wider than a phone.
- **The "as said" runner loops** until no pending lines are left (at most 5 rounds). Without it, a re-paste made while the pass was still running would leave its new lines unworked. The pass itself, its checks and the tally are unchanged.

## Dan's decisions this session

- Told the session "Yes — run the test suite and the screenshot script" after the safety check had blocked them.
- Merged pull request 4 (the app's changes).
- Ran the three live checks and reported the results above.

## What the next brief needs to contain

- **Permissions test, stated first: outcome (c).**
  - The cloud safety check refuses to let a session write `.claude/settings.json` at all, calling it self-modification.
  - Publishing stays with Dan: the session opens the pull request and Dan taps Merge.
  - If the chat still wants to try the settings file, Dan has to add it himself, for example on GitHub's website. Then the next session tries `git push origin HEAD:main` as its first act, to see whether a file already in the repo is honored at start. That test is untried (ask 1).
- **Phone copy result: copy does not work in the YouTube app.** Show transcript exists, but a long-press only jumps the video to that moment.
  - So on a phone or tablet the route in is a **screenshot of the transcript**. That shares machinery with the photo-of-the-TV path (reading text from an image).
  - Until that is built, French ear's phone wording tells his father to send the screenshot to Dan.
- **Unknown still:** whether a tablet's browser (not the app), in desktop-site mode, allows the laptop copy. Nobody has tried it.
- The real transcript makes 17 fragments into 16 sentences. The fixture test pins this.
- `claude/eloquent-hopper-727dun` is still there. Only Dan, or GitHub's website, can delete it.

## Asks for Personal Shipyard

1. **Does the settings file get another try, with Dan adding it himself? [DAN GATE — widens what sessions do unasked]**
   - Recommended: **no, keep the Merge tap.** It costs Dan one tap per session, and the safety check has now refused this route twice in two forms.
   - If yes: Dan creates `.claude/settings.json` on GitHub's website with the two allow rules, and the next session tests a push to `main` first thing.
2. **Build the screenshot-of-the-transcript path next, so the phone and tablet can bring lines in without a laptop?**
   - Recommended: **yes, as the next session's main task.** His father watches on all three, and copying is proven impossible in the app. It also lays the ground for the photo-of-the-TV path.
   - It would mean reading text from an image with a vision model through OpenRouter, the same account the "as said" pass uses. [DAN GATE — spend: a small cost per screenshot]
3. **Delete the leftover branch `claude/eloquent-hopper-727dun` by hand?**
   - Recommended: **leave it.** It is harmless, and two sessions have been refused.
   - Dan can delete it in a minute on GitHub's Branches page if he wants it gone.
