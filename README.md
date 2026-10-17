# Vocabulary Tracker v0.7

Vocabulary Tracker is an accessibility-first personal vocabulary trainer designed for screen-reader use, especially TalkBack and JAWS. It combines a local study curriculum with live Merriam-Webster Dictionary and Thesaurus lookups while keeping API keys and learning progress on the user's device.

## What is new in v0.7

- Fixes the TalkBack feedback race where the previously visible result could be announced after a new answer. Feedback is now fully updated while hidden, then revealed, and focus moves directly to the `Correct` or `Incorrect` heading.
- Updates each answer button's accessible label after answering so TalkBack explicitly identifies **correct answer**, **your answer**, and **incorrect** when applicable.
- Makes **Definition to word** the recommended/default question style because it is less prone to multiple plausible definition choices.
- Keeps every definition sourced live from Merriam-Webster, while improving the *question-construction* layer separately: target synonyms/antonyms are excluded from distractors, near-duplicate definitions are rejected, duplicate headwords are rejected, and candidate definitions are screened before a question is shown.
- Shows up to three official Merriam-Webster short definitions after each answer as separate list items, plus part of speech and an explicit source label.
- Adds **Quick Play**, a 10-question broad round that intentionally draws across the full 5,000-word curriculum instead of silently reusing old custom level settings.
- Adds **Discover**, a 10-question round made from unseen curriculum words across all five levels.
- Keeps **Custom Practice** for level, collection, source, novelty, and question-style control.
- Reorganizes Home into large TalkBack-friendly study cards inspired by the simple Play / Learn / Dictionary / Lists structure used by mature vocabulary-learning apps, without copying another product's branding or visual identity.
- Preserves v0.6 Collections, Word History, the paged Vocabulary Library, the practical academic/professional layer, and all v0.5 persistence/accessibility features.

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

v0.7 intentionally keeps the established storage keys so an update on the same production origin carries forward existing data:

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

The production project is intended to remain on the same Vercel origin so local browser storage continues to work across releases. `curriculum.js` must be deployed alongside the existing static files and is included in the v0.7 service-worker cache.

No Vercel environment variable is required for the Merriam-Webster keys because the user enters those keys locally in Settings.

## Question-source and distractor design

The **correct definition is always retrieved from Merriam-Webster's Collegiate® Dictionary**. Distractor definitions are also retrieved from Merriam-Webster entries rather than generated by the app.

v0.7 adds a validation layer before displaying a multiple-choice question. It excludes words returned as synonyms/antonyms of the target, avoids duplicate headwords, rejects exact duplicate definitions, and uses token-overlap screening to reject definitions that are too similar to the target. It also prefers compatible parts of speech and nearby study levels when several safe distractors are available.

No heuristic can prove that every English multiple-choice distractor is semantically impossible. For that reason, Definition-to-word is now the recommended mode: one official definition is the prompt and the app chooses word distractors after relationship/similarity screening.

## Known limitations

- The 5,000-word curriculum is a study-oriented filtered catalog, not a claim that every word's assigned level is objectively correct.
- A small number of seed headwords may not produce a usable Merriam-Webster Collegiate entry. The app skips and remembers those locally when encountered.
- Topic tags overlap by design and are not an exhaustive ontology.
- Definitions and thesaurus data require network access unless already available transiently in the current app session.
- Pronunciation audio and example sentences are not yet surfaced.
- Multiple-choice ambiguity is reduced substantially in v0.7 but cannot be mathematically eliminated for natural-language definitions.
