# About French ear
Written 2 Oct 2026 by a Claude Code session from the files in this folder; "Unknown" means the files did not say.

## What it is
A private website for one learner of French, Dan's father, whose trouble is that spoken French sounds nothing like the French he reads. He gives it a link to a YouTube video, and the app shows each French line twice, as written and as you would hear it, with the changed parts tinted and named from a fixed list of twenty spoken-French patterns, while the video plays in the page. It also reads photos of subtitles taken from the TV, keeps a tally of which patterns keep getting past him, and has a Practice page of short listening drills. It opens in a web browser on a phone or computer, first at a sign-in page with a "Come in" button.

## What it plugs into (in and out)
In:
- A YouTube video's link; the app asks YouTube whether the video exists and, if asked to, tries to fetch its captions from YouTube.
- A transcript copied from YouTube and pasted in, or screenshots of it.
- Photos of the TV screen, and screenshots or links shared from another app on an Android phone, once the site is installed on the phone (a "share target").
- Answers from OpenRouter, a paid service that passes requests on to AI models: Google's Gemini reads the video from its link and reads pictures, and Anthropic's Claude (with Gemini as a back-up) works out how each line is said.

Out:
- Requests to OpenRouter (the AI service above).
- The video itself plays from YouTube, through YouTube's own player inside the page.

## How it is built
It is one program written in the programming language JavaScript and run by Node (the engine that runs JavaScript outside a browser), plus a set of plain web pages it hands to the browser. Its videos, lines, kept lines and tally live in one database file (a single file where it keeps its records in tables, SQLite) called `french-ear.db`, with the TV photos in a folder beside it, all on a rented storage disk (a "volume") attached to the computer it runs on. The code is kept on GitHub, the website where Dan's code is stored. A change goes live by itself whenever it is added to the main copy of the code (a "push to main"), or when someone starts the publishing steps by hand on GitHub; those steps (`.github/workflows/deploy.yml`) first run the app's own checks, then put it on the rented computer and check the live site answers. The files do not mention a starting kit; PLAN.md says the publishing pattern was copied from the Hebrew reader.

## Where it runs and how to tell it is alive
It runs on one small always-on computer in Tokyo rented from Fly.io, a company that rents out computers to run websites, at https://french-ear-dan.fly.dev. To check it, open https://french-ear-dan.fly.dev ; a page headed "French ear" with a "Come in" button means it is up. Its health address, a page kept only for checking that it runs, is https://french-ear-dan.fly.dev/health, which shows `{"ok":true,"configured":true}` when it is running with its passphrase in place. Checked 2 Oct 2026: the main address sent the visitor to its sign-in page, and the health address answered that it was up and set up.

## Which hand-off route it is on
Dan builds.

## Which assistants can reach it
None found in the files. The app has no door for an AI assistant (no MCP, the plug-in connection Claude chats use, and no other); every page and data address sits behind the passphrase.
