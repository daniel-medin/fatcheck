# AGENTS.md

Guidance for coding agents working on Fat Check.

## Project Shape

Fat Check is a static site. There is no build step and no package manager.

Primary files:

- `index.html` for markup.
- `styles.css` for layout and visual design.
- `app.js` for BitStore sync, calculations, chart rendering, and UI behavior.
- `assets/logo.svg` for the app icon.

## Runtime Dependencies

The app loads these browser libraries from CDNs:

- Chart.js for the weekly graph.
- Lucide for UI icons.

Do not introduce a bundler or framework unless the user explicitly asks for one.

## BitStore Rules

Do not commit a BitStore write key or a private bucket slug.

The app stores BitStore setup locally in browser `localStorage`:

- `fat-check.bucket-slug`
- `fat-check.write-key`

Records are fetched from:

```text
https://bitstorehome.azurewebsites.net/api/buckets/{slug}/records
```

Calories are stored as one daily total record per day:

```text
<day-code>:<kcal>
```

Example:

```text
g4c:1200
```

The app should update today's existing daily record when adding calories. Do not create one BitStore record per add.

Legacy plain numeric calorie values may still exist. Keep read support for them, but prefer daily records for new writes.

App settings use prefixed records:

- `g<number>` for daily intake goal.
- `b<number>` for daily burnrate.

BitStore values are limited to 8 characters, so keep persisted values compact.

## UX Notes

The app should feel mobile-first:

- Keep controls compact and thumb-friendly.
- Use icon buttons for settings, goal, burnrate, refresh, delete, and reset.
- Keep text inside buttons and panels from overflowing on narrow screens.
- The settings modal is opened from the key icon in the header.

The graph should show:

- Daily calories as bars.
- Running weekly calories as a green line.
- Daily goal as a red line.
- Weekly goal as a red dashed line.

## Calculations

The week is Monday-Sunday.

Daily goal is an intake target. Weekly goal is:

```text
daily goal * 7
```

Burnrate is the zero line for estimated weight change:

```text
weekly deficit = burnrate * 7 - calories eaten this week
weight change = weekly deficit / 3500
```

Display the weight line as:

```text
weightloss this week x.x Kg
```

## Verification

Before finishing changes:

- Run `node --check app.js` after JavaScript edits.
- Serve locally and check `http://127.0.0.1:4173/` for static page loading.
- If layout changed, take a small mobile-width browser screenshot.
- Confirm no secrets are present with a text search before committing.
