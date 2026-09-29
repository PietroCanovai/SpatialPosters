import { NextRequest } from "next/server"
import { getServerDefaults, setServerDefaults, type ServerDefaults } from "@/lib/server-defaults"
import { cacheInvalidatePosterData } from "@/lib/cache"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES } from "@/lib/badge-styles"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import { envWithFallback } from "@/lib/env-compat"

export const dynamic = "force-dynamic"

const defaultsSchema = z.object({
  badgeStyle: z.enum(BADGE_STYLES).optional(),
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).optional(),
  blurEnabled: z.boolean().optional(),
  blurIntensity: z.number().optional(),
  blurFade: z.number().optional(),
  blurDarkness: z.number().optional(),
  gradientHeight: z.number().optional(),
  globalBadges: z.boolean().optional(),
  rankingBadges: z.boolean().optional(),
  badgeGenre: z.boolean().optional(),
  badgeYear: z.boolean().optional(),
  badgeRating: z.boolean().optional(),
  manualQuality: z.string().optional(),
  ratingSources: z.array(z.string()).optional(),
  autoRotateClean: z.boolean().optional(),
  defaultLogoFitEnabled: z.boolean().optional(),
  networkLogo: z.boolean().optional(),
  ribbonSide: z.enum(["left", "right"]).optional(),
  region: z.string().max(32).optional(),
})

export async function GET(req: NextRequest) {
  const d = getServerDefaults()
  if (checkAdminToken(req)) {
    const serverKeys = {
      tmdbKey: envWithFallback("TMDB_KEY") || process.env.TMDB_API_KEY || "",
      mdblistApiKey: envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_API_KEY || "",
    }
    return Response.json({ ...d, serverKeys })
  }
  return Response.json({ ...d })
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "defaults")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!checkAdminToken(req)) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = defaultsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const current = getServerDefaults()
    // Merge invece di replace: un payload parziale NON deve azzerare i default
    // già salvati (altrimenti salvare un solo campo cancellerebbe gli altri).
    const next: Record<string, unknown> = { ...current, ...parsed.data }
    // Await: la 200 arriva solo a persistenza completata (altrimenti una GET
    // successiva può leggere ancora i vecchi default).
    await setServerDefaults(next as ServerDefaults)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: `Failed to save: ${message}` }, { status: 500 })
  }
  cacheInvalidatePosterData()
  return Response.json({ ok: true })
}
