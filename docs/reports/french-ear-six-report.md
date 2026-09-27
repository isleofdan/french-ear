# FIELD REPORT — french-ear-six — 27 Sep 2026

Session french-ear-six, run in a cloud session (`flyctl` not present). The brief came from the note filed on card `french-ear` on 27 Sep. Three pull requests, all merged by the session after Dan's yes, all publish runs green: isleofdan/french-ear#11 (run 13), #12 (run 14), #13 (run 15).

## What stands

**Proven live by Dan (27 Sep, on his phone):**
- **The band.** In Practice → Mix, while the clip played, the bottom of the video was covered by the band ("covered until you answer") and the burned-in subtitle could not be read. After he answered, the band lifted.
- **The link read works on a real video.** "Paris Street Style Explained by Locals | Easy French 258" (C2nA_FSX97M, published May 2026) was read from its link alone. The result: 135 lines, timed, opening "Bonjour les amis et bienvenue dans un nouvel épisode d'Easy French." (0:00), then "Aujourd'hui, nous allons demander aux passants s'il existe un style vestimentaire parisien et si oui, quels en sont les codes ?" (0:05), then "C'est parti !" (0:14). The lines are specific to that episode. It was published after Gemini 2.5 Flash's training, so they were heard, not recalled. All 135 lines were then worked out by the "as said" pass.
- **Mix: 63 clips** (5 before this session).
- **The invented video is gone** from "Last videos" after #13's startup clean-up.
- Also seen on Dan's home page: "Indignation en Espagne après l'expulsion d'une femme de 87 ans de son appartement | TF1 INFO", 27 lines, added today. Its lines show a second successful read from a link alone; this session did not add it.

**Found live and fixed:**
- **Gemini invents lines for a dead link.** The brief's check link (Zq2KsoD8vJI) is a video YouTube no longer has ("Video unavailable" in the player). Gemini still returned 24 tidy, timed lines about France ("Aujourd'hui, on va parler de la France.", "La France est un pays d'Europe de l'Ouest.", …). Every line check passed them. Fixed in #13: YouTube is asked first, and a video it reports as unavailable (playability status ERROR) is refused before Gemini is called. At start, a link-read video whose title was never found and which YouTube now reports unavailable is removed, with its lines and tally events.
- **The phone will not start the video from the page before the video itself is tapped once.** On Dan's phone, "hear it" did nothing until he tapped YouTube's red play button (the band was ruled out: it failed with the band off too). This is not new with this session. Fixed in #12 with a note: when a clip asked to play has not started after 1.5 s, the page says "Tap the video once to start it."

**Checked against mocks only:**
- A refusal on screen ("Gemini couldn't read this video: …") coming from OpenRouter, from Gemini (no French heard) or from the app's checks; a bad line dropped; fewer than three good lines refused; "Read the video again" replacing a saved video's lines with kept lines kept; the "Reading the video…" screen with the screenshots and paste box under it; the "cover the picture" switch remembered.
- `npm test`: 103 (92 before). Browser run green, with screens in `docs/screenshots/`: `drill-hidden-*` (with the band), `watch-reading-*`, `watch-read-refused-*` (phone and computer, light and dark), `drill-tap-hint-phone-light`.

**Not read:**
- **The cost per video.** The server logs `link-read: <id>: … cost $…` for every read, but that line lives in the Fly log. This cloud session has no `flyctl` and cannot reach Fly. The README says the cost is read from the log; nobody has read it yet.
- **The provider routing field**, `provider: { only: ["google-ai-studio"], allow_fallbacks: false }`, is documented but unverified: openrouter.ai is blocked from the sandbox. The live read succeeded, so OpenRouter accepted the request and served it from a provider that takes YouTube links. It is not proven that the field did the pinning rather than OpenRouter's default routing.

## What the brief got wrong

