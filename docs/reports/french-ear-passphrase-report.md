# FIELD REPORT — french-ear-passphrase — 27 Sep 2026

## What stands
- **Live, checked by Dan (27 Sep):** he opened https://french-ear-dan.fly.dev, signed in with the passphrase now saved in GitHub, and the app opened.
- **Deploy** (isleofdan/french-ear#10, merged by the session on Dan's yes; publish run 12 green). The new step "Set the passphrase from the repository secret" copies `APP_PASSWORD` from the repository secret to Fly on every run, using miwa-english's wording. Changing it in GitHub and re-running the deploy now resets Dad's passphrase. `OPENROUTER_API_KEY` stays set only if missing. `COOKIE_SECRET` was already made once and kept, so it is unchanged. No value is printed.
- **Sign-in** ignores spaces at either end of what is typed, and of the secret as set (miwa-english's comparison). `test/auth.test.js` covers stray spaces (accepted) and a wrong passphrase, spaces inside, a change of case and a blank entry (all refused). `npm test`: 92 pass.
- `main` before this session was `5d5189a` (the drills merge, isleofdan/french-ear#9); after it, `ac63b32`.
- The deploy step was the "only if missing" shape, as the brief said.

## What the brief got wrong
- **The card's state was stale.** It says the drills session "stopped at its gate; nothing built". In fact the drills were built and published on 26 Sep, after Dan said go. That is isleofdan/french-ear#9, merged, publish run 11 green. The site has "Practice" in the top bar. The drills session's live round with Dan had not been run when this brief arrived: it stopped at its first check (open Practice, report the clip counts). Its field report is still owed and is not filed here.

## Deliberate divergences — DO NOT REVERSE
- **The stored secret is trimmed too, not only what is typed.** This is the same as miwa-english. A secret saved in GitHub with a stray space still matches.

## Asks
1. The drills close-out: run it as the drills session's remaining step (Dan does one practice round on the live site, then the session files its report on this card), or fold it into the next brief? **Recommended:** run it now in the same session, three short checks, before any new brief on this card.
