# Vocabulary Builder v0.9

Vocabulary Builder is an accessibility-first personal vocabulary-learning PWA designed primarily for Android TalkBack and Windows screen-reader use. It combines a curated 5,000-word curriculum with live Merriam-Webster Dictionary and Thesaurus data while keeping API keys and study progress on the user's device.

## v0.9 goals

v0.9 is a usability release. The main goal is to make the app feel easy, predictable, and enjoyable rather than merely technically accessible.

### Navigation and TalkBack

- Real in-app browser history gives Android Back meaningful behavior.
- Back closes the Menu or an open disclosure before leaving the current screen.
- Leaving an unfinished round preserves it for Resume.
- A compact app bar always identifies the current screen and exposes Back, Menu, or End round only when appropriate.
- Menu content is isolated from the page behind it so TalkBack cannot drift into background controls.
- Screen changes focus a screen heading or the relevant word/result rather than an arbitrary container.
- Controls use self-identifying labels such as `End round`, `Clear recent lookups`, `Word details`, `Vocabulary library`, and `Word history`.

### Home

Home is intentionally small and task-oriented:

1. Practice — Resume when needed, Mixed practice, and New words.
2. Levels — direct Level 1 through Level 5 practice.
3. Review — appears only when something is actually due or difficult.
4. Explore — Dictionary, Saved words, Collections, and Custom practice.
5. Progress — one concise summary and one View progress action.

Setup prompts disappear after setup is complete. If setup is incomplete, Home provides a one-tap `Set up dictionary` action.

### Word-centered learning

Library, Word history, Dictionary results, quiz results, and related words all lead to one consistent Word details screen. It provides:

- the word, part of speech, and concise Merriam-Webster meaning;
- learning status and performance;
- Save word when the word is not already saved;
- Practice word;
- optional additional definitions;
- on-demand synonyms and antonyms;
- Mark as known / Pause review controls;
- study-level control for manually added words.

Word-to-word navigation preserves exact Back history. Saved curriculum words are tracked without being duplicated.

### Practice and results

The question screen centers one word or definition and four large answer choices. The result order is deliberately short for TalkBack:

1. Correct / Not quite.
2. Concise meaning.
3. Lucky guess, when relevant.
4. Next word.
5. Save word, when not already saved.
6. Word details.
7. Optional More about this word disclosure.

Quiz answer meanings are limited to 96 characters and 16 words. When Merriam-Webster does not provide a suitable concise answer meaning, the app uses definition-to-word format for that question instead of truncating an official definition into a misleading fragment.

### Lists and secondary screens

- Vocabulary Library displays 25 words at a time rather than a long 50-word page.
- Search is always visible; less-used Library filters live under one Filters disclosure.
- Word History starts with 25 recent words and loads 25 more on request.
- Saved words is directly reachable from both Home and Menu.
- Progress statistics are complete label-value rows for predictable TalkBack reading.
- Settings keeps Appearance visible while Dictionary connection and Backup/reset live in named disclosures.

### Performance

v0.9 includes the batch-capable lookup proxy. A question can request a small group of Merriam-Webster entries in one browser request; the Vercel proxy performs those reference lookups in parallel. The app reuses entries in memory across the round. Dictionary lookup shows the dictionary result without waiting for the thesaurus.

Future PWA updates can also reload automatically when a new service worker takes control while the user is safely on Home. If an update arrives elsewhere, the app defers the reload until Home rather than interrupting a round.

## Curriculum

The built-in curriculum contains exactly 5,000 unique headwords across five app-defined levels and 12 overlapping collections. The curriculum stores headwords and study metadata only; Merriam-Webster definitions, synonyms, and antonyms are retrieved live when needed.

## Persistent local data

v0.9 deliberately preserves the established storage identifiers:

- `vocabTrackerKeysV01`
- `vocabTrackerProgressV01`
- `vocabTrackerSettingsV01`
- `vocabTrackerActiveSessionV01`

Updating the app on the same production origin preserves compatible progress, saved words, settings, and local API keys. Do not clear browser/site data as part of a normal update.

## Reference content

Definitions are retrieved from Merriam-Webster's Collegiate Dictionary API. Synonyms and antonyms are retrieved from Merriam-Webster's Collegiate Thesaurus API. The application is not endorsed by Merriam-Webster, Inc.

## Deployment

Keep the existing Vercel project and production origin. v0.9 requires the updated root application files and the updated `api/lookup.js` batch proxy. See `UPGRADE-v0.9.txt` in the release package.
