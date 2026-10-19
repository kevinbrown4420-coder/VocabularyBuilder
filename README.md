# Vocabulary Builder v1.9 — Touch Exploration and Navigation Polish

**Scope:** Refine the existing quiz/results navigation without changing the successful four-answer buttons, vocabulary data, offline lessons, or users' saved progress.

## What's changed

- **Continuous reading surfaces:** On answer feedback, the word, meaning, and example occupy adjacent, edge-to-edge full-width content rows. Each has padding and a minimum 64 px height, so the accessible reading area is substantially larger than the glyphs themselves. These are real text/heading nodes, **not invisible buttons or clickable overlays**.
- **One accessible announcement per reading row:** The word (including part of speech where known), the meaning, and the example each have a single accessible name. Visual captions such as "Meaning" are hidden from the accessibility tree to avoid being announced twice. Each row can be reached by keyboard Tab as well as touched and explored with a screen reader. Users can still navigate by headings and content.
- **Fewer nested region announcements:** Removed redundant quiz-card and results-panel `role="region"` and the extra `role="group"` around answer choices, while retaining the main Practice screen/heading and the four distinct answer buttons.
- **Predictable first action:** "Next word" now follows immediately after the word, meaning, and example. Other actions and the collapsible additional meanings appear below the main action, instead of interrupting the core study path.
- **Focus hygiene:** Once an answer is chosen, its button is removed from the accessibility tree and blurred, and focus moves to the results heading. Next Word focuses the new prompt. This may reduce TalkBack's lingering old feedback, but the intermittent "Incorrect" speech still needs real-device confirmation.
- **Offline app shell:** Service worker cache increments to v1.9 to serve the updated HTML, CSS and JS together offline. Optional dictionary service remains unchanged.

## Unchanged

- All 1,155 curated teaching definitions, examples and vocabulary levels.
- Four-answer quiz layout, option selection and review scheduling.
- No registration or API key required for built-in offline practice.
- Existing progress and settings storage keys.
- `api/lookup.js` (no need to update the API folder), dictionary recording options, and optional answer sounds.

## Updating GitHub main

Extract the **root-files ZIP** and upload these six root files:

- `app.js`
- `index.html`
- `styles.css`
- `sw.js`
- `package.json`
- `README.md`

Upload page: https://github.com/kevinbrown4420-coder/VocabularyBuilder/upload/main

Only six root files are needed. The complete archive is a backup of the same full project. Do not upload the ZIP itself.

## Verification done

- All 1,155 words generated correct four-choice questions in both fixed directions (2,310 questions total), with zero network requests in the JS test harness.
- Browser-tested a mobile-width question -> result -> Next Word flow. No JS errors; focus moved to the result heading and next question prompt.
- Browser-measured all three reading rows as contiguous and full-width, each at least 64 px tall.
- Chrome accessibility tree exposed a single named paragraph node for the meaning and example, with no redundant quiz/result region roles.
- Simulated service-worker install and offline fetch verified all eight offline files cached, no API responses cached, and old app caches removed.

**Still requires device testing:** TalkBack touch exploration on actual Samsung/Android hardware, speaking behavior after wrong answers (especially the intermittent "Incorrect" announcement), JAWS/NVDA/VoiceOver navigation, and reopening the installed PWA after an update. The browser test was run with a self-contained page harness because this test environment blocks navigation to local HTTP URLs.

## Recommended phone checks

1. Update the app while online; confirm the offline pack is ready in Settings.
2. Complete one correct and one incorrect question. Slowly move a finger down the word, meaning, example, and Next Word; note any dead zones or repeated speech.
3. Try swipe-navigation and backtracking around Next Word, optional meanings, and Word Details.
4. Continue with airplane mode enabled and verify saved progress after reopening.

This release adds no analytics, sign-up, microtransactions, or paywalls.
