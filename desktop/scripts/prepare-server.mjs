// Builds the Next.js app in standalone mode and assembles desktop/server/,
// which electron-builder ships as resources/server next to the app.
//
// Standalone output only contains the traced server files: static assets,
// public/ and the badge fonts (read via process.cwd()) are copied alongside.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const out = path.resolve(here, "..", "server")

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    // Next.js CLI telemetry is on by default; never send it from our builds.
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  })
  if (res.status !== 0) {
    console.error(`[prepare-server] ${cmd} ${args.join(" ")} failed (${res.status})`)
    process.exit(res.status ?? 1)
  }
}

const skipBuild = process.argv.includes("--skip-build")
if (!skipBuild) {
  if (!fs.existsSync(path.join(root, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"])
  run("npm", ["run", "build"])
}

const standalone = path.join(root, ".next", "standalone")
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("[prepare-server] .next/standalone/server.js not found — is output: 'standalone' enabled?")
  process.exit(1)
}

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(standalone, out, { recursive: true })
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true })
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true })
fs.cpSync(path.join(root, "src", "assets", "fonts"), path.join(out, "src", "assets", "fonts"), { recursive: true })

// Next's file tracing copies native .node addons but not the DLLs they load
// (sharp-win32-x64 needs libvips-*.dll next to its .node file). Copy the
// traced native packages in full from the root node_modules.
for (const scope of ["@img", "@resvg"]) {
  const tracedScope = path.join(out, "node_modules", scope)
  if (!fs.existsSync(tracedScope)) continue
  for (const pkg of fs.readdirSync(tracedScope)) {
    const src = path.join(root, "node_modules", scope, pkg)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tracedScope, pkg), { recursive: true })
  }
}

// Never ship local runtime data, test leftovers or env files that tracing may
// have picked up.
for (const p of ["data", "desktop", "test-results", ".env", ".env.local", ".env.production", ".env.production.local"]) {
  fs.rmSync(path.join(out, p), { recursive: true, force: true })
}

console.log(`[prepare-server] server assembled in ${path.relative(root, out)}`)
