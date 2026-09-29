import { NextRequest, NextResponse } from "next/server"
import { fetchRedditPosters } from "@/lib/reddit-poster-service"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { envWithFallback } from "@/lib/env-compat"

// Opt-in: ogni apertura di un titolo nell'editor interrogava Reddit con il
// TMDB id (cronologia di navigazione inviata a terzi) e proponeva immagini
// community non moderate. Abilitare con SPATIALPOSTERS_REDDIT_POSTERS=1.
function redditEnabled(): boolean {
  return envWithFallback("REDDIT_POSTERS") === "1"
}

export async function GET(req: NextRequest) {
  if (!redditEnabled()) {
    return NextResponse.json({ success: true, count: 0, posters: [], disabled: true })
  }
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  try {
    const tmdbId = req.nextUrl.searchParams.get("tmdbId")
    const force = req.nextUrl.searchParams.get("force") === "true"

    if (!tmdbId || !/^\d{1,10}$/.test(tmdbId)) {
      return NextResponse.json(
        { error: "Missing or invalid tmdbId parameter" },
        { status: 400 }
      )
    }

    const posters = await fetchRedditPosters(tmdbId, force)

    return NextResponse.json({
      success: true,
      count: posters.length,
      posters
    })
  } catch (error) {
    console.error("[Reddit API Route Error]:", error)
    return NextResponse.json(
      { error: "Internal Server Error", posters: [] },
      { status: 500 }
    )
  }
}
