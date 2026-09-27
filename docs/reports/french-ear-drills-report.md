# FIELD REPORT — french-ear-drills — 27 Sep 2026

Session french-ear-drills (cloud; `flyctl` not present). Built and published 26 Sep; live round with Dan on 27 Sep, after the passphrase session's fix.

## What stands

**Proven live by Dan (27 Sep, on his phone):**
- Practice is in the top bar. Mix reads **5 clips**, and several patterns show clips; the rest read "no clips yet — watch more videos".
- A round on "question by tone alone" (1 clip, from the Easy French video): "hear it" played the right few seconds and stopped by itself; "play again" replayed them; the three choices were real lines; he picked the right one; the end screen read "1 clip, 1 knew it, 0 got past me".
- Your patterns, "question by tone alone": "1 got past me · knew it in 1 drill line · 1 looked at". A right drill answer is recorded and shown.

**Checked against mocks and the stand-in player only:**
- A wrong answer turning a pattern shaky, and the end screen listing the misses with a link to the line (not exercised live: Dan answered right).
- Mix's second question, "Which pattern?".
- Rounds of more than one clip, the ten-clip cap, no repeats, the skip when there are too few lines for wrong choices.
- `npm test` 90 at merge (80 before); the browser run passes; screens in `docs/screenshots/` (`practice-home-*`, `drill-hidden-*`, `drill-right-*`, `drill-wrong-*`, `drill-end-*`, `drill-mix-phone-light`).

**Built** (isleofdan/french-ear#9, merged 26 Sep, publish run 11 green):
- `db.clips` / `db.clipCounts`: a clip is a worked-out line of one of his YouTube videos with a start and end time. Typed lines, photos from the TV and untimed pastes have none.
- `lib/drills.js`: a round is up to ten clips, shuffled, never the same clip or the same words twice. Mix draws clips with a shaky pattern three times as often. Wrong choices for "What was said?" are two of his own lines of about the same length (no model call).
- `public/practice.js`: the drills home, a round, the end screen with "again".
- The tally, in `lib/tally.js` only: a right answer records `drill_clean`, a wrong one `got_past_me`, per pattern in the line; solid is five clean Ear-first lines or ten drill lines, with no "got past me" in the last 200 events; "Which pattern?" records nothing. `docs/DESIGN.md` says so.

## What the brief got wrong
- **"With the line hidden" cannot hold for Easy French.** The channel burns its own subtitles into the picture (French, with English under it): Dan's screenshot of the paused clip shows "Est-ce que vous êtes… / Parfaitement heureux". The CC setting cannot remove them. The page hides the line; the video shows it. Any channel with burned-in subtitles has the same problem.
- **The gate on session five.** The brief was to run only after session five filed its report. Five merged its app work (isleofdan/french-ear#8) without any close-out. This session stopped at the gate (26 Sep); Dan said go the same day.
- **Clip counts "the ones the Easy French video contains".** Only lines with times are clips, and only lines the "as said" pass tagged with a pattern. Mix is 5 clips from what he has watched so far, not a clip per sentence.

## Deliberate divergences — DO NOT REVERSE
- **Mix's "Which pattern?" offers one of the line's own patterns among four**, not all of them. With all of them, a line with three patterns gave three right answers out of four.
- **In Mix, the pattern names wait until "Which pattern?" is answered.** Naming them in the reveal after "What was said?" would give that answer away.
- **The first clip of a round waits for a tap on "hear it".** Phones block sound until a tap; later clips play by themselves when he taps "next".
- **A clip stops only within three seconds after its end.** Just after a different video loads, the player's clock can still read the old video's time.
- **Wrong choices are lines within 40% of the real one's length when there are two**, else the two nearest.
- **No "What was said?" question when there are too few lines** (fewer than two others): "show the line" instead, and nothing is recorded.
- **On a phone the top bar's links are a little smaller** so all five fit on one row with Practice added.

## Dan's decisions this session
- 26 Sep: run the drills without session five's report ("yes").
- 26 Sep: merge and publish the drills ("yes").
- Error analysis requested on a padding item in the chat ("2. Nothing else."). See below.
- 27 Sep: ran the three live checks above.

## Error analysis (Dan's request, 26 Sep)
- **What happened:** after one real question under NEEDED FROM YOU, the session added "2. Nothing else." and a pointer to the report. Dan: "I've already told you to cut out that performative horse shit."
- **Root cause:** process compliance. The same construction was banned on 2 Sep (Taste `uwuey0wocfl1h9e7kyev`), but that fix lived only in a Claude.ai project memory, which Claude Code sessions do not load. The global rule "if nothing is needed, say so in one line" was then folded into the list as an item.
- **Context fatigue:** not a factor (first reply of the session).
- **Prevention:** a "No empty items" rule with a per-item test ("does Dan do or decide something here?") added to the global `CLAUDE.md` in `isleofdan/claude-config` (commit `7c89e54`), which every Claude Code session loads.
- **Persisted:** new instance appended to Taste `uwuey0wocfl1h9e7kyev`; deployment record `5paeswbbc2ocd3xaza8j`.

## What the next brief needs
- **Clip counts so far:** Mix 5 clips; "question by tone alone" 1. Every video he watches with a timed transcript adds a clip for each of its lines that carries a pattern. A 9-minute Easy French video, pasted whole with timings, gives roughly 60–120 sentences, most with at least one pattern. So one or two more videos would give most patterns enough clips for a ten-clip round.
- **The burned-in subtitles:** a band over the lower part of the player during "hear it" and "What was said?", lifted after he answers, and toggleable if a channel has none. Small, one file (`public/practice.js`) plus CSS.
- **Still open from session five** (laptop only): Dan's real screenshots as test pictures, the cost line from the Fly log, the Share diagnosis.

## Asks
1. Cover the bottom of the player during a drill so burned-in subtitles don't give the answer away? **Recommended: yes**, as the next small session.
2. Session five's three laptop-only items: a laptop session of their own, or drop them? **Recommended:** keep them, as one laptop session after the subtitle band.
