// SpatialPosters desktop shell.
//
// Runs the SpatialPosters Next.js server in an Electron utility process while
// the window is open. Posters are rendered and uploaded into Jellyfin (see the
// Jellyfin page), so nothing needs to keep running after you close the app.
//
// Admin routes (mappings, defaults, Jellyfin, …) require a token. A random one
// is generated on first run and injected only into requests coming from this
// app's own window.
const {
  app, BrowserWindow, Menu, dialog, session, shell, utilityProcess,
} = require("electron")
const crypto = require("node:crypto")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")

const APP_NAME = "SpatialPosters"
const DEFAULT_SETTINGS = { port: 7272, redditPosters: false }

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

let server = null
let win = null
let quitting = false

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
  const merged = { ...DEFAULT_SETTINGS, ...(readJson(settingsFile) || {}) }
  if (!Number.isInteger(merged.port) || merged.port < 1024 || merged.port > 65535) merged.port = DEFAULT_SETTINGS.port
  // Write back so the file exists and documents every option.
  writeJson(settingsFile, merged)
  return merged
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

const settings = loadSettings()
const secrets = loadSecrets()
const origin = `http://127.0.0.1:${settings.port}`

// ---------------------------------------------------------------------------
// Server process

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${origin}/api/live`, { timeout: 2000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on("error", retry)
      req.on("timeout", () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (!server) return reject(new Error("The poster server stopped during startup."))
      if (Date.now() > deadline) return reject(new Error("The poster server did not start in time."))
      setTimeout(attempt, 250)
    }
    attempt()
  })
}

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
  if (!(await portIsFree(settings.port))) {
    throw new Error(`Port ${settings.port} is already in use (is ${APP_NAME} already open?).\nYou can change "port" in:\n${settingsFile}`)
  }

  fs.mkdirSync(dataDir, { recursive: true })
  const log = openServerLog()
  const child = utilityProcess.fork(entry, [], {
    cwd: dir,
    serviceName: `${APP_NAME} server`,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(settings.port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      SPATIALPOSTERS_DATA_DIR: dataDir,
      SPATIALPOSTERS_ADMIN_TOKEN: secrets.adminToken,
      CONFIG_HMAC_SECRET: secrets.hmacSecret,
      SPATIALPOSTERS_REDDIT_POSTERS: settings.redditPosters ? "1" : "0",
      SPATIALPOSTERS_LOG_FORMAT: "human",
    },
  })
  server = child
  child.stdout?.on("data", (d) => log.write(d))
  child.stderr?.on("data", (d) => log.write(d))
  child.once("exit", (code) => {
    log.end(`\n[desktop] server exited with code ${code}\n`)
    if (server !== child) return
    server = null
    if (!quitting) {
      dialog.showErrorBox(APP_NAME, `The poster server stopped unexpectedly (code ${code}).\nLog: ${path.join(logDir, "server.log")}`)
      app.quit()
    }
  })

  await waitForServer(60_000)
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

// ---------------------------------------------------------------------------
// Window

function isAppUrl(url) {
  try { return new URL(url).origin === origin } catch { return false }
}

function openExternalSafe(url) {
  try {
    if (["https:", "http:", "stremio:"].includes(new URL(url).protocol)) shell.openExternal(url)
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
  win.once("ready-to-show", () => win.show())
  win.on("closed", () => { win = null })
  win.loadURL(origin)
}

// ---------------------------------------------------------------------------
// Lifecycle

app.on("second-instance", () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.on("window-all-closed", () => app.quit())
app.on("before-quit", () => { quitting = true })
app.on("will-quit", (event) => {
  if (!server) return
  event.preventDefault()
  stopServer().then(() => app.exit(0))
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  // Only requests from this app's own window carry the admin token.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    details.requestHeaders["x-admin-token"] = secrets.adminToken
    callback({ requestHeaders: details.requestHeaders })
  })
  try {
    await startServer()
  } catch (err) {
    quitting = true
    dialog.showErrorBox(APP_NAME, String(err instanceof Error ? err.message : err))
    app.quit()
    return
  }
  createWindow()
})
