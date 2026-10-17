# Vocabulary Builder v1.6 — complete example coverage, clearer senses and TalkBack feedback

**Based on:** v1.5 complete source. The Merriam-Webster API handler and environment/key setup are unchanged.

## Changes

- **One example sentence per curriculum word:** Added 697 original, word-specific sentences to the 458 curriculum words already covered in v1.5. All 1,155 words in the built-in curriculum now have at least one prepared, full-sentence example. These are original illustrations for this app, not quotations from Merriam-Webster. Other previously supported words outside the main curriculum also retain their examples.
- **Better alignment to the tested meaning:** The app prefers a full dictionary illustration only when it can associate that illustration with the meaning being taught; otherwise it uses the prepared example. For particularly tricky, multi-meaning words (such as *sanction, oversight, qualified, draft, resolution, effect, principal, frame,* and *claim*), an explicit meaning guide selects a matching example and identifies a distinct alternative meaning with its own example.
- **Visible multiple-meaning cue:** When other meanings or distinct dictionary definitions are available, the answer-results screen displays a small disclosure immediately after the example and before the Next Word button. Expand it for alternative definitions and, where a meaning-specific example has been prepared, another sentence. The word-detail page also includes alternate-meaning examples when available.
- **No empty example cards during practice:** Questions without a complete, reliable example are skipped rather than being presented as an incomplete lesson. This is primarily relevant to custom/saved words outside the built-in 1,155-word curriculum when their dictionary entry supplies no suitable sentence. They remain in the saved-word library.
- **TalkBack results polish:** The four-choice question layout is unchanged. The old answer-choice controls are removed from the accessibility tree on submission. The result focuses a neutral answer heading, suppresses stale question announcements, and gives the word/part-of-speech, definition and example individual, useful accessible labels without making users stop on tiny separate heading labels. The global announcer has been reduced from assertive to polite. This is a targeted mitigation for the intermittent stale “Incorrect” announcement, **not yet proven to eliminate the issue on an Android device**.
- **Version bump:** v1.6 service-worker cache identifier and application/package version. Browser/app progress storage keys are unchanged.

## Uploading to GitHub

Root-only archive: extract the files and upload the six extracted files to the root of `main`:
https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

You do **not** need to visit the API folder or reupload `api/lookup.js` for v1.6.

Complete archive: includes all 14 runtime files, including the unchanged `api/lookup.js`, for backup. The extra working notes and local test scripts are not in either release ZIP.

## Quality and testing

- Automated dictionary-bank check: all 1,155 curriculum headwords have built-in full-sentence examples (0 missing).
- JavaScript syntax checks passed with Node.
- Local browser test (Chromium, mocked Merriam-Webster responses): starts a level round, displays four answer choices, populates an example after answering, removes old choice buttons, and advances to another question with no JavaScript exception.
- Local browser test (Chromium, mocked dictionary): `sanction` displays its approval sentence and a separate penalty meaning with its corresponding example, with no JavaScript exception.
- External Merriam-Webster data and Android TalkBack could not be exercised end-to-end in this environment. Individual sense alignment and pronunciation should continue to be assessed on the live app.

## Preserve your progress

Do not clear browser storage or app data. The existing keys are unchanged: `vocabTrackerKeysV01`, `vocabTrackerProgressV01`, `vocabTrackerSettingsV01`, and `vocabTrackerActiveSessionV01`. Deploy to the **same Vercel site**.
