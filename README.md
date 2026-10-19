# Vocabulary Builder v1.8 — Offline-First Practice

**Purpose:** Keep the accessible four-choice study experience intact, make the full 1,155-word reviewed curriculum available without registration, a dictionary API key, or an ongoing connection, and preserve existing local progress.

## What changed

- **All five curriculum levels work from local teaching content.** Quizzes now build the target and the incorrect answer choices from `study-content.js`, rather than requesting them from Merriam-Webster. This also covers mixed question formats, quick review, placement, due review, and topic collections.
- **No API key required for built-in practice.** The setup warning no longer blocks lessons. Optional dictionary/thesaurus keys remain under Settings for additional online lookups, recorded pronunciations, and related words.
- **Known built-in words can be searched offline.** Word Details shows the curated meaning, example, multiple meanings where available, and the device's speech option where supported. When configured and online, the dictionary can add its recording, syllable breaks, and other reference information without changing the teaching definition or example.
- **Offline caching is versioned.** The service worker precaches the complete app shell (including `curriculum.js` and `study-content.js`) before activation and serves those assets from its versioned cache. It does not cache API requests, other websites, or personal API keys. The Settings > Offline use disclosure includes a cache readiness check.
- **Progress stays local.** Existing settings, progress, API keys, and unfinished round keys are unchanged. Saved/custom words are preserved. Existing older sessions containing a custom online word skip that unavailable word while offline, rather than stopping the entire lesson.
- **Visual UX preserved.** The four answer choices, results layout, sounds, study modes, and navigation were not redesigned.

## What is offline—and what isn't

After the app has been opened while online and its offline pack has installed, all 1,155 built-in words can be studied without internet access. Progress is recorded in the same browser storage as before. Pronunciation uses an offline-installed device voice **if your device supports one**; some devices synthesize speech online. Merriam-Webster recordings, arbitrary-word lookup outside the curated curriculum, and thesaurus services remain **optional online features** that require the relevant user's key.

A freshly installed browser must connect once to download the app shell. The storage cache may be removed by a browser or user storage-cleanup operation. Manual progress backups remain important because progress does not sync between devices.

## Updating your GitHub `main` branch

Use the **root-files ZIP** for the normal v1.7 -> v1.8 update. Unzip it, then upload its five root files:

- `app.js`
- `index.html`
- `sw.js`
- `package.json`
- `README.md`

Upload page: https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

Other application files, including `study-content.js`, `curriculum.js`, and `api/lookup.js`, are **unchanged**. Do not upload the ZIP itself. The separate complete ZIP includes all 15 files as a source backup.

## Device test after deployment

1. Open the updated installed app while connected. In Settings > Offline use, confirm it says the offline study pack is ready.
2. Set airplane mode. Fully close and reopen the app. Practice Level 1 and Level 5, including moving from answer choices to results and on to the next word.
3. Test Word Details on a built-in word. The curated definition and example should display; recorded pronunciation may not be available offline.
4. Complete a round, reopen the app, and verify progress persisted. When online again, test the optional reference features if configured.
5. Do **not** clear site/app data; it holds your personal progress.

## Validation performed

- JavaScript syntax checked.
- All 1,155 curated local entries validated to have a usable teaching definition and example.
- All 1,155 words generated four distinct valid choices in **each fixed quiz direction** without any API requests in a JavaScript test harness; mixed-format sampling also passed.
- The service worker's install/activation/fetch logic passed simulated cache tests (precache all required static assets, serve app files while offline, preserve unrelated caches, bypass the API).
- HTML identifiers are unique; all three required script files are present.

**Not yet tested:** Real installed app in Android airplane mode, TalkBack behavior, browser persistence under low-storage conditions, and the full end-to-end browser navigation path. The local browser test environment blocked navigation, so these cannot be claimed as verified.

## Privacy and future public beta

This release adds **no sign-up, analytics, ads, paywalls, or microtransactions**. It does not require any accounts for built-in lessons. Commercial/public distribution should still be preceded by licensing and content-rights review and accessibility testing with multiple users and screen readers.