- **The check link is a dead video.** Zq2KsoD8vJI answers "Video unavailable". The brief allowed "any public Easy French episode will do if that one is gone — Dan picks one". Dan is not a French speaker or student and should not have been asked to pick one. The session should have found one (it did, after he said so).
- **"If instead the page says Gemini couldn't read it"** assumed a dead link would be refused. It is not: Gemini answers a dead link with invented content, and the brief's checks (times parse, never backwards, text non-empty, at least three lines) cannot tell invented lines from real ones. The guard had to come from outside the model's answer: asking YouTube whether the video exists.
- **The live checks assume Dan can judge the French.** "Whole sentences with times that follow the video" and "how Gemini spelled what it heard" both need a French listener. Dan is not one (27 Sep: "I'm not a French speaker or student"). Proof here rests on the lines being specific to a post-training episode, not on anyone comparing them by ear.
- **"The band never covers the player's controls"** cannot hold together with "the burned-in subtitle cannot be read" on Easy French. The English subtitle is the lowest line in the picture, in the strip where YouTube's controls sit (see divergences).
- **The drills and passphrase reports are not on `main`.** They live on branch `claude/sleepy-galileo-yhcudt` only. The brief's reading list names them as if they were in the repository.

## Deliberate divergences — DO NOT REVERSE

- **The band runs to the player's bottom edge, over YouTube's control strip.** The English subtitle sits lowest; leaving the strip uncovered would show it. Taps pass through the band to the player (tap to pause; on a phone the play button sits mid-picture, above the band). Proven live.
- **YouTube is asked whether the video exists before Gemini is called.** Without it, a dead link becomes a video of invented lines, and those lines feed the tally and Practice.
- **A missing `end` does not drop a line.** It is filled from the next line's start. A line with a start but no end is a right answer with an imperfect label; dropping it would be a false rejection. An end before the start still drops the line.
- **Times also read as `m:ss.s` or a plain number of seconds**, for the same reason.
- **The read runs in the background** (answered 202, the video's page asks every three seconds). A read can take minutes, longer than a phone keeps a request open.
- **"Read the video again" and "Try YouTube again" both stay** on the page with no lines: one retries Gemini, the other YouTube's captions, which the brief said to keep.
- **No fallback model for the link read.** Only Gemini on Google AI Studio accepts YouTube links; a second model could only invent.

## Dan's decisions this session

- 27 Sep: merge and publish the band ("Y"), the link read ("Y"), the dead-link guard ("Y").
- 27 Sep: ran the live checks above.
- 27 Sep: **"Error analysis later."** An error analysis of asking him to find a video himself, after he said "Fuck you. You give me a video", is Dan's to call up. He deferred it; it has not been run.

## What the next brief needs

1. **The live outcome of the link read:** it works on real videos (Easy French 258, 135 lines; a TF1 INFO report, 27 lines). A dead link produced invented lines until the #13 guard, which is now live. The guard has not been tried live on a dead link since.
2. **The real cost per video is unknown.** It is in the Fly log as `link-read: … cost $…`. A laptop session (with `flyctl logs --app french-ear-dan`) can read it. The estimate at Flash list prices for a ten-minute video (~158k input tokens of video, ~4k out) is about $0.06. That figure is a guess, not a measurement.
3. **How Gemini spelled what it heard:** ordinary written French in every line seen ("nous allons", "s'il existe", "d'Easy French"). No reduced forms were seen. Nobody who can hear French has compared the lines with the audio, so it is not known whether "nous allons" is what the speaker said or Gemini normalizing "on va". If it normalizes, the "as written" side stays standard as the app intends, but a line where the speaker really said "on va" would show "nous allons" as written, and the "as said" pass could name "on for nous" wrongly. Checking needs a French listener, not Dan.
4. **The first-tap rule for phones:** the page cannot start YouTube's player until the video has been tapped once per page load. The note covers it; a brief touching Practice should not assume "hear it" works on the first tap.
5. Session five's laptop items are still open (real screenshots as test pictures, the screenshot cost line, the Share diagnosis). A laptop session can read the link-read cost line at the same time.

## Asks

1. **Have a French listener compare a few link-read lines with the audio** (the Paris episode, first minute) to settle item 3? **Recommended: yes**, as one small task for someone who speaks French. No code needed; the result decides whether the "as written" side needs a rule for Gemini's normalizing.
2. **Fold "read the link-read cost from the Fly log" into the laptop session with session five's items?** **Recommended: yes.** It is one command on the laptop, and the README's cost line stays empty until then.
3. **Run the error analysis Dan deferred** (a session asking Dan, a non-French-speaker, to pick a French video when it could have found one)? **Recommended: yes, when Dan calls it up.** It is his decision, recorded here so the deferral stays visible.
