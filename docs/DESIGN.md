# French ear — design notes

These are the decisions the app is built on. The mockup (five screens, phone
and laptop) is at https://claude.ai/artifact/V7HVBoqGy2viVmRvTYXGwf.

## Built around patterns, not vocabulary

Every screen answers one question: *which of the twenty was that?* The
twenty ways spoken French leaves the page (`data/patterns.json`) are fixed
data. The model that writes a line "as said" may only name patterns from that
list; a line where it names anything else is saved with a warning, never
dropped and never trusted.

## His data is his own

His lines, his kept list and his tally live in this app's own database, on
its own volume, behind his passphrase. Nothing is sent anywhere else: no
third-party analytics, no shared register.

## Where things happen

- **YouTube is where the app lives.** He pastes (or, on Android, shares) a
  video; the app shows its lines as written and as said while the video
  plays in YouTube's own player. No video or audio is ever copied.
- **The TV is where questions get collected** — a photo of the screen at the
  moment a line got past him, usually with English subtitles on it. The
  after-photo screen asks for nothing but a correction of the subtitle and
  two optional notes ("What it sounded like", "What's happening"), then
  "Save for later": he is watching with someone and will not stop to study.
  The French is worked out later and waits under "From the TV".
- **Practice comes from real clips of what he watched** — every line of his
  YouTube videos with a start and an end time is a clip the player can
  replay. "Practice" drills one pattern or all of them (Mix): hear the clip
  with the line hidden, pick what was said from three of his own lines, then
  see it as said and the pattern named. No synthetic audio, no invented
  sentence, no model call. Typed lines and photos from the TV have no clip.
  A round is forgotten when he leaves it: no scores by day, nothing due.

## Nothing pushes

Nothing notifies, reminds, counts streaks or scores by day, and nothing asks
to be checked. The app answers when it is opened.

## The tally

Every event names one pattern and one line. The kinds:

- **looked** — in Follow along he tapped a line; one for each pattern in it.
- **got past me** — in Ear first he pressed "What was that?"; one for each
  pattern in the two lines it showed.
- **watched clean** — in Ear first a line played through and no "What was
  that?" covered it.
- **keep** — he kept a line; one for each pattern in it.
- **got past me** from a photo — a photo from the TV, once worked out,
  records one "got past me" for each pattern in its line, once per photo. A
  photo worked out as "a guess" records nothing.
- **got past me** from a drill — on Practice he picked the wrong line for
  "What was said?"; one for each pattern in the clip's line. It weighs the
  same as "What was that?" in Ear first: he heard it and did not catch it.
- **drill clean** — on Practice he picked the right line for "What was
  said?"; one for each pattern in the clip's line.

A wrong answer to "Which pattern?" (Mix) records nothing: naming the pattern
is knowledge, not hearing.

Watching in Follow along without tapping records nothing. The typed-line box
records nothing except a keep.

The state of each pattern (the rule lives in code in one place,
`lib/tally.js`):

- **not met yet** — it has appeared in no line he has opened or watched (no
  event names it).
- **shaky** — one or more "got past me" or "keep" events for it among his
  last 200 events.
- **solid** — it has appeared in at least five different lines he watched in
  Ear first with no "What was that?" on them, *or* in ten different lines he
  got right in a drill, and no "got past me" for it among his last 200
  events. The two are not added together.
- **seen** — anything else, shown between the two with the caption "seen, no
  trouble yet".

Shaky is checked before solid. The patterns page shows shaky first, then
seen, solid, not met yet.

The tally weights evidence by how much it says: a photo from the TV or a
"got past me" counts above a right drill answer, which needs ten lines where
Ear first needs five. A clip in a drill is a line he already watched, heard
again on purpose and chosen from three: easier than catching it as it goes
by.

## Look

Warm paper ground; ink text; one blue tint for "this changed in speech";
orange only for the patterns that are shaky for him. A serif (Fraunces) for
the "as said" line and headings, a plain sans (Public Sans) for everything
else. Dark mode keeps the same roles on a dark warm ground. On a phone the
player sits on top and the lines scroll under it; on a laptop the lines show
written and as said side by side, with "In this episode" to the right.

## Words on screen

"as written", "as you'll hear it", "keep", "got past me", "solid", "shaky",
"seen, no trouble yet", "not met yet", "Follow along", "Ear first", "What was
that?", "Practice", "Mix", "hear it", "play again", "What was said?", "Which
pattern?", "knew it". No invented names for features.
