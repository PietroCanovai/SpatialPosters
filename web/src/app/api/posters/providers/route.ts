import { NextRequest } from "next/server"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { resolveRequestApiKey } from "@/lib/tmdb"
import { getProviderPosters, PROVIDER_LABELS } from "@/lib/poster-providers"
import { readProviderKeys } from "@/lib/provider-keys"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/posters/providers?type=movie|tv&id=<tmdbId>[&force=1]
 * Poster di TheTVDB, fanart.tv, TVmaze, AniList, Kitsu, AniDB, AniSearch.
 * Le chiavi dei provider restano sul server (provider-keys.json).
 */
export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const sp = req.nextUrl.searchParams
  const type = sp.get("type") === "tv" ? "tv" : sp.get("type") === "movie" ? "movie" : null
  const id = Number(sp.get("id"))
  if (!type || !Number.isInteger(id) || id <= 0) return Response.json({ error: "type and id are required" }, { status: 400 })

  const tmdb = resolveRequestApiKey(req)
  if (!tmdb) return Response.json({ error: "A TMDB API key is required" }, { status: 400 })
  const saved = readProviderKeys()
  const results = await getProviderPosters(type, id, {
    tmdb,
    fanart: saved.fanart || process.env.SPATIALPOSTERS_FANART_KEY,
    tvdb: saved.tvdb || process.env.SPATIALPOSTERS_TVDB_API_KEY,
    anidbClient: saved.anidb || process.env.SPATIALPOSTERS_ANIDB_CLIENT,
  }, sp.get("force") === "1")
  return Response.json({
    providers: results.map((r) => ({ ...r, label: PROVIDER_LABELS[r.provider] })),
  })
}
