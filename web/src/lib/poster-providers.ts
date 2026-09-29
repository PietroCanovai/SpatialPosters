import { createLogger } from "@/lib/logger"
import { cacheGet, cacheSet } from "@/lib/cache"
import { getDetails, getExternalIds } from "@/lib/tmdb"
import type { TMDBImage } from "@/lib/types"

const log = createLogger("poster-providers")

/**
 * Poster da fonti diverse da TMDB. Ogni provider restituisce immagini nello
 * stesso formato di TMDB (TMDBImage) con `file_path` = URL assoluto: il resto
 * della pipeline (render, safe-fetch SSRF, proxy immagini, varianti per poster)
 * funziona senza modifiche. `iso_639_1` null = poster senza testo (accetta il logo).
 *
 * Chiavi: fanart.tv e TheTVDB richiedono una API key; AniDB un "client" registrato
 * (anidb.net → account → client). TVmaze, AniList, Kitsu, AniSearch sono pubblici.
 */

export const POSTER_PROVIDERS = ["tvdb", "fanart", "tvmaze", "anilist", "kitsu", "anidb", "anisearch"] as const
export type PosterProvider = (typeof POSTER_PROVIDERS)[number]

export const PROVIDER_LABELS: Record<PosterProvider | "tmdb", string> = {
  tmdb: "TMDB",
  tvdb: "TheTVDB",
  fanart: "Fanart.tv",
  tvmaze: "TVmaze",
  anilist: "AniList",
  kitsu: "Kitsu",
  anidb: "AniDB",
  anisearch: "AniSearch",
}

export interface ProviderPoster extends TMDBImage {
  source: PosterProvider
}

export interface ProviderResult {
  provider: PosterProvider
  posters: ProviderPoster[]
  /** Motivo per cui il provider non ha risultati (chiave mancante, errore…). */
  note?: string
}

export interface ProviderKeys {
  tmdb: string
  fanart?: string
  tvdb?: string
  anidbClient?: string
}

interface TitleIds {
  mediaType: "movie" | "tv"
  tmdbId: number
  imdbId: string | null
  tvdbId: number | null
  isAnime: boolean
  anime: { anilist?: number; kitsu?: number; anidb?: number; anisearch?: number } | null
}

const TIMEOUT_MS = 12000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const UA = "SpatialPosters/1.0 (desktop poster editor)"

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** ISO 639-2 (TVDB: "eng", "jpn") → 639-1 ("en", "ja"). null resta null (senza testo). */
const ISO3_TO_1: Record<string, string> = {
  eng: "en", ita: "it", jpn: "ja", deu: "de", ger: "de", fra: "fr", fre: "fr", spa: "es", por: "pt", kor: "ko",
  zho: "zh", chi: "zh", rus: "ru", nld: "nl", dut: "nl", pol: "pl", swe: "sv", tur: "tr", heb: "he", ara: "ar",
  hin: "hi", ces: "cs", cze: "cs", dan: "da", fin: "fi", nor: "no", hun: "hu", ell: "el", gre: "el", tha: "th",
}
function langFrom3(code: string | null | undefined): string | null {
  if (!code) return null
  return ISO3_TO_1[code.toLowerCase()] ?? code.toLowerCase().slice(0, 2)
}

/** Lingua sconosciuta: il poster probabilmente ha testo, quindi niente logo. */
export const UNKNOWN_LANG = "und"

function poster(source: PosterProvider, url: string, width: number, height: number, lang: string | null, votes = 0): ProviderPoster {
  return { source, file_path: url, width, height, iso_639_1: lang, vote_average: votes }
}

// ---- Id resolution ----------------------------------------------------------

async function resolveIds(mediaType: "movie" | "tv", tmdbId: number, keys: ProviderKeys): Promise<TitleIds> {
  const [ext, details] = await Promise.all([
    getExternalIds(mediaType, tmdbId, keys.tmdb).catch(() => null),
    getDetails(mediaType, tmdbId, "en-US", keys.tmdb).catch(() => null),
  ])
  const genres = (details as { genres?: { id: number }[] } | null)?.genres ?? []
  const originalLanguage = (details as { original_language?: string } | null)?.original_language
  // Anime = animazione giapponese (genere TMDB 16 + lingua originale ja).
  const isAnime = genres.some((g) => g.id === 16) && originalLanguage === "ja"
  const ids: TitleIds = {
    mediaType,
    tmdbId,
    imdbId: (ext as { imdb_id?: string | null } | null)?.imdb_id ?? null,
    tvdbId: (ext as { tvdb_id?: number | null } | null)?.tvdb_id ?? null,
    isAnime,
    anime: null,
  }
  if (isAnime) {
    // ani.zip mappa TMDB → AniList/Kitsu/AniDB/AniSearch (e TVDB).
    const map = await getJson<{ mappings?: Record<string, unknown> }>(`https://api.ani.zip/mappings?themoviedb_id=${tmdbId}`).catch(() => null)
    const m = map?.mappings ?? {}
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined)
    ids.anime = { anilist: num(m.anilist_id), kitsu: num(m.kitsu_id), anidb: num(m.anidb_id), anisearch: num(m.anisearch_id) }
    if (!ids.tvdbId && num(m.thetvdb_id)) ids.tvdbId = num(m.thetvdb_id) ?? null
  }
  return ids
}

