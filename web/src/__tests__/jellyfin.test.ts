import { describe, it, expect, vi, afterEach } from "vitest"
import {
  JellyfinError, getServerInfo, listItems, normalizeJellyfinUrl, toJellyfinItem, uploadPrimaryImage,
} from "@/lib/jellyfin"

const cfg = { url: "http://192.168.1.10:8096", apiKey: "secret-key" }

describe("jellyfin client", () => {
  afterEach(() => vi.restoreAllMocks())

  it("normalises server URLs, keeping a base path", () => {
    expect(normalizeJellyfinUrl("192.168.1.10:8096/")).toBe("http://192.168.1.10:8096")
    expect(normalizeJellyfinUrl(" https://media.example.com/jellyfin/ ")).toBe("https://media.example.com/jellyfin")
    expect(() => normalizeJellyfinUrl("ftp://x")).toThrow()
  })

  it("maps raw items, reading the TMDB id case-insensitively", () => {
    expect(toJellyfinItem({ Id: "a".repeat(32), Name: "Fight Club", Type: "Movie", ProductionYear: 1999, ProviderIds: { Tmdb: "550", Imdb: "tt0137523" }, ImageTags: { Primary: "abc" } }))
      .toEqual({ id: "a".repeat(32), name: "Fight Club", year: 1999, type: "movie", tmdbId: 550, imdbId: "tt0137523", imageTag: "abc" })
    expect(toJellyfinItem({ Id: "b".repeat(32), Name: "Show", Type: "Series", ProviderIds: { tmdb: "1399" } }).type).toBe("tv")
    expect(toJellyfinItem({ Id: "c".repeat(32), Name: "Home video", Type: "Movie" }).tmdbId).toBeNull()
  })

  it("sends the API key in the MediaBrowser Authorization header", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ServerName: "Home", Version: "10.11.0" }))
    await expect(getServerInfo(cfg)).resolves.toEqual({ serverName: "Home", version: "10.11.0" })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe("http://192.168.1.10:8096/System/Info")
    expect((init?.headers as Record<string, string>).Authorization).toContain('Token="secret-key"')
    expect(String(url)).not.toContain("secret-key")
  })

  it("lists movies and series with provider ids", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ Items: [], TotalRecordCount: 0 }))
    await listItems(cfg, { parentId: "d".repeat(32), search: "club", start: 60, limit: 60 })
    const url = new URL(String(spy.mock.calls[0][0]))
    expect(url.pathname).toBe("/Items")
    expect(url.searchParams.get("IncludeItemTypes")).toBe("Movie,Series")
    expect(url.searchParams.get("Fields")).toContain("ProviderIds")
    expect(url.searchParams.get("ParentId")).toBe("d".repeat(32))
    expect(url.searchParams.get("SearchTerm")).toBe("club")
    expect(url.searchParams.get("StartIndex")).toBe("60")
  })

  it("uploads the poster as a base64 body to the Primary image endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }))
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    await uploadPrimaryImage(cfg, "e".repeat(32), image, "image/jpeg")
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe(`http://192.168.1.10:8096/Items/${"e".repeat(32)}/Images/Primary`)
    expect(init?.method).toBe("POST")
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg")
    expect(init?.body).toBe(image.toString("base64"))
  })

  it("reports a rejected API key clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 401 }))
    const err = await getServerInfo(cfg).catch((e) => e)
    expect(err).toBeInstanceOf(JellyfinError)
    expect(err.message).toMatch(/API key/)
  })

  it("reports an unreachable server with its URL", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }))
    await expect(getServerInfo(cfg)).rejects.toThrow(/Cannot reach Jellyfin at http:\/\/192\.168\.1\.10:8096 \(ECONNREFUSED\)/)
  })
})
