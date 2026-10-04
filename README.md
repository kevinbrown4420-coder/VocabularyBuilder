# Vocabulary Tracker v0.2

An accessibility-first personal vocabulary trainer designed for screen-reader use. It uses Merriam-Webster API lookups for official definitions and optional thesaurus information, while storing only study progress persistently.

## What v0.2 includes

- 100 starter headwords across five app-defined difficulty tiers.
- Four-choice practice: word → definition, definition → word, or mixed.
- Merriam-Webster official `shortdef` content for quiz choices.
- Optional synonyms and antonyms after each answer.
- Persistent mastery states: New → Learning → Familiar → Strong → Mastered.
- Due-review scheduling and same-session recycling of missed words, with explicit recycled-review counters and session summaries.
- Optional Focused Practice mode that removes global navigation/header/footer from the active quiz to reduce TalkBack swipe targets.
- Home dashboard, browseable word list, statistics, streaks, and progress backup/import.
- Semantic HTML, large native buttons, visible focus, live status regions, and no information conveyed by color alone.
- Installable PWA when hosted over HTTPS.
- API keys are not embedded in the project. You enter them in Settings on your own device.

## Important API design choice

Merriam-Webster's public API does not reliably support browser CORS, so the app calls a same-origin `/api/lookup` proxy. The proxy forwards a user-requested lookup and returns the response. It is coded not to cache the response.

The browser stores your API keys locally. The keys are sent to your own app's proxy in a POST body for each lookup, and then to Merriam-Webster as required by their API. The project's progress-export feature deliberately excludes the keys.

Merriam-Webster content is kept in memory for the current app session only. Definitions/thesaurus content are not placed in the app's persistent progress database.

## Quick local test on Windows

You need Node.js 18 or newer.

1. Extract this folder.
2. Open Terminal or Command Prompt in this folder.
3. Run: `npm start`
4. Open `http://localhost:3000` in a browser.
5. Open Settings in Vocabulary Tracker, paste your two API keys, save them, and choose **Test both keys**.

No `npm install` is needed because v0.2 has no third-party package dependencies.

A phone on the same Wi-Fi can usually open the computer's LAN IP on port 3000 after Windows Firewall permits Node, but installation as a PWA requires HTTPS. For normal phone use, deploy it to an HTTPS host such as Vercel.

## Vercel deployment

The project includes a Vercel-compatible serverless function at `api/lookup.js`. Deploy the folder as a project. No API key environment variables are required because the user enters keys locally in the app Settings screen.

After deployment:

1. Open the HTTPS site on Android Chrome.
2. Go to Settings and enter the two keys.
3. Choose **Test both keys**.
4. Use the browser's **Install app** / **Add to Home screen** command if the in-app Install button is not shown.

## Reference sources

The app is intended for use with:

- Merriam-Webster's Collegiate® Dictionary with Audio
- Merriam-Webster's Collegiate® Thesaurus

Merriam-Webster's branding guidelines require applications using its API to feature the Merriam-Webster logo. The Settings/About section loads the official logo directly from the branding-guidelines asset URL and names the two references used.

This is a personal noncommercial study project and is not endorsed by Merriam-Webster Inc.

## Files

- `index.html` — semantic UI
- `styles.css` — responsive/high-contrast styling
- `app.js` — game, progress, review scheduling, accessibility behavior
- `api/lookup.js` — Vercel same-origin Merriam-Webster proxy
- `dev-server.js` — dependency-free local development server and proxy
- `manifest.webmanifest` / `sw.js` — PWA installation and static offline shell
- `icon-192.png` / `icon-512.png` — app icons

## Known v0.2 limitations

- The starter vocabulary list is curated by the app, not supplied or difficulty-rated by Merriam-Webster.
- Pronunciation audio and usage examples are not yet surfaced.
- It does not persist Merriam-Webster definitions between browser sessions.
- The first time a new four-choice question appears, up to four dictionary lookups may be needed.
- Thesaurus lookup occurs only when you request it after answering.
- A later version should add a larger vetted word bank, user-selected review rules, pronunciation, and more question types.
