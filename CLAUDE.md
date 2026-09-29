# CLAUDE.md

Fork of [TheAceOfficials/SpatialPosters](https://github.com/TheAceOfficials/SpatialPosters) (itself a rebrand of Eful97/Pictorium), turned into a **Windows desktop app** that designs posters and **uploads them into Jellyfin**.

- Fork: `PietroCanovai/SpatialPosters` (`origin`), upstream remote: `upstream`. Work branch: `windows-app`.
- **Keep this file updated** whenever architecture, build steps, conventions or gotchas change. It's part of every change, not a follow-up.

## Rules

- **Only ever build the portable exe** (`desktop: npm run dist` → `SpatialPosters.exe` at the repo root). No NSIS/installer targets, no electron-builder `portable` target (see Startup below).
- `SpatialPosters.exe` is gitignored (over GitHub's 100 MB limit). Never commit it.
- Regions are limited to **IT, US, GB, JP**. UI languages are limited to **it, en, ja**. Don't re-add others (`web/src/lib/regions.ts`, `utils.ts` `UI_LANGUAGES`, `i18n.ts`, `flixpatrol.ts` `SUPPORTED_COUNTRIES`).
- No telemetry: keep `NEXT_TELEMETRY_DISABLED=1` in builds and Electron `spellcheck: false` (it downloads dictionaries from Google). Reddit lookups stay opt-in (`SPATIALPOSTERS_REDDIT_POSTERS=1`).
- **Jellyfin only.** Everything Stremio / Nuvio / addon / catalog / install-hub, plus the hosted-service backends (Cloudinary, ImgBB, R2, Upstash/Vercel KV, Docker/Vercel/HF deploy files) has been removed. Don't bring any of it back. Data providers stay: TMDB (required), MDBList (ratings), JustWatch/FlixPatrol/Wikidata (badges).
- No SpatialPosters marketing/branding UI (no animated "SPATIAL" word, no tagline, no Patreon/Instagram/GitHub-star footers). A plain logo on the home page is fine.
- Comments in `web/` are Italian (upstream style). Match the surrounding file. `desktop/` is English.

## Layout

```
SpatialPosters.exe   built portable app (gitignored)
desktop/             Electron shell, launcher, packaging scripts
  main.cjs           main process: splash → start server → load app
  launcher/Launcher.cs   portable self-extracting launcher (C#)
  scripts/prepare-server.mjs  next build + assemble desktop/server
  scripts/after-pack.cjs      restore node_modules electron-builder strips
  scripts/build-portable.mjs  zip + compile launcher + stitch exe
web/                 upstream Next.js 16 app (moved here from repo root)
.github/workflows/   CI, runs in web/ (defaults.run.working-directory)
```

## Commands

```powershell
# web app
cd web; npm ci
npx tsc --noEmit
npx vitest run            # whole suite; must stay green
npx eslint <files you touched>   # upstream has ~70 pre-existing lint errors elsewhere
# desktop
cd desktop; npm install
npm run dist              # full build → ..\SpatialPosters.exe (~1 min)
npm run build-and-start   # build web + run unpacked in Electron (dev)
```

Use `NEXT_TELEMETRY_DISABLED=1` when running Next/vitest by hand.

## Architecture

**Desktop shell (`desktop/main.cjs`).** It shows a splash window instantly, forks `resources/server/server.js` (Next standalone) in an Electron `utilityProcess` on `127.0.0.1:7272`, then loads the app and clears history (so Back never returns to the splash). Mouse back/forward buttons arrive as `app-command` events and Alt+Left/Right as key input; the shell maps both to `navigationHistory.goBack/goForward` (Electron does nothing with them by default). Minimum window width is 1100 px because the editor grid collapses below a 1024 px viewport. Closing the window quits (no tray, no background server). Per-user state lives in `%APPDATA%\SpatialPosters`: `settings.json` (port, redditPosters), `secrets.json`, `data\`, `logs\server.log`.

**Auth.** The upstream admin routes require `SPATIALPOSTERS_ADMIN_TOKEN`. The shell generates a random token (`secrets.json`) and injects `x-admin-token` **only into requests from its own window** (`session.webRequest.onBeforeSendHeaders`). The web client never knows the token. `CONFIG_HMAC_SECRET` is generated there too.

**Startup / launcher.** electron-builder's portable target re-extracted ~110 MB to %TEMP% on every launch (9–12 s). Instead, `build-portable.mjs` builds `win-unpacked` (target `dir`), zips it, and appends it to a small C# launcher compiled with Windows' built-in `csc.exe` (.NET Framework 4.8). The trailer holds the zip offset/length, a 16-hex payload id (sha256 of the zip) and the magic `SPPAYLD1`. The exe is written to `SpatialPosters.exe.new` and renamed into place, so it is never half-written. A double-click during a rebuild used to hit a partial file and show "payload missing or corrupt". The launcher retries briefly, then reports the file path and size. It extracts once to `%LOCALAPPDATA%\SpatialPosters\app\<id>\` (marker `.complete`), deletes older ids, then starts it. Measured: first launch after a new build 5–8 s (unpack + delete old version), then ~0.6 s to server ready. `electronLanguages` keeps only en-US/en-GB/it/ja Chromium locales.

**Provider API keys.** Settings → **API keys** tab (`web/src/components/ProviderKeysPanel.tsx`) → `PUT /api/provider-keys` validates each key with the provider and saves it to `data/provider-keys.json`. Only TMDB and MDBList: TVDB was used only for Stremio episode ordering and was removed. Upstream reads keys only from env (~20 call sites), so `lib/provider-keys.ts` applies saved keys to `process.env.SPATIALPOSTERS_{TMDB_KEY,MDBLIST_KEY}`. That happens at boot (`src/instrumentation.ts`) and on save. The client syncs them via `/api/defaults` `serverKeys` (server wins over localStorage, `lib/context.tsx`).

**Jellyfin.** `lib/jellyfin.ts` (server client, auth header `MediaBrowser … Token="…"`), routes under `app/api/jellyfin/*` (all admin-only), page `app/jellyfin` + `components/JellyfinView.tsx`. The editor's only action is **Send to Jellyfin**: it saves the design (if a poster was picked) and calls `POST /api/jellyfin/push` with `{ tmdbId, mediaType }`; the route finds every library item with that TMDB id (`findItemsByTmdb`: `AnyProviderIdEquals=Tmdb.<id>`, verified, falling back to a cached full-library scan). The Jellyfin page sends `{ itemId }`. Push = render through the normal poster route on loopback (`buildPosterRenderUrl` in `lib/poster-render-url.ts` with the saved mapping + server defaults, `fmt=jpeg`, TMDB key in the `x-api-key` header). The result is POSTed **base64** to `/Items/{id}/Images/Primary`. Jellyfin then serves posters without this app. The poster canvas is fixed at 500×750 (`STD_W/STD_H`) across the renderer.

**Navigation.** Every screen is a real Next route: `/` (HomeView), `/search?q=`, `/myposters`, `/movie/[id]` + `/tv/[id]` (editor, `PosterEditorContainer` → `openPoster`), `/jellyfin`, `/settings`, `/status`. Opening a title is `navigateToPoster` = `router.push(editorHref)` (the clicked result's title is stashed in sessionStorage to show immediately). Upstream used fake in-page "views" with hand-made `history.pushState`, which desynced the browser history from Next's router — don't reintroduce that. `BackButton` = `router.back()` (home only when there's no history). All pages share `AppShell` (sidebar, language picker, PIN lock), which renders its children only after mount (client state from localStorage made SSR hydration fail).

**Editor preview & transform.** The preview URL carries `nologo=1` and omits the logo scale/offset: the server render has no logo, and `PosterPreview` draws the logo as a client layer with the same `computeLogoLayout` the server uses, so moving the logo never re-renders. Poster zoom/pan (`pscale` 100–300 %, `pox`/`poy` px of the 500×750 canvas; mapping fields `posterScale/posterOffsetX/posterOffsetY`) is applied server-side where the poster is fitted to the canvas (`posterCropWindow` in `lib/poster-config.ts`). The editor commits it to the URL debounced (250 ms); while the live values differ from the displayed render's (`loadedUrl`), `PosterPreview` shows the raw artwork cropped with the same `posterCropWindow` via CSS.

**UI details.** Poster tiles show the TMDB original's resolution (`PosterBtn`). Horizontal chip rows (`.scroll-fade-mask`) fade an edge only where content is actually hidden (`ScrollFadeManager` sets `data-fade-left/right`). Native `<select>` popups need `color-scheme: dark` (set in `globals.css`) or Chromium draws them light. Inter is loaded from `@fontsource`, never Google Fonts. `next.config.ts` sets `agentRules: false` so `next dev` doesn't generate AGENTS.md/CLAUDE.md in `web/`.

**SSRF.** User-supplied URLs (poster/logo/backdrop query params, proxy-image, resolve-image, og:image) go through `lib/safe-fetch.ts` (`fetchPublicUrl`): resolved-IP checks on every redirect hop plus a DNS-pinned undici Agent. URLs built from `TMDB_IMG_URL`/IMG_BASE are trusted. The Jellyfin URL is admin-configured (usually a LAN IP), so it deliberately bypasses safe-fetch.

## Gotchas (each cost real debugging time)

- **electron-builder strips every `node_modules` folder from `extraResources`**, including `server/.next/node_modules`. That folder holds Turbopack's hashed aliases (`sharp-<hash>`, `@resvg/resvg-js-<hash>`). Without it every image route and static file 500s ("Failed to load external module sharp-…"), which shows up as broken sidebar icons. `after-pack.cjs` copies all of them back.
- **Next file tracing drops sharp's `libvips-*.dll`**, and the `.next/node_modules` aliases are junctions pointing into `web/node_modules`. `prepare-server.mjs` copies with `dereference: true` and copies `@img/*`, `@resvg/*` in full.
- **undici:** passing an npm-undici `Agent` to Node's built-in `fetch` fails ("invalid onRequestStart method"). `safe-fetch.ts` uses undici's own `fetch` with its `Agent`, and `undici` is a declared dependency. Under Vitest it falls back to global `fetch` so mocks apply.
- **Windows file locks:** if a shell's cwd is inside `desktop/server` or `dist`, `rm`/`rmSync` fails with EPERM/EBUSY. `cd` out first. Kill `SpatialPosters.exe` before rebuilding.
- Port 7272 in use means another instance is running (the shell shows an error). Tests that launch the exe must `taskkill //IM SpatialPosters.exe //F` afterwards.
- Don't write C#, Markdown paths or other backslash-heavy text through Python/bash heredocs or `node -e`: escape sequences like `\n`, `\a` (as in `\app`) and `\0` get turned into real newline, bell and NUL characters. Use the Write/Edit tools or a script file, then check for control characters.
- A `next build` regenerates `web/src/generated/app-version.ts` and `web/src/lib/render-version.ts`. Commit them; the render version busts poster caches.

## Testing without real services

- UI with real TMDB data: run `next dev` with `SPATIALPOSTERS_DATA_DIR` pointing at a scratch copy of the data folder containing only `provider-keys.json` (never the user's Jellyfin config), then drive it with an offscreen Electron script (set `preferred_lang` and `spatial_onboarding_done` in localStorage first). Pass script parameters via an env var: Electron's default launcher treats a URL argument as something to open.

- TMDB/JustWatch/Wikidata/IMDb: `web/e2e/mock-server.mjs` (port 8790). Point the app at it with `TMDB_BASE_URL`, `TMDB_IMG_URL`, `JUSTWATCH_API_URL`, `WIKIDATA_SPARQL_URL`, `IMDB_CHART_URL`. The Electron shell passes its env through, so this works against the real `SpatialPosters.exe`.
- Jellyfin: a small Node HTTP mock implementing `/System/Info`, `/Library/MediaFolders`, `/Items`, `/Items/{id}/Images/Primary` (GET + base64 POST) is enough for an end-to-end push. Check the upload decodes to a JPEG.
- The admin token for curl is in `%APPDATA%\SpatialPosters\secrets.json` (`adminToken`). Delete any test `data\jellyfin.json` / `provider-keys.json` afterwards; that folder is the user's real data.
- Screenshots: render offscreen with a throwaway Electron script (`webPreferences.offscreen`, `capturePage`). Never screen-capture the desktop: it can capture the user's other windows.

## Upstream security/bug fixes carried by this fork

SSRF in the image routes; a UI-set PIN that was never enforced, plus forgeable session secrets; admin token accepted as a PIN / in a query string; undici Agent/fetch mismatch; Patreon CTAs removed; Reddit made opt-in; English award badges read "Oscar Winner" / "BAFTA Nominee" (upstream: "Winner Oscar"). Keep these when merging upstream.
