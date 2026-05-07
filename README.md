# Fat Check

Fat Check is a one-page calorie tracker for GitHub Pages. Records are stored in a BitStore bucket configured locally in the browser.

## BitStore

The app reads from the bucket slug saved on the device:

```text
https://bitstorehome.azurewebsites.net/api/buckets/{your-slug}/records
```

The BitStore bucket slug and write key are not committed to this repository. Use the key button in the app to save them locally on each device.

Normal calorie records are stored as numbers. App settings are stored in the same bucket with prefixes:

- `g1200` means daily intake goal is 1200 kcal.
- `b2000` means burnrate is 2000 kcal/day.
