import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"

vi.mock("@/lib/tmdb", () => ({
  getExternalIds: vi.fn(async (type: string) => (type === "tv" ? { imdb_id: "tt12343534", tvdb_id: 377543 } : { imdb_id: "tt1375666" })),
  getDetails: vi.fn(async (type: string) => (type === "tv"
    ? { genres: [{ id: 16 }], original_language: "ja" }
    : { genres: [{ id: 28 }], original_language: "en" })),
}))

import { getProviderPosters } from "@/lib/poster-providers"
import { cacheClear } from "@/lib/cache"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function route(url: string, init?: RequestInit): Response {
  if (url.includes("api.ani.zip")) return json({ mappings: { anilist_id: 113415, kitsu_id: 42765, anidb_id: 15275, anisearch_id: 14790, thetvdb_id: 377543 } })
  if (url.endsWith("/v4/login")) return json({ data: { token: "tok" } })
  if (url.includes("/v4/series/377543/artworks")) return json({ data: { artworks: [
    { image: "https://artworks.thetvdb.com/p1.jpg", language: "jpn", width: 680, height: 1000, type: 2, score: 5 },
    { image: "https://artworks.thetvdb.com/p2.jpg", language: null, width: 680, height: 1000, type: 2, score: 9 },
  ] } })
  if (url.includes("/v4/search/remoteid/tt1375666")) return json({ data: [{ movie: { id: 113 } }] })
  if (url.includes("/v4/movies/113/extended")) return json({ data: { artworks: [
    { image: "https://artworks.thetvdb.com/m1.jpg", language: "eng", width: 680, height: 1000, type: 14 },
    { image: "https://artworks.thetvdb.com/bg.jpg", language: null, width: 1920, height: 1080, type: 15 },
  ] } })
  if (url.includes("webservice.fanart.tv/v3/tv/377543")) return json({ tvposter: [{ url: "https://assets.fanart.tv/tv1.jpg", lang: "00", likes: "3" }, { url: "https://assets.fanart.tv/tv2.jpg", lang: "en", likes: "1" }] })
  if (url.includes("webservice.fanart.tv/v3/movies/")) return json({ movieposter: [{ url: "https://assets.fanart.tv/mv.jpg", lang: "en", likes: "7" }] })
  if (url.includes("api.tvmaze.com/lookup/shows")) return json({ id: 48450 })
  if (url.includes("api.tvmaze.com/shows/48450/images")) return json([
    { type: "poster", resolutions: { original: { url: "https://static.tvmaze.com/p.jpg", width: 2894, height: 4093 } } },
    { type: "background", resolutions: { original: { url: "https://static.tvmaze.com/b.jpg", width: 1920, height: 1080 } } },
  ])
  if (url.includes("graphql.anilist.co")) {
    expect(JSON.parse(String(init?.body)).variables).toEqual({ id: 113415 })
    return json({ data: { Media: { coverImage: { extraLarge: "https://s4.anilist.co/cover.jpg" } } } })
  }
  if (url.includes("kitsu.io/api/edge/anime/42765")) return json({ data: { attributes: { posterImage: { original: "https://media.kitsu.app/p.jpg", meta: { dimensions: { large: { width: 550, height: 780 } } } } } } })
  if (url.includes("api.anidb.net")) return new Response("<anime><picture>12345.jpg</picture></anime>")
  if (url.includes("cdn.anisearch.com")) return new Response(null, { status: 200 })
  return new Response("unexpected " + url, { status: 500 })
}

describe("poster providers", () => {
  beforeEach(() => { cacheClear() })
  afterEach(() => vi.restoreAllMocks())

  it("collects anime series posters from every provider", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => route(String(input), init))
    const res = await getProviderPosters("tv", 95479, { tmdb: "k", tvdb: "t", fanart: "f", anidbClient: "myclient" })
    const by = Object.fromEntries(res.map((r) => [r.provider, r]))
    // TheTVDB: best score first, 3-letter languages mapped, textless = null
    expect(by.tvdb.posters.map((p) => [p.file_path, p.iso_639_1])).toEqual([
      ["https://artworks.thetvdb.com/p2.jpg", null],
      ["https://artworks.thetvdb.com/p1.jpg", "ja"],
    ])
    expect(by.fanart.posters.map((p) => p.iso_639_1)).toEqual([null, "en"]) // "00" = textless
    expect(by.tvmaze.posters).toHaveLength(1)
    expect(by.tvmaze.posters[0]).toMatchObject({ width: 2894, height: 4093, source: "tvmaze" })
    expect(by.anilist.posters[0].file_path).toBe("https://s4.anilist.co/cover.jpg")
    expect(by.kitsu.posters[0]).toMatchObject({ width: 550, height: 780 })
    expect(by.anidb.posters[0].file_path).toBe("https://cdn-eu.anidb.net/images/main/12345.jpg")
    expect(by.anisearch.posters[0].file_path).toBe("https://cdn.anisearch.com/images/anime/cover/14/14790_600.webp")
  }, 15000)

  it("uses TheTVDB movie posters (type 14 only) and skips anime-only sources for movies", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => route(String(input), init))
    const res = await getProviderPosters("movie", 27205, { tmdb: "k", tvdb: "t", fanart: "f" })
    const by = Object.fromEntries(res.map((r) => [r.provider, r]))
    expect(by.tvdb.posters.map((p) => p.file_path)).toEqual(["https://artworks.thetvdb.com/m1.jpg"])
    expect(by.fanart.posters).toHaveLength(1)
    for (const p of ["tvmaze", "anilist", "kitsu", "anidb", "anisearch"]) expect(by[p].posters).toEqual([])
  })

  it("explains missing keys and survives a failing provider", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("tvmaze")) throw new Error("network down")
      return route(String(input), init)
    })
    const res = await getProviderPosters("tv", 95479, { tmdb: "k" })
    const by = Object.fromEntries(res.map((r) => [r.provider, r]))
    expect(by.tvdb.note).toMatch(/TheTVDB key/)
    expect(by.fanart.note).toMatch(/fanart\.tv key/)
    expect(by.anidb.note).toMatch(/AniDB client/)
    expect(by.tvmaze.note).toMatch(/network down/)
    expect(by.kitsu.posters).toHaveLength(1) // the others still work
  })
})
