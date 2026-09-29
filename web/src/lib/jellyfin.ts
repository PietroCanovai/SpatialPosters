import fs from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"

const log = createLogger("jellyfin")

/**
 * Integrazione Jellyfin: il poster renderizzato viene caricato come immagine
 * Primary dell'item, quindi Jellyfin lo serve da solo — SpatialPosters non deve
 * restare in esecuzione. L'URL del server è configurato dall'utente (tipicamente
 * un IP di LAN), quindi qui NON si applica il filtro SSRF di safe-fetch: le
 * route che lo usano sono tutte admin-only.
 */

export interface JellyfinConfig {
  url: string
  apiKey: string
}

export interface JellyfinLibrary {
  id: string
  name: string
  collectionType: string | null
}

export interface JellyfinItem {
  id: string
  name: string
  year: number | null
  type: "movie" | "tv"
  tmdbId: number | null
  imdbId: string | null
  imageTag: string | null
}

export class JellyfinError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

function configFile(): string {
  return path.join(DATA_DIR, "jellyfin.json")
}

export function normalizeJellyfinUrl(raw: string): string {
  let url = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) throw new JellyfinError("Only http(s) URLs are supported")
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new JellyfinError("Only http(s) URLs are supported")
  // Tieni un eventuale base path (es. https://host/jellyfin), senza slash finale.
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "")
}

export async function readJellyfinConfig(): Promise<JellyfinConfig | null> {
  try {
    const cfg = JSON.parse(await fs.readFile(configFile(), "utf-8")) as Partial<JellyfinConfig>
    if (cfg.url && cfg.apiKey) return { url: cfg.url, apiKey: cfg.apiKey }
  } catch { /* not configured */ }
  return null
}

export async function writeJellyfinConfig(cfg: JellyfinConfig | null): Promise<void> {
  const file = configFile()
  if (!cfg) {
    await fs.rm(file, { force: true })
    return
  }
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.tmp.${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf-8")
  await fs.rename(tmp, file)
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `MediaBrowser Client="SpatialPosters", Device="SpatialPosters", DeviceId="spatialposters", Version="1", Token="${apiKey}"`,
  }
}

