# Vocabulary Builder v1.2

Vocabulary Builder is an accessibility-first vocabulary study PWA. v1.2 preserves the v1.1 Magoosh-style study loop and focuses on definition quality and answer-choice variety.

## v1.2 definition-quality pass

- Rejects tautological word-family definitions for quiz use. A word such as **elegant** will not be taught with a definition such as **marked by elegance**. Useful base-word definitions such as **musical → of or relating to music** remain valid.
- Keeps Merriam-Webster sense order, but may skip a sense when it is pedagogically circular. It does not choose later senses merely because they are shorter.
- If no non-circular usable sense exists, the word is skipped for quiz purposes instead of presenting a definition that gives no useful meaning.
- Word Details still retains Merriam-Webster reference content; the stricter filter applies to what the quiz treats as a teaching definition.

## Less repetitive multiple choice

- Tracks the words and definitions used as answer choices across a long recent window.
- Strongly penalizes recently reused distractor words and near-duplicate recent definitions.
- Pulls distractors from outside the current round whenever possible, so a wrong answer does not preview the exact definition of a word that will become a target a few questions later.
- Pulls fresh distractors from the wider curriculum and strongly prefers the same or adjacent difficulty level.
- Repeated target words still keep the same correct meaning when they intentionally return for review.
- Existing duplicate-definition and semantic-overlap screening remains in place.

## Study operation

- Choose Level 1-5 and practice starts immediately.
- One word or definition is presented with four large choices.
- Missed words return later in the round.
- Result flow remains concise: Correct / Not quite, the useful meaning, then Next word.
- Android Back stays inside the app and screen headings orient TalkBack after navigation.

## Accessibility and appearance

- Part of speech is included in the focused word's accessible name without becoming an extra TalkBack stop.
- System appearance is the default, with explicit Light and Dark overrides.
- No disabled primary controls and no user-facing `incorrect` result language.

## Persistent data

v1.2 preserves the established storage identifiers and production origin, so API keys and study progress remain in place across the update.

- `vocabTrackerKeysV01`
- `vocabTrackerProgressV01`
- `vocabTrackerSettingsV01`
- `vocabTrackerActiveSessionV01`

The existing batch-capable `api/lookup.js` does not need replacement for v1.2.
