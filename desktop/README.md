# SpatialPosters for Windows

An Electron shell that runs the SpatialPosters Next.js server locally and shows it in a desktop window.

- The poster server keeps running in the **tray** when you close the window, so Stremio/Jellyfin can keep loading posters. Use **Quit** in the tray menu to stop it.
- Data (mappings, defaults, caches) lives in `%APPDATA%\SpatialPosters\data`. Logs are in `%APPDATA%\SpatialPosters\logs`.
- Default address: `http://127.0.0.1:7272`. To change the port, use tray → *Open settings file* and edit `port`, then restart.

## Tray options

| Option | Default | What it does |
|---|---|---|
| Allow access from other devices (LAN) | off | Binds to `0.0.0.0` so a TV/phone/Jellyfin server on your network can reach the posters and addon. The window then loads through your LAN IP, so the manifest URLs it generates work on other devices. Windows Firewall will ask once. |
| Reddit community posters | off | Enables the r/SpatialPosters tab in the editor. While it's on, every title you open is looked up on Reddit. |
| Start with Windows | off | Starts minimised to the tray. |

## Security model

On first run the app generates a random admin token and config-signing secret (`%APPDATA%\SpatialPosters\secrets.json`). The admin token is added **only to requests from the app's own window**. Other devices, and browsers pointed at the server, can read posters/catalogs/manifests but can't change mappings, defaults or cache. The optional PIN lock in Settings still works on top of this.

## Building

Requires Node 22+ and the root project's dependencies.

```powershell
cd desktop
npm install
npm run build-and-start   # build the Next.js server and launch the app
npm run dist              # -> dist\SpatialPosters Setup <ver>.exe and dist\SpatialPosters-<ver>-portable.exe
```

`npm run prepare-server` runs `next build` (with Next.js telemetry disabled), then assembles `desktop/server/` from `.next/standalone`, `.next/static`, `public/`, the badge fonts, and the full native packages (sharp's libvips DLLs aren't picked up by Next's file tracing). `scripts/after-pack.cjs` copies the server's `node_modules` into the package, because electron-builder always strips `node_modules` from `extraResources`.

The installers aren't code-signed, so SmartScreen will warn on first launch.