export async function jellyfinFetch(cfg: JellyfinConfig, pathAndQuery: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${cfg.url}${pathAndQuery}`, {
      ...init,
      headers: { ...authHeaders(cfg.apiKey), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    })
  } catch (e) {
    const reason = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)
    throw new JellyfinError(`Cannot reach Jellyfin at ${cfg.url} (${reason})`)
  }
  if (res.status === 401 || res.status === 403) throw new JellyfinError("Jellyfin rejected the API key", res.status)
  if (!res.ok) throw new JellyfinError(`Jellyfin returned HTTP ${res.status} for ${pathAndQuery.split("?")[0]}`, res.status)
  return res
}

async function jellyfinJson<T>(cfg: JellyfinConfig, pathAndQuery: string): Promise<T> {
  const res = await jellyfinFetch(cfg, pathAndQuery, { headers: { Accept: "application/json" } })
  return (await res.json()) as T
}

export async function getServerInfo(cfg: JellyfinConfig): Promise<{ serverName: string; version: string }> {
  const info = await jellyfinJson<{ ServerName?: string; Version?: string }>(cfg, "/System/Info")
  return { serverName: info.ServerName || "Jellyfin", version: info.Version || "" }
}

export async function listLibraries(cfg: JellyfinConfig): Promise<JellyfinLibrary[]> {
  const res = await jellyfinJson<{ Items?: { Id: string; Name: string; CollectionType?: string }[] }>(cfg, "/Library/MediaFolders")
  return (res.Items || [])
    .filter((l) => !l.CollectionType || l.CollectionType === "movies" || l.CollectionType === "tvshows" || l.CollectionType === "mixed")
    .map((l) => ({ id: l.Id, name: l.Name, collectionType: l.CollectionType ?? null }))
}

interface RawItem {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  ProviderIds?: Record<string, string>
  ImageTags?: Record<string, string>
}

function providerId(ids: Record<string, string> | undefined, key: string): string | null {
  if (!ids) return null
  const hit = Object.entries(ids).find(([k]) => k.toLowerCase() === key)
  return hit?.[1] || null
}

export function toJellyfinItem(raw: RawItem): JellyfinItem {
  const tmdb = providerId(raw.ProviderIds, "tmdb")
  const tmdbNum = tmdb && /^\d+$/.test(tmdb) ? Number(tmdb) : null
  return {
    id: raw.Id,
    name: raw.Name,
    year: raw.ProductionYear ?? null,
    type: raw.Type === "Series" ? "tv" : "movie",
    tmdbId: tmdbNum,
    imdbId: providerId(raw.ProviderIds, "imdb"),
    imageTag: raw.ImageTags?.Primary ?? null,
  }
}

export async function listItems(
  cfg: JellyfinConfig,
  opts: { parentId?: string | null; search?: string | null; start?: number; limit?: number },
): Promise<{ items: JellyfinItem[]; total: number }> {
  const q = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    Fields: "ProviderIds,ProductionYear",
    EnableImageTypes: "Primary",
    SortBy: "SortName",
    SortOrder: "Ascending",
    StartIndex: String(Math.max(0, opts.start ?? 0)),
    Limit: String(Math.min(Math.max(1, opts.limit ?? 60), 500)),
  })
  if (opts.parentId) q.set("ParentId", opts.parentId)
  if (opts.search) q.set("SearchTerm", opts.search)
  const res = await jellyfinJson<{ Items?: RawItem[]; TotalRecordCount?: number }>(cfg, `/Items?${q}`)
  return { items: (res.Items || []).map(toJellyfinItem), total: res.TotalRecordCount ?? 0 }
}

export async function getItem(cfg: JellyfinConfig, itemId: string): Promise<JellyfinItem> {
  const q = new URLSearchParams({ Ids: itemId, Fields: "ProviderIds,ProductionYear", EnableImageTypes: "Primary" })
  const res = await jellyfinJson<{ Items?: RawItem[] }>(cfg, `/Items?${q}`)
  const raw = res.Items?.[0]
  if (!raw) throw new JellyfinError("Item not found in Jellyfin", 404)
  return toJellyfinItem(raw)
}

// Indice TMDB → item per libreria, per trovare l'item quando si invia
// dall'editor (che conosce solo il TMDB id). Scade dopo 5 minuti.
let tmdbIndex: { url: string; at: number; items: JellyfinItem[] } | null = null
const TMDB_INDEX_TTL_MS = 5 * 60 * 1000

async function allItems(cfg: JellyfinConfig): Promise<JellyfinItem[]> {
  if (tmdbIndex && tmdbIndex.url === cfg.url && Date.now() - tmdbIndex.at < TMDB_INDEX_TTL_MS) return tmdbIndex.items
  const items: JellyfinItem[] = []
  for (let start = 0; ; start += 500) {
    const page = await listItems(cfg, { start, limit: 500 })
    items.push(...page.items)
    if (page.items.length < 500 || items.length >= page.total) break
  }
  tmdbIndex = { url: cfg.url, at: Date.now(), items }
  return items
}

/** Item della libreria Jellyfin con questo TMDB id (può essere più di uno, es. edizioni diverse). */
export async function findItemsByTmdb(cfg: JellyfinConfig, type: "movie" | "tv", tmdbId: number): Promise<JellyfinItem[]> {
  const q = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: type === "tv" ? "Series" : "Movie",
    AnyProviderIdEquals: `Tmdb.${tmdbId}`,
    Fields: "ProviderIds,ProductionYear",
    EnableImageTypes: "Primary",
  })
  try {
    const res = await jellyfinJson<{ Items?: RawItem[] }>(cfg, `/Items?${q}`)
    // Il filtro lato server non è garantito su tutte le versioni: verifica sempre.
    const hits = (res.Items || []).map(toJellyfinItem).filter((i) => i.tmdbId === tmdbId && i.type === type)
    if (hits.length) return hits
  } catch (e) {
    if (e instanceof JellyfinError && e.status === 401) throw e
  }
  return (await allItems(cfg)).filter((i) => i.tmdbId === tmdbId && i.type === type)
}

/** Invalida l'indice TMDB (es. dopo aver cambiato server). */
export function clearTmdbIndex(): void {
  tmdbIndex = null
}

/** Jellyfin vuole il corpo dell'upload immagine codificato in base64. */
export async function uploadPrimaryImage(cfg: JellyfinConfig, itemId: string, image: Buffer, contentType: string): Promise<void> {
  await jellyfinFetch(cfg, `/Items/${encodeURIComponent(itemId)}/Images/Primary`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: image.toString("base64"),
  }, 30000)
  log.info("Poster uploaded to Jellyfin", { itemId, bytes: image.length })
}

export function isValidItemId(id: string): boolean {
  return /^[a-f0-9-]{32,36}$/i.test(id)
}
