// SpatialPosters desktop shell.
//
// Runs the Next.js standalone server in an Electron utility process and shows
// it in a window. The server keeps running in the tray when the window is
// closed, so Stremio/Jellyfin can keep fetching posters.
//
// Admin routes (mappings, defaults, cache, …) require a token. A random one is
// generated on first run and injected only into requests coming from this
// app's own window, so other devices on the LAN can read posters/catalogs but
// can't change your settings.
const {
  app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, session, shell, utilityProcess,
} = require("electron")
const crypto = require("node:crypto")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

const APP_NAME = "SpatialPosters"
const DEFAULT_SETTINGS = { port: 7272, lanAccess: false, redditPosters: false }

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.setAppUserModelId("io.github.pietrocanovai.spatialposters")

const userData = app.getPath("userData")
const dataDir = path.join(userData, "data")
const logDir = path.join(userData, "logs")
const settingsFile = path.join(userData, "settings.json")
const secretsFile = path.join(userData, "secrets.json")
const startHidden = process.argv.includes("--hidden")

let settings = loadSettings()
const secrets = loadSecrets()
let server = null
let serverLog = null
let win = null
let tray = null
let quitting = false
let trayHintShown = false

// ---------------------------------------------------------------------------
// Persistence

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) } catch { return null }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8")
  fs.renameSync(tmp, file)
}

function loadSettings() {
  const saved = readJson(settingsFile) || {}
  const merged = { ...DEFAULT_SETTINGS, ...saved }
  if (!Number.isInteger(merged.port) || merged.port < 1024 || merged.port > 65535) merged.port = DEFAULT_SETTINGS.port
  return merged
}

function saveSettings() {
  writeJson(settingsFile, settings)
}

function loadSecrets() {
  const saved = readJson(secretsFile) || {}
  const next = {
    adminToken: saved.adminToken || crypto.randomBytes(32).toString("hex"),
    hmacSecret: saved.hmacSecret || crypto.randomBytes(32).toString("hex"),
  }
  if (next.adminToken !== saved.adminToken || next.hmacSecret !== saved.hmacSecret) writeJson(secretsFile, next)
  return next
}

// ---------------------------------------------------------------------------
// Networking helpers

/** Best-guess LAN IPv4, skipping virtual adapters (Hyper-V, WSL, VPNs, VMs). */
function lanAddress() {
  const skip = /vethernet|virtualbox|vmware|wsl|hyper-v|loopback|tailscale|zerotier|docker/i
  const candidates = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) candidates.push(a.address)
    }
  }
  const rank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)
  return candidates.sort((a, b) => rank(a) - rank(b))[0] || null
}

function appHost() {
  return settings.lanAccess ? (lanAddress() || "127.0.0.1") : "127.0.0.1"
}

function appOrigin() {
  return `http://${appHost()}:${settings.port}`
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/live", timeout: 2000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on("error", retry)
      req.on("timeout", () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (!server) return reject(new Error("Server process exited during startup"))
      if (Date.now() > deadline) return reject(new Error("Server did not start in time"))
      setTimeout(attempt, 300)
    }
    attempt()
  })
}

// ---------------------------------------------------------------------------
// Server process

function serverDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "server")
}

function openServerLog() {
  fs.mkdirSync(logDir, { recursive: true })
  const file = path.join(logDir, "server.log")
  try { fs.renameSync(file, path.join(logDir, "server.previous.log")) } catch { /* first run */ }
  return fs.createWriteStream(file, { flags: "a" })
}

async function startServer() {
  const dir = serverDir()
  const entry = path.join(dir, "server.js")
  if (!fs.existsSync(entry)) {
    throw new Error(`Server bundle not found at ${entry}.\nRun "npm run prepare-server" in the desktop folder first.`)
  }
  const bindHost = settings.lanAccess ? "0.0.0.0" : "127.0.0.1"
  if (!(await portIsFree(settings.port, bindHost))) {
    throw new Error(`Port ${settings.port} is already in use.\nChange "port" in ${settingsFile} and restart.`)
  }

  fs.mkdirSync(dataDir, { recursive: true })
  serverLog = openServerLog()

  server = utilityProcess.fork(entry, [], {
    cwd: dir,
    serviceName: `${APP_NAME} server`,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(settings.port),
      HOSTNAME: bindHost,
      NEXT_TELEMETRY_DISABLED: "1",
      SPATIALPOSTERS_DATA_DIR: dataDir,
      SPATIALPOSTERS_ADMIN_TOKEN: secrets.adminToken,
      CONFIG_HMAC_SECRET: secrets.hmacSecret,
      SPATIALPOSTERS_REDDIT_POSTERS: settings.redditPosters ? "1" : "0",
      SPATIALPOSTERS_LOG_FORMAT: "human",
    },
  })
  const log = serverLog
  server.stdout?.on("data", (d) => log.write(d))
  server.stderr?.on("data", (d) => log.write(d))
  const child = server
  server.once("exit", (code) => {
    log.end(`\n[desktop] server exited with code ${code}\n`)
    if (server !== child) return
    server = null
    if (!quitting) {
      dialog.showErrorBox(APP_NAME, `The poster server stopped unexpectedly (code ${code}).\nSee ${path.join(logDir, "server.log")}`)
    }
  })

  await waitForServer(settings.port, 60_000)
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve()
    const child = server
    server = null
    const timer = setTimeout(resolve, 5000)
    child.once("exit", () => { clearTimeout(timer); resolve() })
    child.kill()
  })
}

