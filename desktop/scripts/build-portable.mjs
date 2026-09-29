// Builds the single portable ../SpatialPosters.exe from dist/win-unpacked:
//   1. zip win-unpacked
//   2. compile launcher/Launcher.cs with the C# compiler that ships with Windows
//   3. write [launcher][zip][trailer] to the repo root
// See launcher/Launcher.cs for why (fast startup) and the trailer format.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.resolve(here, "..")
const dist = path.join(desktop, "dist")
const unpacked = path.join(dist, "win-unpacked")
const zipFile = path.join(dist, "app.zip")
const launcherExe = path.join(dist, "launcher.exe")
const out = path.resolve(desktop, "..", "SpatialPosters.exe")

if (!fs.existsSync(path.join(unpacked, "SpatialPosters.exe"))) {
  console.error("[build-portable] dist/win-unpacked missing — run electron-builder --win dir first")
  process.exit(1)
}

// 1. zip (PowerShell + .NET ZipFile: always available on Windows)
fs.rmSync(zipFile, { force: true })
execFileSync("powershell.exe", [
  "-NoProfile", "-NonInteractive", "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${unpacked}', '${zipFile}', [IO.Compression.CompressionLevel]::Optimal, $false)`,
], { stdio: "inherit" })

const zip = fs.readFileSync(zipFile)
const payloadId = crypto.createHash("sha256").update(zip).digest("hex").slice(0, 16)

// 2. compile the launcher
const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe")
if (!fs.existsSync(csc)) {
  console.error(`[build-portable] C# compiler not found at ${csc} (.NET Framework 4.8 ships with Windows 10/11)`)
  process.exit(1)
}
const icon = [path.join(dist, ".icon-ico", "icon.ico"), path.join(desktop, "assets", "icon.ico")].find((p) => fs.existsSync(p))
execFileSync(csc, [
  "/nologo", "/optimize+", "/target:winexe", `/out:${launcherExe}`,
  ...(icon ? [`/win32icon:${icon}`] : []),
  "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll",
  path.join(desktop, "launcher", "Launcher.cs"),
], { stdio: "inherit" })

// 3. stitch
const launcher = fs.readFileSync(launcherExe)
const trailer = Buffer.alloc(48)
trailer.writeBigInt64LE(BigInt(launcher.length), 0)
trailer.writeBigInt64LE(BigInt(zip.length), 8)
trailer.write(payloadId.padEnd(24, " "), 16, 24, "ascii")
trailer.write("SPPAYLD1", 40, 8, "ascii")
// Atomic write: double-clicking during a build must never hit a half-written
// exe (the launcher would report "payload missing or corrupt").
const tmp = `${out}.new`
fs.writeFileSync(tmp, Buffer.concat([launcher, zip, trailer]))
try {
  fs.renameSync(tmp, out)
} catch (e) {
  console.error(`[build-portable] could not replace ${out} (${e.code}). Close SpatialPosters and run build-portable again; the new build is at ${tmp}`)
  process.exit(1)
}

console.log(`[build-portable] ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(0)} MB, payload ${payloadId})`)
