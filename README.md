# Vocabulary Tracker v0.6

Vocabulary Tracker is an accessibility-first personal vocabulary trainer designed for screen-reader use, especially TalkBack and JAWS. It combines a local study curriculum with live Merriam-Webster Dictionary and Thesaurus lookups while keeping API keys and learning progress on the user's device.

## What is new in v0.6

- Expands the built-in curriculum from 100 placement words to **5,000 unique seed headwords** for everyday practice.
- Keeps the original 100 words as the fixed 15-question placement-check pool so placement behavior remains comparable across versions.
- Adds **12 overlapping topic collections**, led by **Practical academic & professional** with 1,087 deliberately tagged high-utility words.
- Adds practical vocabulary for writing and punctuation, precise everyday distinctions, reasoning, college/research, work/projects, negotiation, accessibility/technology, government/contracting, business/analytics, housing/practical life, and literary/rhetorical language.
- Rebuilds Home for touch exploration with separate TalkBack-friendly controls such as `Mastered: 12` and `Accuracy: 84%` rather than a visually grouped statistics grid.
- Adds **Word History**, keeping the 500 most recently encountered unique words so a word can be recovered without remembering its spelling.
- Replaces the potentially huge word list with a **paged Vocabulary Library** that displays at most 50 matches at a time and supports search, level, collection, source, mastery, and suspended/active filters.
- Adds **Collections** browsing and one-button collection practice.
- Adds Low / Balanced / High **new-word mix** controls. Balanced practice aims for about 50% unseen targets when possible; Low uses about 25% and High about 70%.
- Temporarily deprioritizes the 30 most recently practiced non-due words while still prioritizing due reviews, difficult words, and personal vocabulary.
- Remembers unusable curriculum headwords if Merriam-Webster has no usable exact entry and skips them in future sessions instead of repeatedly breaking practice.
- Preserves all v0.5 features: dark mode, resumable sessions, recent lookups, expandable word actions, suspension, mark-known, personal-word difficulty, and lucky-guess correction.

## Curriculum design

`curriculum.js` contains headwords, app-defined difficulty levels, and collection tags only. It contains no Merriam-Webster definitions, synonym lists, or antonym lists.

The 5,000-word catalog is built from reusable English frequency/lexicon resources in TextBlob and a hand-curated practical vocabulary layer. The generator removes many common corpus artifacts, proper-name-like entries, obvious inflections, misspellings, and overly basic concrete words. The 150-word Level 5 / Obscure tier is manually curated rather than inferred from historical corpus frequency.

Current level distribution:

- Level 1 — Common: 1,500
- Level 2 — Intermediate: 1,450
- Level 3 — Advanced: 1,150
- Level 4 — Expert: 750
- Level 5 — Obscure: 150

Difficulty is an app study aid, not a Merriam-Webster rating.

## Reference-content architecture

Merriam-Webster remains the authoritative live reference source. The app requests a dictionary entry when a word is actually needed for a question or lookup. Thesaurus information is requested only when the user asks to see it.

This means adding thousands of seed words does **not** create a local copy of Merriam-Webster. The shipped catalog is small headword metadata; reference content stays on demand.

The app's transient in-memory caches avoid repeated lookups during the same app session, but Merriam-Webster definitions/thesaurus content are not placed into the persistent progress database.

## Persistent local data

v0.6 intentionally keeps the established storage keys so an update on the same production origin carries forward existing data:

- `vocabTrackerKeysV01` — local Merriam-Webster keys
- `vocabTrackerProgressV01` — mastery, custom words, history, placement, statistics, suspended words, etc.
- `vocabTrackerSettingsV01` — practice and accessibility settings
- `vocabTrackerActiveSessionV01` — sanitized resumable-session metadata

The 5,000 static curriculum words live in `curriculum.js`; they do not create 5,000 progress records in local storage. A word's persistent state is created only when needed.

Progress exports contain study progress/settings but do not include API keys.

## Accessibility design

- Native semantic buttons, inputs, selects, headings, regions, and labels.
- Vertical Menu navigation instead of horizontally scrolling tabs.
- Separate Home statistic controls so each label and value is one TalkBack target.
- At most 50 library words rendered at once.
- Word History is newest-first and capped at 500 unique words.
- Expandable word actions avoid permanent rows of repetitive buttons.
- Optional Focused Practice hides global navigation/header/footer only during an active quiz.
- Visible keyboard focus, large controls, reduced-motion support, and no information conveyed by color alone.

## Core files

- `index.html` — semantic user interface
- `styles.css` — responsive accessible styling and light/dark themes
- `app.js` — practice, progress, lookup, history, collections, navigation, and persistence
- `curriculum.js` — 5,000 seed headwords, levels, and collection tags
- `api/lookup.js` — same-origin Vercel proxy for user-requested Merriam-Webster lookups
- `manifest.webmanifest` / `sw.js` — installable PWA shell and update cache
- `THIRD-PARTY-NOTICES.txt` — curriculum-source attribution and notices

## Deployment

The production project is intended to remain on the same Vercel origin so local browser storage continues to work across releases. `curriculum.js` must be deployed alongside the existing static files and is included in the v0.6 service-worker cache.

No Vercel environment variable is required for the Merriam-Webster keys because the user enters those keys locally in Settings.

## Known limitations

- The 5,000-word curriculum is a study-oriented filtered catalog, not a claim that every word's assigned level is objectively correct.
- A small number of seed headwords may not produce a usable Merriam-Webster Collegiate entry. The app skips and remembers those locally when encountered.
- Topic tags overlap by design and are not an exhaustive ontology.
- Definitions and thesaurus data require network access unless already available transiently in the current app session.
- Pronunciation audio and example sentences are not yet surfaced.
