// electron-builder always strips node_modules folders from extraResources,
// but the Next.js standalone server needs them: server/node_modules (next,
// react, sharp + libvips DLLs, resvg) and server/.next/node_modules (the
// hashed aliases Turbopack uses to load sharp/resvg). Without the latter,
// image routes fail with "Failed to load external module sharp-<hash>" and
// every icon/static file 500s. Copy every node_modules folder in after
// packing, before the portable/NSIS targets are built from appOutDir.
const fs = require("node:fs")
const path = require("node:path")

function findNodeModules(dir, rel = "") {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const childRel = path.join(rel, entry.name)
    if (entry.name === "node_modules") found.push(childRel)
    else found.push(...findNodeModules(path.join(dir, entry.name), childRel))
  }
  return found
}

exports.default = async function afterPack(context) {
  const serverSrc = path.join(__dirname, "..", "server")
  const serverDest = path.join(context.appOutDir, "resources", "server")
  const dirs = findNodeModules(serverSrc)
  if (!dirs.includes("node_modules")) throw new Error(`[after-pack] ${serverSrc}/node_modules missing — run prepare-server first`)
  for (const rel of dirs) {
    const dest = path.join(serverDest, rel)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(serverSrc, rel), dest, { recursive: true, dereference: true })
    console.log(`  • [after-pack] copied server/${rel.split(path.sep).join("/")}`)
  }
}
