# Vocabulary Builder v1.7 — Curriculum Definition Audit

Based on the complete v1.6 source, with the interface, four-answer layout, audio, and progress-storage keys preserved.

## Editorial changes

- Reviewed and rewrote a primary teaching definition for **each of the 1,155 built-in curriculum words**, storing it with the corresponding existing example sentence in `study-content.js`. Every primary teaching definition is short enough for the existing four-choice layout: at most 96 characters and 16 words.
- Primary quiz choices for built-in words now come from these authored teaching definitions rather than potentially obscure or incomplete Merriam-Webster supplementary glosses. Thus the answer choice and post-answer definition are the same, and each is paired with its curriculum sentence.
- Fixed identified sense mismatches, including `objective` (goal, not impartial), `alternate` (alternative route, not alternating actions), `deduction` (tax deduction, not logical inference), `stress` (emphasis in speech, not psychological strain), `reconciliation` (bank records, not repairing a relationship), `thesis` (academic research work), `prosecution` (legal team), `prospective` (future applicant), `disguise` (noun), `reprimand` (noun), `bargain` (verb), and `intrigue` (verb).
- Filters external dictionary definitions that appear truncated or incomplete, including phrases ending in **“such as”**, **“including”**, and similar dangling introductions, before those definitions can be used as choices or supplemental meanings.
- Improved part-of-speech selection for several ambiguous headwords while preserving Merriam-Webster pronunciation recordings and other reference detail.
- Normalized external dictionary lookup spellings for five older curriculum IDs (`fulltime`, `parttime`, `runon`, `deescalate`, `cashflow`) without changing their progress IDs.
- Correctly labels original Vocabulary Builder teaching definitions as app-authored rather than crediting them to Merriam-Webster.

## Uploading to GitHub

The recommended root-only ZIP contains **seven** files. Extract it and upload all seven to:

https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

`study-content.js` is a **new root file** and must be included. The other six files replace existing root files. Vercel should redeploy after committing to the connected `main` branch. **Do not upload the ZIP without extracting it.**

The API in `api/lookup.js` is unchanged; no visit to the API folder is necessary. The complete ZIP includes all 15 runtime/project files for backup.

## Validation

- 1,155 / 1,155 curated headwords have a definition and matching example sentence in the content bank; no missing entries or duplicate keys.
- No curated answer definitions exceed 96 characters / 16 words, and automated checks exclude incomplete trailing phrases.
- A browser-based test exercised every built-in word through the same dictionary parsing function used by the app, deliberately supplying incomplete Merriam-Webster-style data. All 1,155 selected their authored teaching definition and expected sentence; no exceptions.
- A simulated mobile practice round displayed four distinct buttons, correctly populated the answer-result definition and example, and generated no JavaScript page errors.
- A word-detail test of `sanction` showed the penalty sense for the core sentence and an independently illustrated approval sense in the expandable list.
- JavaScript syntax checks passed.

## Remaining limitations

This is an in-depth editorial pass on **primary curriculum senses**, not an independent professional lexicography review of all possible meanings. New custom words outside the curated 1,155 still rely on validated Merriam-Webster short definitions; those without dependable sense-linked examples may be skipped. External dictionary API responses and real Android TalkBack behavior were not tested live. Continue reporting any subtle context mismatches, especially in unusual secondary meanings.

## Preserve data

Existing progress and key-storage identifiers remain unchanged: `vocabTrackerKeysV01`, `vocabTrackerProgressV01`, `vocabTrackerSettingsV01`, `vocabTrackerActiveSessionV01`. Avoid clearing app storage.
