# SpatialPosters for Windows + Jellyfin

A Windows desktop build of [SpatialPosters](https://github.com/TheAceOfficials/SpatialPosters) that designs posters and uploads them straight into your **Jellyfin** server.

## Getting started

1. Run **`SpatialPosters.exe`**. It's portable, so there's nothing to install.
2. Open **Settings** and add your TMDB API key (free at themoviedb.org → Settings → API).
3. Open **Jellyfin** in the sidebar and enter your server URL (e.g. `http://192.168.1.10:8096`) and an API key. Create the key in Jellyfin under **Dashboard → API Keys → +**.
4. Pick a library, then:
   - **Design** opens the poster editor for that title. Save your design, then press **Send to Jellyfin**.
   - **Send** uploads a poster using your saved design, or your default style if you haven't designed that title.
   - **Send all to Jellyfin** does the whole library, or the current search.

Posters are uploaded as the item's primary image, so Jellyfin serves them itself. **SpatialPosters doesn't need to be running** for them to show up.

> If a Jellyfin library scan has *Replace existing images* turned on, it will overwrite uploaded posters. Leave that off for libraries you design.

Your data (designs, defaults, Jellyfin connection) lives in `%APPDATA%\SpatialPosters`.

## What's different from upstream

- Windows desktop app with Jellyfin upload.
- Security fixes: SSRF in the image proxy and poster routes, a PIN lock that wasn't enforced, and a broken addon proxy.
- Privacy: Reddit lookups are opt-in, Next.js telemetry is off, and the Patreon buttons are gone.
- Only Italy, the UK, the USA and Japan are offered as regions, and only Italian, English and Japanese as UI languages.

## Layout

| Folder | What's in it |
|---|---|
| `SpatialPosters.exe` | The app (built locally, not committed: it's over GitHub's 100 MB file limit) |
| `desktop/` | Electron shell and packaging scripts ([desktop/README.md](desktop/README.md)) |
| `web/` | The SpatialPosters Next.js app ([web/README.md](web/README.md)) |

## Building

Requires Node 22+.

```powershell
cd web; npm ci; cd ..\desktop; npm install
npm run dist        # builds web/, packages it, writes ..\SpatialPosters.exe
```

Licensed AGPL-3.0, like upstream.
