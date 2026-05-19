# Netlify prototype for water outage notices

This folder contains a minimal Netlify site that receives outage announcements from the QGIS plugin and shows the latest published notice on a public page.

## Files

- `index.html`, `styles.css`, `app.js`: public page for the current announcement
- `netlify/functions/publish-outage.js`: POST endpoint used by the plugin
- `netlify/functions/get-current-outage.js`: GET endpoint for the site
- `netlify.toml`: Netlify config

## Deploy

1. Create a new Netlify site from this folder.
2. Let Netlify install dependencies from `package.json`.
3. Optional but recommended: add environment variable `NETLIFY_OUTAGE_SECRET`.
4. After deploy, copy the site URL, for example `https://example.netlify.app`.

## Plugin usage

In the QGIS dialog `Генерирай обявление`:

1. Paste the site URL in `Netlify URL`.
2. If you set `NETLIFY_OUTAGE_SECRET`, paste the same value in `Ключ за публикуване`.
3. Click `Публикувай в Netlify`.

The plugin will POST to:

`https://example.netlify.app/.netlify/functions/publish-outage`

The public page reads from:

`https://example.netlify.app/.netlify/functions/get-current-outage`
