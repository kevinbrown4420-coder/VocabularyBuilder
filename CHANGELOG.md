# Release log and accessibility testing notes

## 2.0 Alpha 1 — More reliable multiple-choice questions

**Problem:** Some incorrect answers were awkwardly phrased, grammatically unlike the correct answer, or too close in meaning. The engine only looked at 12 candidates before scoring them.

**Change:** Search a larger offline candidate pool, score grammatical form and approximate length, screen overlapping alternative meanings, avoid a conservative set of near-equivalent words, and select three varied wrong answers. Keep the visual/audio interaction of v1.9 unchanged.

**Automated verification:**

- All 1,155 reviewed words have an offline teaching definition and sentence.
- All 1,155 words generate four distinct options in each of two fixed modes (2,310/2,310 passed) without network requests.
- Near-equivalent exclusions and alternative-meaning checks remain part of automated QA.
- Legacy saved mastery and totals successfully loaded and saved again in tests.
- Service worker version and eight offline cached assets checked.

**Mobile browser smoke test:** 412 px width, Chrome accessibility tree. Four choices; after answering, the word, definition, and example remain adjacent, substantial reading targets. Next Word moves focus to the new prompt. No JavaScript errors observed.

**Requires further field testing:** Actual TalkBack and VoiceOver touch exploration; continuous usage over many rounds; subjective question plausibility and false alternatives; installed PWA update/resume behavior. This is not a claim of WCAG conformance or a complete professional linguistic audit.

## 1.9 — Touch exploration improvements (baseline)

Continuous results-screen reading surfaces, fewer redundant region announcements, and predictable Next Word location. Real-user feedback indicated a noticeable reduction in unwanted TalkBack announcements. Preserve this improvement as a regression benchmark.

## 1.8 — Offline practice (baseline)

All built-in curriculum words can be studied without an account, internet connection, or dictionary key after caching the app. External dictionary features remain optional.

## Guiding principles

Core learning is free and usable without registration. No microtransactions or dark patterns. Improvements should solve measurable learning or accessibility problems without crowding the interface. Avoid adding recurring infrastructure costs before their benefits are demonstrated.
