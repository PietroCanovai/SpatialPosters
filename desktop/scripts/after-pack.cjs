// electron-builder always strips node_modules from extraResources, but the
// Next.js standalone server needs its traced node_modules (next, react,
// sharp + libvips DLLs, resvg). Copy them in after packing, before the
// NSIS/portable targets are built from appOutDir.
const fs = require("node:fs")
const path = require("node:path")

exports.default = async function afterPack(context) {
  const src = path.join(__dirname, "..", "server", "node_modules")
  const dest = path.join(context.appOutDir, "resources", "server", "node_modules")
  if (!fs.existsSync(src)) throw new Error(`[after-pack] ${src} missing — run prepare-server first`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`  • [after-pack] copied server node_modules → ${path.relative(context.appOutDir, dest)}`)
}
