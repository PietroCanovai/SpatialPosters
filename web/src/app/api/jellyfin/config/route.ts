import { NextRequest } from "next/server"
import { z } from "zod"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import {
  getServerInfo, JellyfinError, normalizeJellyfinUrl, readJellyfinConfig, writeJellyfinConfig,
} from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  url: z.string().min(1).max(500),
  // Vuota = mantieni la chiave già salvata (la UI non la rilegge mai).
  apiKey: z.string().max(200).optional(),
})

/** Stato della connessione. La API key non viene mai restituita al client. */
export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  const cfg = await readJellyfinConfig()
  if (!cfg) return Response.json({ configured: false, url: "" })
  try {
    const info = await getServerInfo(cfg)
    return Response.json({ configured: true, url: cfg.url, connected: true, ...info })
  } catch (e) {
    return Response.json({ configured: true, url: cfg.url, connected: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Salva URL + API key dopo aver verificato che Jellyfin li accetti. */
export async function PUT(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
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
  if (!parsed.success) return Response.json({ error: "Invalid Jellyfin settings" }, { status: 400 })

  let url: string
  try {
    url = normalizeJellyfinUrl(parsed.data.url)
  } catch {
    return Response.json({ error: "Invalid Jellyfin URL" }, { status: 400 })
  }
  const apiKey = parsed.data.apiKey?.trim() || (await readJellyfinConfig())?.apiKey
  if (!apiKey) return Response.json({ error: "API key is required" }, { status: 400 })

  const cfg = { url, apiKey }
  try {
    const info = await getServerInfo(cfg)
    await writeJellyfinConfig(cfg)
    return Response.json({ configured: true, url, connected: true, ...info })
  } catch (e) {
    const status = e instanceof JellyfinError && e.status === 401 ? 401 : 502
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
  }
}

export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req)) return originMismatchResponse()
  if (!checkAdminToken(req)) return adminAuthResponse()
  await writeJellyfinConfig(null)
  return Response.json({ configured: false, url: "" })
}
