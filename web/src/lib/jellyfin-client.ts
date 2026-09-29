// Chiamate client → /api/jellyfin/*. La chiave TMDB dell'utente viaggia in
// header (serve al render server-side del poster prima dell'upload).

export interface JellyfinStatus {
  configured: boolean
  url: string
  connected?: boolean
  serverName?: string
  version?: string
  error?: string
}

export interface JellyfinLibraryDto {
  id: string
  name: string
  collectionType: string | null
}

export interface JellyfinItemDto {
  id: string
  name: string
  year: number | null
  type: "movie" | "tv"
  tmdbId: number | null
  imdbId: string | null
  imageTag: string | null
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data as T
}

export const jellyfinApi = {
  status: () => call<JellyfinStatus>("/api/jellyfin/config"),
  save: (url: string, apiKey: string) =>
    call<JellyfinStatus>("/api/jellyfin/config", { method: "PUT", body: JSON.stringify({ url, apiKey }) }),
  disconnect: () => call<JellyfinStatus>("/api/jellyfin/config", { method: "DELETE" }),
  libraries: () => call<{ libraries: JellyfinLibraryDto[] }>("/api/jellyfin/libraries"),
  items: (opts: { parentId?: string | null; search?: string; start?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (opts.parentId) q.set("parentId", opts.parentId)
    if (opts.search) q.set("search", opts.search)
    q.set("start", String(opts.start ?? 0))
    q.set("limit", String(opts.limit ?? 60))
    return call<{ items: JellyfinItemDto[]; total: number }>(`/api/jellyfin/items?${q}`)
  },
  push: (itemId: string, tmdbKey: string, lang: string, mdblistKey?: string) =>
    call<{ ok: true; bytes: number; designed: boolean }>("/api/jellyfin/push", {
      method: "POST",
      headers: { "x-api-key": tmdbKey },
      body: JSON.stringify({ itemId, lang, mdblistKey: mdblistKey || undefined }),
    }),
}

export function jellyfinImageUrl(item: Pick<JellyfinItemDto, "id" | "imageTag">, bust?: number): string {
  if (bust) return `/api/jellyfin/image/${item.id}?v=${bust}`
  return `/api/jellyfin/image/${item.id}${item.imageTag ? `?tag=${item.imageTag}` : ""}`
}
