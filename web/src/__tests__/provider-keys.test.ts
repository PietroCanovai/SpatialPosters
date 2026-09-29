import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"

const ENV = ["SPATIALPOSTERS_TMDB_KEY", "SPATIALPOSTERS_MDBLIST_KEY", "SPATIALPOSTERS_TVDB_API_KEY", "SPATIALPOSTERS_DATA_DIR", "SPATIALPOSTERS_ADMIN_TOKEN"]
let dir: string
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pk-"))
  process.env.SPATIALPOSTERS_DATA_DIR = dir
  process.env.SPATIALPOSTERS_ADMIN_TOKEN = "admin"
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

function put(body: unknown, token = "admin") {
  return new NextRequest("http://127.0.0.1:7272/api/provider-keys", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify(body),
  })
}

describe("provider keys", () => {
  it("persists keys and applies them to the env the rest of the app reads", async () => {
    const { writeProviderKeys, readProviderKeys, applyProviderKeys } = await import("@/lib/provider-keys")
    writeProviderKeys({ tmdb: " t-key ", mdblist: "m-key" })
    expect(readProviderKeys()).toEqual({ tmdb: "t-key", mdblist: "m-key" })
    expect(process.env.SPATIALPOSTERS_TMDB_KEY).toBe("t-key")

    // Simula un riavvio: l'env riparte vuoto e instrumentation riapplica il file.
    delete process.env.SPATIALPOSTERS_TMDB_KEY
    applyProviderKeys()
    expect(process.env.SPATIALPOSTERS_TMDB_KEY).toBe("t-key")

    writeProviderKeys({ mdblist: "m-key" })
    expect(process.env.SPATIALPOSTERS_TMDB_KEY).toBeUndefined()
  })

  it("PUT validates with the provider and keeps rejected keys out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/authentication")) return Response.json({ success: u.includes("api_key=good") })
      return new Response("", { status: 401 })
    })
    const { PUT } = await import("@/app/api/provider-keys/route")
    const res = await PUT(put({ tmdb: "good", mdblist: "bad" }))
    const data = await res.json()
    expect(res.status).toBe(422)
    expect(data.keys.tmdb).toBe("good")
    expect(data.keys.mdblist).toBe("")
    expect(data.errors.mdblist).toMatch(/MDBList/)
    expect(JSON.parse(fs.readFileSync(path.join(dir, "provider-keys.json"), "utf-8"))).toEqual({ tmdb: "good" })
  })

  it("an empty value clears a saved key", async () => {
    const { writeProviderKeys } = await import("@/lib/provider-keys")
    writeProviderKeys({ tmdb: "t", tvdb: "v" })
    const { PUT } = await import("@/app/api/provider-keys/route")
    const res = await PUT(put({ tvdb: "" }))
    expect(res.status).toBe(200)
    expect((await res.json()).saved).toEqual(["tmdb"])
  })

  it("requires the admin token", async () => {
    const { GET, PUT } = await import("@/app/api/provider-keys/route")
    expect((await PUT(put({ tmdb: "x" }, "nope"))).status).toBe(401)
    expect((await GET(new NextRequest("http://127.0.0.1:7272/api/provider-keys"))).status).toBe(401)
  })
})
