# Vocabulary Builder v1.5 — accessibility and study-format polish

**Base:** Complete v1.4 source, with the existing Merriam-Webster `/api/lookup.js` and keys workflow unchanged.

## What changed

- **Answer review:** Correctness is followed by distinct, finger-explorable word, part-of-speech, meaning, and example areas, then a prominent Next Word control. Optional controls and additional definitions remain after the main answer.
- **Example sentences:** The app first uses examples from the matching dictionary sense where possible. When unavailable, it can show one of **503 original, hand-written fallback sentences** (covering **458 of the 1,155 curriculum words**, including all 72 Level 4 words). Fallbacks are illustrations written for this app, not quotes attributed to Merriam-Webster. Other words transparently say when no suitable sentence is available. Because some words have multiple senses, users should still flag any sentence that doesn't match the definition being taught.
- **Study format:** A visible, accessible radio-choice group on the home screen lets you choose **word → meaning**, **meaning → word**, or **mixed formats** before selecting any level. The choice persists for future quick rounds, level rounds, and custom rounds. The app no longer silently changes a word → meaning question to the opposite format when it cannot build suitable answer choices; it skips that question instead. The explicit placement check remains definition → word by design.
- **Sounds:** New **Play answer feedback sounds** checkbox in Settings. Disabled by default. If enabled, plays two very short quiet pitches for correct/incorrect answers. Does not change spoken pronunciation or TalkBack feedback.
- **Versioned service worker:** Cache v1.5 so installed phones can retrieve the new assets without clearing their study history.

## Uploading

For the **root-only ZIP**, extract and upload all files from the archive at:
https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

No API upload is needed for this release. The **complete ZIP** also includes the unmodified `api/lookup.js` and other supporting assets for archival backup.

## Notes and caveats

The improved answer choice layout from v1.4 is retained without changing the answer controls. The intermittent TalkBack speech sequence "Next word. Button. Incorrect." remains a test item; its appearance on actual devices has not been reproduced locally. A real Android/TalkBack check is still needed. Browser end-to-end testing was blocked by local browser-navigation restrictions; JavaScript syntax, DOM references, and the example-selection parser were checked locally.

## Preserving saved progress

Storage keys are unchanged: `vocabTrackerKeysV01`, `vocabTrackerProgressV01`, `vocabTrackerSettingsV01`, and `vocabTrackerActiveSessionV01`. Do not clear browser/app data during update. Install onto the **same Vercel origin**.
