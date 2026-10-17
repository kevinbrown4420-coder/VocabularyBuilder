# Vocabulary Builder v1.0

Vocabulary Builder is an accessibility-first vocabulary study PWA designed for fast TalkBack and JAWS use. Version 1.0 rebuilds the core study loop around a Magoosh Vocabulary Builder-style operation: choose a level, see one word with four answer choices, get immediate feedback, repeat missed words later in the same round, and continue or replay a level from the completion screen.

## v1.0 study loop

- Home leads with five difficulty levels. Activating any level starts that level immediately.
- Level buttons are never disabled by an unfinished round. Starting a different round replaces the unfinished round while preserving answers already recorded.
- Each question shows one word (or a definition only when a concise word-to-definition question cannot be built safely) and four large answer choices.
- Missed words are recycled several questions later and continue to return if missed again.
- A result replaces the question immediately; hidden answer controls are removed from the accessibility path before TalkBack focus moves to feedback.
- Level completion offers Replay this level, Practice next level, Review missed words, and Choose another level.

## Accessibility and navigation

- The shipped HTML, JavaScript, and CSS contain no user-facing `incorrect` result terminology; misses use `Not quite` and `missed`.
- Primary app controls are not disabled. Unavailable controls are hidden; actionable controls stay actionable.
- Android Back never intentionally exits the installed PWA. A protected Home history entry catches the final Back action and returns focus to the Home heading.
- Back closes an open Menu or disclosure first, then returns through the actual app navigation trail.
- Destination headings are focusable and deliberately distinct for screen-reader orientation.
- Menu labels describe actions rather than similar nouns: Practice by level, Find a word, Review saved words, Browse topic groups, Browse all words, See recent words, Check progress, Change app settings, About this app.
- Word-to-word navigation keeps a real history trail, so Back returns through related words in the order opened.

## Reference content and question quality

Definitions come live from Merriam-Webster's Collegiate Dictionary through the user's own locally stored API key. Synonyms and antonyms come from the Collegiate Thesaurus when requested. The built-in curriculum stores headwords and study metadata, not copied dictionary content.

Quiz definitions are capped for usable answer length. If the target lacks a safe concise definition, the question changes to definition-to-word instead of truncating a definition. Distractors are screened for duplicate headwords, duplicate definitions, and excessive semantic/text overlap.

## Curriculum

The app retains the 5,000-word curriculum and five app-defined difficulty levels:

1. Common
2. Intermediate
3. Advanced
4. Expert
5. Challenge

The curriculum also retains overlapping practical collections for writing, reasoning, academic/research language, communication, accessibility/technology, government/contracting, business/analytics, practical life, literary/rhetorical vocabulary, and precision distinctions.

## Performance

`api/lookup.js` supports batched dictionary requests of up to eight words. The Vercel proxy performs those upstream requests in parallel and the app reuses returned entries in memory across a round. This greatly reduces per-question waiting compared with sequential dictionary calls.

## Persistent data

v1.0 intentionally preserves the established localStorage identifiers so an update on the same Vercel origin carries forward existing keys and progress:

- `vocabTrackerKeysV01`
- `vocabTrackerProgressV01`
- `vocabTrackerSettingsV01`
- `vocabTrackerActiveSessionV01`

Backups exclude API keys.

## Deployment

Keep the existing GitHub repository, Vercel project, and production origin. Replace the root release files with the v1.0 root package and ensure `api/lookup.js` is the batch-capable v1.0 proxy. Do not create a second Vercel project or domain.
