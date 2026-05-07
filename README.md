# Fat Check

Fat Check is a one-page calorie tracker for GitHub Pages. Records are stored in the BitStore bucket `fat-check`.

## BitStore

The app reads from:

```text
https://bitstorehome.azurewebsites.net/api/buckets/fat-check/records
```

The BitStore write key is embedded for this personal app so it can write from GitHub Pages without a backend.
