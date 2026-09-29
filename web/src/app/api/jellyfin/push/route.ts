import { NextRequest } from "next/server"
import { z } from "zod"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import {
  findItemsByTmdb, getItem, isValidItemId, readJellyfinConfig, uploadPrimaryImage, type JellyfinItem,
} from "@/lib/jellyfin"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { buildPosterRenderUrl } from "@/lib/poster-render-url"
import { resolveRequestApiKey } from "@/lib/tmdb"
import { createLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const log = createLogger("jellyfin-push")

// Dalla pagina Jellyfin si invia un item preciso; dall'editor si invia per
// titolo TMDB (tutti gli item della libreria con quel TMDB id).
const bodySchema = z.union([
  z.object({
    itemId: z.string().refine(isValidItemId, "Invalid Jellyfin item id"),
    lang: z.string().max(10).optional(),
    mdblistKey: z.string().max(200).optional(),
  }),
  z.object({
    tmdbId: z.number().int().positive(),
    mediaType: z.enum(["movie", "tv"]),
    lang: z.string().max(10).optional(),
    mdblistKey: z.string().max(200).optional(),
  }),
])

/**
 * Renderizza il poster (mapping salvato + default) e lo carica in Jellyfin
 * come immagine Primary. Il render passa dalla poster route su loopback:
 * stesso codice, stessa cache.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return originMismatchResponse()
  if (!checkAdminToken(req)) return adminAuthResponse()

  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 })

  const cfg = await readJellyfinConfig()
  if (!cfg) return Response.json({ error: "Connect Jellyfin first (Jellyfin page)." }, { status: 409 })

  const apiKey = resolveRequestApiKey(req)
  if (!apiKey) return Response.json({ error: "A TMDB API key is required to render posters (Settings → API keys)" }, { status: 400 })

  try {
    let items: JellyfinItem[]
    let tmdbId: number
    let mediaType: "movie" | "tv"
    if ("itemId" in parsed.data) {
      const item = await getItem(cfg, parsed.data.itemId)
      if (!item.tmdbId) {
        return Response.json({ error: "No TMDB id in Jellyfin for this item. Identify it in Jellyfin first." }, { status: 422 })
      }
      items = [item]
      tmdbId = item.tmdbId
      mediaType = item.type
    } else {
      tmdbId = parsed.data.tmdbId
      mediaType = parsed.data.mediaType
      items = await findItemsByTmdb(cfg, mediaType, tmdbId)
      if (items.length === 0) {
        return Response.json({ error: "This title isn't in your Jellyfin library.", notInLibrary: true }, { status: 404 })
      }
    }

    const mapping = await getById(mediaType, tmdbId)
    const posterUrl = buildPosterRenderUrl({
      origin: `http://127.0.0.1:${process.env.PORT || "3000"}`,
      type: mediaType === "tv" ? "series" : "movie",
      id: tmdbId,
      defaults: getServerDefaults(),
      mapping,
      mdblistKey: parsed.data.mdblistKey,
      lang: parsed.data.lang || mapping?.language || "en",
    })
    posterUrl.searchParams.set("fmt", "jpeg")
    // La chiave viaggia in header (policy tmdb.ts), non in query.
    posterUrl.searchParams.delete("api_key")
    const render = await fetch(posterUrl, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(45000) })
    const contentType = render.headers.get("content-type") || ""
    if (!render.ok || !contentType.startsWith("image/")) {
      const detail = (await render.text().catch(() => "")).slice(0, 200)
      return Response.json({ error: `Poster render failed (HTTP ${render.status}) ${detail}`.trim() }, { status: 502 })
    }
    const image = Buffer.from(await render.arrayBuffer())
    for (const item of items) await uploadPrimaryImage(cfg, item.id, image, contentType.split(";")[0])
    return Response.json({ ok: true, items: items.map((i) => ({ id: i.id, name: i.name })), tmdbId, bytes: image.length, designed: !!mapping })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.warn("Push failed", { target: "itemId" in parsed.data ? parsed.data.itemId : `${parsed.data.mediaType}:${parsed.data.tmdbId}`, error: message })
    return Response.json({ error: message }, { status: 502 })
  }
}