async function restartServer() {
  await stopServer()
  try {
    await startServer()
    installAdminHeader()
    if (win) win.loadURL(appOrigin())
  } catch (err) {
    dialog.showErrorBox(APP_NAME, String(err instanceof Error ? err.message : err))
  }
  rebuildTrayMenu()
}

// Only requests from this app's own window carry the admin token.
function installAdminHeader() {
  const urls = [`http://127.0.0.1:${settings.port}/*`]
  const lan = lanAddress()
  if (lan) urls.push(`http://${lan}:${settings.port}/*`)
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    details.requestHeaders["x-admin-token"] = secrets.adminToken
    callback({ requestHeaders: details.requestHeaders })
  })
}

// ---------------------------------------------------------------------------
// Window

function isAppUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === "http:" && String(u.port) === String(settings.port) &&
      (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === lanAddress())
  } catch { return false }
}

function openExternalSafe(url) {
  try {
    const { protocol } = new URL(url)
    if (["https:", "http:", "stremio:", "mailto:"].includes(protocol)) shell.openExternal(url)
  } catch { /* ignore malformed */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#09090b",
    title: APP_NAME,
    icon: path.join(__dirname, "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium downloads Hunspell dictionaries from Google when spellcheck is on.
      spellcheck: false,
    },
  })
  win.setMenuBarVisibility(false)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" }
    openExternalSafe(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      openExternalSafe(url)
    }
  })

  win.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true
      new Notification({ title: APP_NAME, body: "Still running in the tray so your posters keep working." }).show()
    }
  })
  win.once("ready-to-show", () => { if (!startHidden) win.show() })
  win.loadURL(appOrigin())
}

function showWindow() {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ---------------------------------------------------------------------------
// Tray

function rebuildTrayMenu() {
  if (!tray) return
  const lan = lanAddress()
  const local = `http://127.0.0.1:${settings.port}`
  tray.setToolTip(`${APP_NAME} — ${server ? "running" : "stopped"} on ${settings.lanAccess && lan ? `${lan}:${settings.port}` : local}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${APP_NAME}`, click: showWindow },
    { type: "separator" },
    { label: server ? `Serving at ${appOrigin()}` : "Server stopped", enabled: false },
    {
      label: "Allow access from other devices (LAN)",
      type: "checkbox",
      checked: settings.lanAccess,
      click: async (item) => {
        settings.lanAccess = item.checked
        saveSettings()
        await restartServer()
      },
    },
    {
      label: "Reddit community posters (r/SpatialPosters)",
      type: "checkbox",
      checked: settings.redditPosters,
      click: async (item) => {
        settings.redditPosters = item.checked
        saveSettings()
        await restartServer()
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] }),
    },
    { type: "separator" },
    { label: "Restart server", click: restartServer },
    { label: "Open data folder", click: () => shell.openPath(dataDir) },
    { label: "Open logs folder", click: () => shell.openPath(logDir) },
    { label: "Open settings file", click: () => { saveSettings(); shell.openPath(settingsFile) } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit() } },
  ]))
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.on("click", showWindow)
  rebuildTrayMenu()
}

// ---------------------------------------------------------------------------
// Lifecycle

app.on("second-instance", showWindow)
app.on("window-all-closed", () => { /* keep running in tray */ })
app.on("before-quit", () => { quitting = true })
app.on("will-quit", (event) => {
  if (!server) return
  event.preventDefault()
  stopServer().then(() => app.exit(0))
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  createTray()
  try {
    await startServer()
  } catch (err) {
    dialog.showErrorBox(APP_NAME, String(err instanceof Error ? err.message : err))
    quitting = true
    app.quit()
    return
  }
  installAdminHeader()
  rebuildTrayMenu()
  createWindow()
})