// ---- Providers --------------------------------------------------------------

let tvdbToken: { key: string; token: string; at: number } | null = null
async function tvdbLogin(apiKey: string): Promise<string> {
  if (tvdbToken && tvdbToken.key === apiKey && Date.now() - tvdbToken.at < 20 * 24 * 60 * 60 * 1000) return tvdbToken.token
  const res = await getJson<{ data?: { token?: string } }>("https://api4.thetvdb.com/v4/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apikey: apiKey }),
  })
  const token = res?.data?.token
  if (!token) throw new Error("TheTVDB rejected the API key")
  tvdbToken = { key: apiKey, token, at: Date.now() }
  return token
}

interface TvdbArtwork { image?: string; language?: string | null; width?: number; height?: number; type?: number; score?: number }

async function fromTvdb(ids: TitleIds, keys: ProviderKeys): Promise<ProviderResult> {
  if (!keys.tvdb) return { provider: "tvdb", posters: [], note: "Add a TheTVDB key in Settings → API keys" }
  const token = await tvdbLogin(keys.tvdb)
  const auth = { headers: { Authorization: `Bearer ${token}` } }
  let artworks: TvdbArtwork[] = []
  if (ids.mediaType === "tv") {
    if (!ids.tvdbId) return { provider: "tvdb", posters: [] }
    const res = await getJson<{ data?: { artworks?: TvdbArtwork[] } }>(`https://api4.thetvdb.com/v4/series/${ids.tvdbId}/artworks?type=2`, auth)
    artworks = res?.data?.artworks ?? []
  } else {
    if (!ids.imdbId) return { provider: "tvdb", posters: [] }
    const found = await getJson<{ data?: { movie?: { id?: number } }[] }>(`https://api4.thetvdb.com/v4/search/remoteid/${ids.imdbId}`, auth)
    const movieId = found?.data?.find((d) => d.movie?.id)?.movie?.id
    if (!movieId) return { provider: "tvdb", posters: [] }
    const res = await getJson<{ data?: { artworks?: TvdbArtwork[] } }>(`https://api4.thetvdb.com/v4/movies/${movieId}/extended`, auth)
    artworks = (res?.data?.artworks ?? []).filter((a) => a.type === 14)
  }
  return {
    provider: "tvdb",
    posters: artworks
      .filter((a) => a.image)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((a) => poster("tvdb", a.image!, a.width ?? 0, a.height ?? 0, langFrom3(a.language), a.score ?? 0)),
  }
}

interface FanartImage { url?: string; lang?: string; likes?: string }

async function fromFanart(ids: TitleIds, keys: ProviderKeys): Promise<ProviderResult> {
  if (!keys.fanart) return { provider: "fanart", posters: [], note: "Add a fanart.tv key in Settings → API keys" }
  const key = encodeURIComponent(keys.fanart)
  let images: FanartImage[] = []
  if (ids.mediaType === "movie") {
    const res = await getJson<{ movieposter?: FanartImage[] }>(`https://webservice.fanart.tv/v3/movies/${ids.tmdbId}?api_key=${key}`)
    images = res?.movieposter ?? []
  } else {
    if (!ids.tvdbId) return { provider: "fanart", posters: [] }
    const res = await getJson<{ tvposter?: FanartImage[] }>(`https://webservice.fanart.tv/v3/tv/${ids.tvdbId}?api_key=${key}`)
    images = res?.tvposter ?? []
  }
  return {
    provider: "fanart",
    // fanart.tv: poster 1000×1426; lang "00" = senza testo.
    posters: images.filter((i) => i.url).map((i) => poster("fanart", i.url!, 1000, 1426, !i.lang || i.lang === "00" ? null : i.lang, Number(i.likes) || 0)),
  }
}

interface TvmazeImage { type?: string; resolutions?: { original?: { url?: string; width?: number; height?: number } } }

async function fromTvmaze(ids: TitleIds): Promise<ProviderResult> {
  if (ids.mediaType !== "tv") return { provider: "tvmaze", posters: [] }
  const lookup = ids.tvdbId ? `thetvdb=${ids.tvdbId}` : ids.imdbId ? `imdb=${ids.imdbId}` : null
  if (!lookup) return { provider: "tvmaze", posters: [] }
  const show = await getJson<{ id?: number }>(`https://api.tvmaze.com/lookup/shows?${lookup}`)
  if (!show?.id) return { provider: "tvmaze", posters: [] }
  const images = (await getJson<TvmazeImage[]>(`https://api.tvmaze.com/shows/${show.id}/images`)) ?? []
  return {
    provider: "tvmaze",
    posters: images
      .filter((i) => i.type === "poster" && i.resolutions?.original?.url)
      // TVmaze non indica la lingua: "und" (sconosciuta), non null, che vorrebbe dire "senza testo".
      .map((i) => poster("tvmaze", i.resolutions!.original!.url!, i.resolutions!.original!.width ?? 0, i.resolutions!.original!.height ?? 0, UNKNOWN_LANG)),
  }
}

