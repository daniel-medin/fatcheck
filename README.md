# Fat Check

Fat Check is a no-build, one-page calorie tracker for GitHub Pages. It feels like a small mobile app and stores data in a BitStore bucket configured locally in each browser.

Live app:

```text
https://daniel-medin.github.io/fatcheck/
```

## Features

- Add calorie entries from a mobile-style UI.
- Track the current Monday-Sunday week.
- Set a daily intake goal.
- Set a daily burnrate.
- Show daily calorie bars, cumulative weekly intake, daily goal, and weekly goal in one chart.
- Estimate weekly weight change from burnrate and calories eaten.
- Reset calorie entries with a `reset` confirmation.
- Keep BitStore bucket slug and write key local to the browser.

## BitStore Setup

Open the key icon in the app header and save:

- Bucket slug, for example `fat-check`
- Write key from BitStore

The app reads from the saved bucket slug:

```text
https://bitstorehome.azurewebsites.net/api/buckets/{your-slug}/records
```

The bucket slug and write key are not committed to this repository. A public link to the app will not show private bucket data unless that browser has a bucket slug saved locally.

BitStore guide:

```text
https://bitstorehome.azurewebsites.net/HowTo
```

## Data Format

Normal calorie records are stored as numbers:

```text
450
1200
```

App settings are stored in the same bucket with short prefixes:

- `g1200` means daily intake goal is 1200 kcal/day.
- `b2000` means burnrate is 2000 kcal/day.

BitStore values are limited to 8 characters, so settings use compact records.

## Weight Math

Burnrate is treated as the zero line.

```text
weekly deficit = burnrate * 7 - calories eaten this week
weight change = weekly deficit / 3500
```

Example:

```text
burnrate = 2000 kcal/day
weekly burnrate = 14000 kcal
eaten this week = 5700 kcal
deficit = 8300 kcal
estimated weightloss = 2.4 Kg
```

## Development

This is a static site:

- `index.html`
- `styles.css`
- `app.js`
- `assets/logo.svg`

Run locally with any static server:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/
```

GitHub Pages deploys from `.github/workflows/pages.yml`.
