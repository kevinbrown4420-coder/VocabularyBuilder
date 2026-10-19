# Vocabulary Builder — Version 2.0 Alpha 1

A focused first step toward a more intelligent study engine. This release **does not add new screens, accounts, paywalls, or online dependencies**. It retains v1.9's responsive four-choice quiz, contiguous TalkBack-friendly results rows, and the offline bank of 1,155 teaching definitions/examples.

## What changed

- **Stronger distractor selection:** draws from a broader set of candidate words instead of the previous 12-word limit, and balances question difficulty, definition style, approximate answer length, level, and study topic when available.
- **Fairer questions:** excludes a conservative group of near-equivalent words (e.g. *assume/presume*, *adequate/sufficient*, *infer/deduce*) from each other's questions. Screens alternate meanings where explicitly available and avoids nearly identical wrong options.
- **Better consistency:** prioritizes similarly structured answer choices for word-to-meaning questions (e.g. a short action definition against other action definitions) so the correct choice is less conspicuous.
- **Faster repeat generation:** locally reviewed dictionary entries are reused across a session rather than reconstructed for every prospective answer.
- **Repeatable offline tests:** `npm test` now validates all 1,155 teaching entries and creates all 2,310 fixed-direction questions without sending any API requests, verifying saved-progress compatibility and key screen markup.
- **Version reporting:** About screen reports `2.0 alpha`, and the service worker uses a new v20a cache.

## What deliberately did not change

- Same four answer buttons, same word/meaning/example/Next Word reading sequence, same TalkBack-friendly result surfaces.
- Same vocabulary bank (`curriculum.js` and `study-content.js` have not changed).
- Same mastery points, intervals, answer statistics, and saved progress keys: `vocabTrackerProgressV01`, `vocabTrackerSettingsV01`, and `vocabTrackerActiveSessionV01`.
- No new account, registration requirement, analytics, microtransactions, tracking, or new paid services.
- The existing `api/lookup.js` is unchanged and not necessary for built-in offline practice.

## Installation

Extract **v2.0-alpha1-root-files.zip**. Upload its **seven extracted files** into the main GitHub repository root, replacing matching files:

- `app.js`
- `index.html`
- `sw.js`
- `package.json`
- `README.md`
- `test-quality.cjs` (new; an automated test, not loaded by the app)
- `CHANGELOG.md` (new; release and accessibility testing notes)

GitHub main upload: https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

You do not need to touch `api/`, `styles.css`, `curriculum.js`, `study-content.js`, icons, or the manifest. An updated Vercel deployment should be triggered by committing the root files to main if the existing GitHub integration is still active.

## Testing

From a local checkout with Node.js 18 or later, run:

```sh
npm test
```

Verified in an offline JavaScript test harness:

- 1,155/1,155 entries: one concise definition and a valid example sentence per word.
- 1,155/1,155 valid word-to-definition questions.
- 1,155/1,155 valid definition-to-word questions.
- Zero network calls.
- Preexisting progress was loaded and updated without a storage migration.
- Service worker installs and caches eight essential assets while bypassing API requests.
- Browser smoke test at mobile width: four answer options, answer feedback, contiguous results reading areas, navigation to Next Word, and no JavaScript errors.

The tests cannot prove that every possible distractor is linguistically unambiguous. They catch mechanical and known semantic conflicts; further editorial review and real-device TalkBack testing remain necessary.

## Next planned phases

- **Version 2 beta:** meaning-level review state and an optional contextual question format, designed to preserve historic progress.
- **Public release preparation:** progress backup validation, broader screen-reader testing (TalkBack, VoiceOver, JAWS, NVDA), and independent tester feedback.

See `CHANGELOG.md` for the change history and accessibility QA log.
