# Vocabulary Builder v0.8

Vocabulary Builder is an accessibility-first personal vocabulary trainer designed for screen-reader use, especially TalkBack and JAWS. It combines a local 5,000-word study curriculum with live Merriam-Webster Dictionary and Thesaurus lookups while keeping API keys and learning progress on the user's device.

## What is new in v0.8

- Rebuilds the Home and practice experience around a simpler Vocabulary Builder-style flow: Practice, Levels, Review, then optional tools/progress disclosures.
- Adds five one-tap level rows with progress bars and direct 10-word practice.
- Changes Mixed Practice and level practice back to **word → concise meaning** by default, matching the focused word-first interaction of classic vocabulary-builder apps.
- Keeps the full **5,000-word curriculum** available and increases ordinary Mixed Practice to favor unseen vocabulary: up to 7 new words and 3 review words when possible.
- Expands the recent-word avoidance window so recently practiced non-due words are less likely to recur unnecessarily.
- Caps answer-choice definitions at **96 characters and 16 words**. If the target has no safe concise Merriam-Webster short definition, that question automatically switches to definition → word rather than presenting an oversized answer.
- Replaces the answer-result word **Incorrect** with **Not quite**, removes the historical correct/incorrect record from the immediate result screen, and hides the old question card before result focus. This removes the most likely adjacent/leftover TalkBack source of the word “incorrect” after a correct answer.
- Keeps the correct result focused directly on a short result heading, with one concise definition, part of speech, source, and mastery. Extra Merriam-Webster definitions are collapsed under a disclosure.
- Adds **batched dictionary lookup** support. The browser can request up to eight words in one Vercel call; the serverless proxy fetches those Merriam-Webster entries in parallel and the app reuses them in memory across the round.
- Builds distractors primarily from the current session so the first batched request warms most of the next questions. Remaining session words are prefetched in the background.
- Makes Word Lookup feel faster by displaying the dictionary result immediately, then loading thesaurus information separately underneath.
- Keeps all previous storage keys and progress formats unchanged.

## Curriculum design

`curriculum.js` contains headwords, app-defined difficulty levels, and collection tags only. It contains no Merriam-Webster definitions, synonym lists, or antonym lists.

Current level distribution:

- Level 1 — Common: 1,500
- Level 2 — Intermediate: 1,450
- Level 3 — Advanced: 1,150
- Level 4 — Expert: 750
- Level 5 — Challenge: 150

The curriculum includes a deliberately tagged Practical Academic & Professional layer plus topic collections for writing/punctuation, reasoning, communication, work/projects, business/analytics, accessibility/technology, government/contracting, academics/research, housing/practical life, precision/distinctions, and literary/rhetorical vocabulary.

Difficulty is an app study aid, not a Merriam-Webster rating.

## Reference-content architecture

Merriam-Webster remains the authoritative live reference source. Correct definitions and definition distractors come from Merriam-Webster's Collegiate Dictionary. The local curriculum decides which words may be studied; it does not contain copied dictionary content.

v0.8 uses a batch-capable same-origin proxy to reduce round-trip overhead. A batch contains at most eight requested headwords and the proxy performs those upstream requests in parallel. Responses remain `no-store`. The app keeps dictionary/thesaurus results only in transient in-memory maps for the active app session.

Thesaurus information is no longer required to construct every question. It is retrieved on demand for the result/details and lookup experiences, which substantially reduces question-generation delay.

## Persistent local data

v0.8 intentionally keeps the established storage keys so an update on the same production origin carries forward existing data:

- `vocabTrackerKeysV01` — local Merriam-Webster keys
- `vocabTrackerProgressV01` — mastery, custom words, history, placement, statistics, suspended words, etc.
- `vocabTrackerSettingsV01` — practice and accessibility settings
- `vocabTrackerActiveSessionV01` — sanitized resumable-session metadata

The 5,000 static curriculum words live in `curriculum.js`; they do not create 5,000 progress records in local storage. Progress exports contain study progress/settings but do not include API keys.

## Accessibility design

- Native semantic buttons, inputs, selects, headings, regions, details/summary disclosures, and labels.
- Vertical Menu navigation instead of horizontally scrolling tabs.
- Home is organized as a short Practice → Levels → Review flow, with secondary tools collapsed below it.
- Every level row is one TalkBack target containing the level name and its progress text.
- Question counter is no longer a live region, reducing unsolicited announcements while the answer result is being spoken.
- After answering, the question card is hidden and focus moves to exactly `Correct` or `Not quite`.
- The immediate result screen contains no historical “incorrect” count.
- Answer choices are concise and individually focusable.
- At most 50 library words are rendered at once; Word History remains newest-first and capped at 500 unique words.
- Optional Focused Practice hides global navigation/header/footer during an active quiz.

## Core files

- `index.html` — semantic user interface
- `styles.css` — responsive Vocabulary Builder-style layout plus light/dark themes
- `app.js` — practice, batching, progress, lookup, history, collections, navigation, and persistence
- `curriculum.js` — 5,000 seed headwords, levels, and collection tags
- `api/lookup.js` — single and batched same-origin Vercel proxy for Merriam-Webster lookups
- `manifest.webmanifest` / `sw.js` — installable PWA shell and update cache
- `THIRD-PARTY-NOTICES.txt` — curriculum-source attribution and notices

## Deployment

Keep the same production Vercel origin so browser local storage carries forward. v0.8 changes the service-worker cache name to `vocab-tracker-v08`.

The update requires these runtime files to be replaced together:

- `app.js`
- `index.html`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `api/lookup.js`

`curriculum.js` is unchanged from v0.7 and remains the 5,000-word catalog.

## Known limitations

- Natural-language multiple choice can never be guaranteed perfectly unambiguous. v0.8 rejects duplicate/overlapping definitions and prefers semantically separated session distractors, but the app still relies on heuristic screening.
- A small number of seed headwords may not produce a usable Merriam-Webster Collegiate entry. The app skips and remembers those locally when encountered.
- Network access is still required for a word's first reference lookup in a fresh app session.
- Pronunciation audio and example sentences are not yet surfaced.
