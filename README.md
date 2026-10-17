# Vocabulary Builder v1.4

Vocabulary Builder is an accessibility-first vocabulary study PWA. v1.4 keeps the Magoosh-style one-word/four-choice operation that tested well and rebuilds the content layer around a much smaller, deliberately useful study bank.

## New in v1.4: Teaching context and pronunciation

- Answer feedback presents a relevant Merriam-Webster example immediately below the meaning when available; it prefers complete example sentences. Shorter dictionary illustrations are labeled *Usage example* instead of being described as full sentences.
- Word Details now includes up to three examples for the taught meaning, syllable divisions, pronunciation playback, and collapsible word-origin information when available.
- Official Merriam-Webster recorded pronunciation plays when provided; a clearly labeled device-generated speech alternative is used when a recording is missing or cannot play.
- Examples from unrelated dictionary senses are deliberately excluded. When the dictionary does not provide a suitable example, the app does not fabricate one.
- This release does not change storage keys, your saved words, or the v1.3 curated curriculum.

## Curated study bank

The former 5,000-word pool mixed curated vocabulary with thousands of generic dictionary headwords. v1.3 replaces it with 1,155 study words selected for vocabulary-building value rather than raw coverage.

The five levels now emphasize:

1. **Core** — familiar words worth knowing precisely, commonly confused distinctions, reasoning, writing, and professional language.
2. **Intermediate** — analytical, academic, communication, and professional vocabulary.
3. **Advanced** — sophisticated rhetorical, literary, abstract, and professional vocabulary.
4. **Expert** — difficult but still broadly useful educated vocabulary.
5. **Challenge** — genuinely rare, literary, or esoteric vocabulary for deliberate expansion.

Random concrete nouns, anatomy and disease terms, demonyms, obvious compounds, and specialist filler have been removed from ordinary study. Examples of removed filler include `ledger`, `porch`, `intestine`, `molasses`, `passport`, `washer`, and `gastrocnemius`. Words the user saved in earlier versions remain available as Saved words even if they are no longer in the curated curriculum.

## Better teaching definitions

Definitions remain authoritative Merriam-Webster data rather than generated definitions.

- When the Collegiate API includes its learner-oriented `suppl.ldq` definition block, the app prefers that plain-English wording for study.
- When several exact Merriam-Webster entries match a headword, the app ranks them for teaching usefulness instead of blindly accepting the first response.
- Learner-oriented entries receive strong preference; clearly medical/anatomical/scientific specialist entries are penalized for ordinary vocabulary study.
- Circular definitions such as `elegant → marked by elegance` remain excluded.
- If the best useful definition is too long for an answer choice, the quiz changes direction rather than substituting an obscure secondary sense.
- Merriam-Webster supplemental examples are retained when available and shown in Word Details and under More about this word after an answer.

## Multiple-choice quality

- Distractors are normally pulled from outside the current round so they do not preview future target definitions.
- Recently used words and definitions are strongly deprioritized.
- Duplicate and semantically overlapping meanings are screened.
- Intentional missed-word repetition remains intact so review still reinforces learning.

## Study operation

- Choose Level 1-5 and practice begins immediately.
- One word or definition is presented with four large choices.
- Missed words return later in the same round.
- Result flow stays concise: Correct / Not quite, meaning, then Next word.
- Android Back stays inside the installed app and TalkBack receives destination context after navigation.

## Accessibility and appearance

- Part of speech is included in the focused word's accessible name without creating an extra TalkBack stop.
- System appearance is the default, with explicit Light and Dark overrides.
- No disabled primary controls and no user-facing `incorrect` result language.

## Persistent data

v1.4 preserves the established storage identifiers and production origin, so API keys, mastery data, Saved words, and study history remain in place across the update.

- `vocabTrackerKeysV01`
- `vocabTrackerProgressV01`
- `vocabTrackerSettingsV01`
- `vocabTrackerActiveSessionV01`

The existing batch-capable `api/lookup.js` does not need replacement for v1.4.
