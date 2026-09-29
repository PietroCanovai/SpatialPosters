# Desktop shell

Electron wrapper that runs the SpatialPosters Next.js server (from `../web`) in a utility process while the window is open. Closing the window quits the app. Posters are uploaded into Jellyfin, so nothing needs to keep running.

- Server: `http://127.0.0.1:7272`, loopback only.
- Data: `%APPDATA%\SpatialPosters\data`. Logs: `%APPDATA%\SpatialPosters\logs`.
- Settings: `%APPDATA%\SpatialPosters\settings.json`:
  - `port`, default `7272`
  - `redditPosters`, default `false`. When on, the editor shows posters from r/SpatialPosters, and every title you open is looked up on Reddit.

## Security model

On first run the app generates a random admin token and config-signing secret (`secrets.json`). The admin token is added **only to requests from the app's own window**. Anything else that reaches the port can't read or change your settings or Jellyfin connection. The Jellyfin API key is stored in `data\jellyfin.json` and is never sent to the browser side.

## Building

```powershell
npm install
npm run build-and-start   # build ../web and launch
npm run dist              # -> ..\SpatialPosters.exe (the only build target)
```

`npm run dist` builds only the portable exe. electron-builder produces `dist/win-unpacked` (target `dir`). `scripts/build-portable.mjs` zips it and appends it to a small launcher (`launcher/Launcher.cs`, compiled with the C# compiler that ships with Windows). On first launch the launcher unpacks the app once to `%LOCALAPPDATA%\SpatialPosters\app\<build id>`. Later launches start it directly: about 0.6 s to ready, versus 9–12 s with electron-builder's own portable format, which re-extracts on every run.

`scripts/prepare-server.mjs` runs `next build` in `../web` (telemetry disabled) and assembles `server/` from `.next/standalone`. It dereferences Turbopack's junctions to `sharp`/`resvg` and copies the native packages in full, because Next's tracing drops sharp's libvips DLLs. electron-builder strips every `node_modules` folder from `extraResources`, so `scripts/after-pack.cjs` copies them back. Without that, images and icons fail with `Failed to load external module sharp-<hash>`.

The exe isn't code-signed, so SmartScreen will warn on first launch.
