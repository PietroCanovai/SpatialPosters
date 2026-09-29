// Puts the portable build at the repository root as SpatialPosters.exe.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, "..", "dist", "SpatialPosters.exe")
const dest = path.resolve(here, "..", "..", "SpatialPosters.exe")
fs.copyFileSync(src, dest)
console.log(`[copy-exe] ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1e6).toFixed(0)} MB)`)
