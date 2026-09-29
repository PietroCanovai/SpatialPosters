import { NextRequest } from "next/server"
import { z } from "zod"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import { cacheInvalidatePosterData } from "@/lib/cache"
import {
  PROVIDERS, effectiveProviderKeys, readProviderKeys, validateProviderKey, writeProviderKeys, type Provider,
} from "@/lib/provider-keys"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  tmdb: z.string().max(300).optional(),
  mdblist: z.string().max(300).optional(),
  tvdb: z.string().max(300).optional(),
})

/** Chiavi effettive (admin-only: servono al client per le chiamate TMDB dirette). */
export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) return adminAuthResponse()
  return Response.json({ keys: effectiveProviderKeys(), saved: Object.keys(readProviderKeys()) })
}

/**
 * Salva le chiavi. Ogni chiave non vuota viene verificata col provider prima
 * del salvataggio; una stringa vuota cancella la chiave salvata.
 */
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
  if (!parsed.success) return Response.json({ error: "Invalid keys" }, { status: 400 })

  const next = { ...readProviderKeys() }
  const errors: Partial<Record<Provider, string>> = {}
  await Promise.all(PROVIDERS.map(async (p) => {
    const value = parsed.data[p]
    if (value === undefined) return
    const trimmed = value.trim()
    if (!trimmed) {
      delete next[p]
      return
    }
    if (trimmed === next[p]) return
    const check = await validateProviderKey(p, trimmed)
    if (check.valid) next[p] = trimmed
    else errors[p] = check.message || "Invalid key"
  }))

  writeProviderKeys(next)
  // Rating/badge dipendono dalle chiavi: i poster in cache vanno rigenerati.
  cacheInvalidatePosterData()
  const status = Object.keys(errors).length ? 422 : 200
  return Response.json({ keys: effectiveProviderKeys(), saved: Object.keys(next), errors }, { status })
}