async function fromAnilist(ids: TitleIds): Promise<ProviderResult> {
  const id = ids.anime?.anilist
  if (!id) return { provider: "anilist", posters: [] }
  const res = await getJson<{ data?: { Media?: { coverImage?: { extraLarge?: string } } } }>("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query($id:Int){Media(id:$id){coverImage{extraLarge}}}", variables: { id } }),
  })
  const url = res?.data?.Media?.coverImage?.extraLarge
  // AniList non fornisce le dimensioni; le cover "extraLarge" sono ~460×650.
  return { provider: "anilist", posters: url ? [poster("anilist", url, 0, 0, "ja")] : [] }
}

async function fromKitsu(ids: TitleIds): Promise<ProviderResult> {
  const id = ids.anime?.kitsu
  if (!id) return { provider: "kitsu", posters: [] }
  const res = await getJson<{ data?: { attributes?: { posterImage?: { original?: string; meta?: { dimensions?: { large?: { width?: number; height?: number } } } } } } }>(`https://kitsu.io/api/edge/anime/${id}`, {
    headers: { Accept: "application/vnd.api+json" },
  })
  const img = res?.data?.attributes?.posterImage
  if (!img?.original) return { provider: "kitsu", posters: [] }
  const dim = img.meta?.dimensions?.large
  return { provider: "kitsu", posters: [poster("kitsu", img.original, dim?.width ?? 0, dim?.height ?? 0, "ja")] }
}

// AniDB banna i client che superano 1 richiesta ogni 2 s: serializza le chiamate.
let anidbQueue: Promise<unknown> = Promise.resolve()
async function fromAnidb(ids: TitleIds, keys: ProviderKeys): Promise<ProviderResult> {
  const aid = ids.anime?.anidb
  if (!aid) return { provider: "anidb", posters: [] }
  if (!keys.anidbClient) return { provider: "anidb", posters: [], note: "Add your AniDB client name in Settings → API keys" }
  const run = anidbQueue.then(async () => {
    const url = `http://api.anidb.net:9001/httpapi?request=anime&client=${encodeURIComponent(keys.anidbClient!)}&clientver=1&protover=1&aid=${aid}`
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const xml = await res.text()
    await new Promise((r) => setTimeout(r, 2100))
    return xml
  })
  anidbQueue = run.catch(() => undefined)
  const xml = await run
  const err = xml.match(/<error[^>]*>([^<]*)<\/error>/)
  if (err) throw new Error(`AniDB: ${err[1]}`)
  const picture = xml.match(/<picture>([^<]+)<\/picture>/)?.[1]
  if (!picture) return { provider: "anidb", posters: [] }
  return { provider: "anidb", posters: [poster("anidb", `https://cdn-eu.anidb.net/images/main/${encodeURIComponent(picture)}`, 0, 0, "ja")] }
}

async function fromAnisearch(ids: TitleIds): Promise<ProviderResult> {
  const id = ids.anime?.anisearch
  if (!id) return { provider: "anisearch", posters: [] }
  // Copertina più grande pubblicata da AniSearch (600 px di larghezza).
  const url = `https://cdn.anisearch.com/images/anime/cover/${Math.floor(id / 1000)}/${id}_600.webp`
  const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  return { provider: "anisearch", posters: head.ok ? [poster("anisearch", url, 600, 894, "ja")] : [] }
}

// ---- Entry point ------------------------------------------------------------

/** Poster di tutti i provider per un titolo, in parallelo; un provider che fallisce non blocca gli altri. */
export async function getProviderPosters(mediaType: "movie" | "tv", tmdbId: number, keys: ProviderKeys, force = false): Promise<ProviderResult[]> {
  const cacheKey = `provider-posters:${mediaType}:${tmdbId}:${keys.fanart ? "f" : ""}${keys.tvdb ? "t" : ""}${keys.anidbClient ? "a" : ""}`
  if (!force) {
    const cached = cacheGet<ProviderResult[]>(cacheKey)
    if (cached) return cached
  }
  const ids = await resolveIds(mediaType, tmdbId, keys)
  const tasks: [PosterProvider, () => Promise<ProviderResult>][] = [
    ["tvdb", () => fromTvdb(ids, keys)],
    ["fanart", () => fromFanart(ids, keys)],
    ["tvmaze", () => fromTvmaze(ids)],
    ["anilist", () => fromAnilist(ids)],
    ["kitsu", () => fromKitsu(ids)],
    ["anidb", () => fromAnidb(ids, keys)],
    ["anisearch", () => fromAnisearch(ids)],
  ]
  const results = await Promise.all(tasks.map(async ([provider, run]) => {
    try {
      return await run()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.warn("Provider failed", { provider, mediaType, tmdbId, error: message })
      return { provider, posters: [], note: message } satisfies ProviderResult
    }
  }))
  cacheSet(cacheKey, results, ["provider-posters"], CACHE_TTL_MS)
  return results
}
