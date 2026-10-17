# Vocabulary Builder v1.1

Vocabulary Builder is an accessibility-first vocabulary study PWA designed for fast TalkBack and JAWS use. The main study loop follows a Magoosh Vocabulary Builder-style pattern: choose a level, answer one four-choice question at a time, get immediate feedback, recycle missed words later in the round, and replay or advance from the completion screen.

## v1.1 quality pass

- Preserves Merriam-Webster `shortdef` sense order instead of sorting definitions by length. This prevents a short specialist sense from replacing the primary/common meaning. If the primary sense is too long for an answer choice, the question switches direction rather than choosing a later sense.
- Folds part of speech into the accessible name of the word or definition prompt. TalkBack hears, for example, `ledger, noun` when focus lands on the word. The small visual part-of-speech label is hidden from the accessibility tree to avoid a duplicate stop.
- Makes immediate feedback concise: result, word + part of speech + primary meaning, then Next word. Source, mastery, extra definitions, and related words remain under More about this word.
- Puts Next word first in actual DOM/TalkBack order, not merely visual CSS order.
- Removes the nested extra-definitions disclosure inside result details; one More about this word expansion exposes all optional information.
- Restores true system-aware dark styling throughout the main Home/level experience instead of leaving light level cards inside dark mode. Light and Dark remain explicit overrides in Settings.
- Completes the Saved words lifecycle with Remove from saved words.
- Treats the thesaurus key as optional. A dictionary key is enough for practice; the thesaurus key adds synonyms and antonyms.
- Keeps the v1.0 level-first flow, direct level starts, missed-word recycling, protected Android Back behavior, distinctive action-oriented menu labels, 5,000-word curriculum, and batch dictionary loading.

## Accessibility and navigation

- Android Back never intentionally exits the installed PWA. A protected Home history entry catches the final Back action and returns focus to the Home heading.
- Back closes an open Menu or disclosure first, then follows the actual in-app navigation trail.
- Destination headings receive focus so TalkBack announces where navigation landed.
- Menu labels describe distinct actions: Practice by level, Find a word, Review saved words, Browse topic groups, Browse all words, See recent words, Check progress, Change app settings, and About this app.
- Shipped HTML, JavaScript, and CSS contain no user-facing `incorrect` result terminology; misses use `Not quite` and `missed`.
- Primary app controls are not disabled. Unavailable actions are hidden rather than presented as dead controls.

## Question quality

Definitions come live from Merriam-Webster's Collegiate Dictionary through the user's locally stored API key. Synonyms and antonyms come from the Collegiate Thesaurus when configured.

Merriam-Webster documents `shortdef` as abbreviated definitions for the first senses of an entry. v1.1 therefore respects provider order. Quiz answer definitions are still capped for usable length. Distractors are screened for duplicate headwords, duplicate definitions, excessive semantic/text overlap, part of speech, level proximity, and topic relevance.

## Curriculum and study modes

The app retains 5,000 unique curriculum headwords across five app-defined levels:

1. Common
2. Intermediate
3. Advanced
4. Expert
5. Challenge

Additional study paths include mixed review, unseen words, due review, difficult words, custom rounds, saved words, topic groups, placement, single-word practice, dictionary lookup, recent words, and filtered library browsing.

## Progress and word controls

Each word can be saved or removed from Saved words, practiced immediately, marked as known, paused/resumed for review, and explored through additional definitions and thesaurus results. Progress includes mastery, accuracy, completed rounds, study streaks, per-level statistics, and placement recommendation.

## Settings and data

Theme defaults to Follow system, with Light and Dark overrides. The dictionary API key is required for practice; the thesaurus key is optional. API keys stay in browser local storage and are excluded from exported progress backups.

v1.1 preserves the established localStorage identifiers so upgrading on the existing Vercel origin retains current data:

- `vocabTrackerKeysV01`
- `vocabTrackerProgressV01`
- `vocabTrackerSettingsV01`
- `vocabTrackerActiveSessionV01`

## Performance

The existing `api/lookup.js` batch proxy remains unchanged. It accepts up to eight dictionary words per request, fetches upstream entries in parallel, and lets the app reuse them in memory throughout a round.

## Deployment

Keep the existing GitHub repository, Vercel project, and production origin. v1.1 changes root application files only; the current batch-capable `api/lookup.js` does not need replacement.
