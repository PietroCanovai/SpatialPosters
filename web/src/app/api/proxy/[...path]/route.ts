import { NextRequest } from "next/server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { rewriteMetasPosters, rewriteSingleMetaPoster, type StremioItemMeta } from "@/lib/addon-proxy"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { pinnedFetch, resolveAndCheckBlocked } from "@/lib/safe-fetch"

export { isIpv4Literal, isPrivateHost } from "@/lib/safe-fetch"

const log = createLogger("addon-proxy")

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

// Deadline complessiva dell'intera operazione di proxy (fix H9): ogni hop ha
// il proprio timeout (10-12s), ma fino a 5 redirect × timeout + lettura body
// potevano superare il maxDuration della piattaforma, terminando la funzione a
// metà risposta. Un unico tetto globale avvolge safeFetch + readJsonCapped.
const PROXY_DEADLINE_MS = (() => {
  const raw = envWithFallback("PROXY_DEADLINE_MS")
  const n = raw ? parseInt(raw, 10) : 20000
  return Number.isFinite(n) && n >= 5000 && n <= 120000 ? n : 20000
})()

class ProxyBodyTooLargeError extends Error {}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache, max-age=0, must-revalidate",
  }
}

function redactUrlForLog(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    if (u.searchParams.has("api_key")) u.searchParams.set("api_key", "[REDACTED]")
    if (u.searchParams.has("apikey")) u.searchParams.set("apikey", "[REDACTED]")
    if (u.searchParams.has("key")) u.searchParams.set("key", "[REDACTED]")
    return u.toString()
  } catch {
    return urlStr
  }
}


/** Allowlist opzionale di domini proxy (PICTORIUM_PROXY_ALLOW_DOMAINS). */
export function isAllowedByAllowlist(url: URL): boolean {
  const raw = envWithFallback("PROXY_ALLOW_DOMAINS")
  if (!raw) return true
  const domains = raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (domains.length === 0) return true
  const host = url.hostname.toLowerCase()
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Legge il body JSON applicando un cap sulla dimensione (anti-mem-exhaustion). */
async function readJsonCapped(res: Response): Promise<unknown> {
  const declared = res.headers.get("content-length")
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ProxyBodyTooLargeError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`)
  }
  if (!res.body) return res.json()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new ProxyBodyTooLargeError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks)
  return JSON.parse(buf.toString("utf-8"))
}

/**
 * Signal di un singolo hop: il timeout specifico dell'hop E la deadline
 * complessiva del proxy (H9). Il primo hop non può superare i suoi 10-12s,
 * ma la somma di tutti gli hop + lettura body non può superare
 * PROXY_DEADLINE_MS: un'abort della deadline propaga come AbortError.
 */
function hopSignal(hopTimeoutMs: number): { signal: AbortSignal; deadline: AbortSignal } {
  const deadline = AbortSignal.timeout(PROXY_DEADLINE_MS)
  const hopTimeout = AbortSignal.timeout(hopTimeoutMs)
  let signal: AbortSignal
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    signal = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([deadline, hopTimeout])
  } else {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (deadline.aborted || hopTimeout.aborted) ctrl.abort()
    else {
      deadline.addEventListener("abort", onAbort, { once: true })
      hopTimeout.addEventListener("abort", onAbort, { once: true })
    }
    signal = ctrl.signal
  }
  return { deadline, signal }
}

/**
 * Esegue un fetch con redirect manuali, validando ogni destinazione.
 * Previene SSRF via redirect 302 verso IP privati. Il DNS pin (SAFE_AGENT)
 * garantisce che ogni connessione usi solo indirizzi pubblici verificati.
 */
async function safeFetch(url: string, options: RequestInit & { signal: AbortSignal }): Promise<Response> {
  let currentUrl = url
  let redirectCount = 0
  const MAX_REDIRECTS = 5
  while (redirectCount <= MAX_REDIRECTS) {
    if (!isAllowedByAllowlist(new URL(currentUrl))) {
      log.warn("Blocked by proxy allowlist", { target: redactUrlForLog(currentUrl) })
      return Response.json({ error: "Target domain not allowed" }, { status: 403, headers: corsHeaders() })
    }
    // Connessione vincolata agli IP pubblici verificati (DNS pin), redirect
    // manuali validati qui sotto.
    const res = await pinnedFetch(currentUrl, options)
    if (res.status < 300 || res.status >= 400) return res
    // Redirect — validiamo la destinazione
    const location = res.headers.get("location")
    if (!location) return res
    const targetUrl = new URL(location, currentUrl).href
    if (await resolveAndCheckBlocked(targetUrl)) {
      log.warn("Blocked SSRF redirect", { from: redactUrlForLog(currentUrl), to: redactUrlForLog(targetUrl) })
      return new Response(JSON.stringify({ error: "Redirect to blocked target" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      })
    }
    currentUrl = targetUrl
    redirectCount++
  }
  return new Response(JSON.stringify({ error: "Too many redirects" }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const { path } = await params
  const origin = getOriginFromRequest(req)
  const searchParams = req.nextUrl.searchParams
  const rawTargetUrl = searchParams.get("target") || searchParams.get("url")
  const userUuid = searchParams.get("u") || searchParams.get("user") || null

  if (!rawTargetUrl) {
    return Response.json({ error: "Missing target URL parameter (?url= or ?target=)" }, { status: 400, headers: corsHeaders() })
  }

  let targetUrl = rawTargetUrl.trim()
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = `https://${targetUrl}`
  }

  if (await resolveAndCheckBlocked(targetUrl)) {
    log.warn("Blocked SSRF attempt", { target: redactUrlForLog(targetUrl) })
    return Response.json({ error: "Invalid target URL" }, { status: 400, headers: corsHeaders() })
  }

  const firstPath = path[0] || ""

  // 1. Manifest Proxy
  if (firstPath === "manifest") {
    const { signal, deadline } = hopSignal(10000)
    try {
      const manifestRes = await safeFetch(targetUrl, { signal })
      if (!manifestRes.ok) {
        return Response.json({ error: `Failed to fetch target manifest: ${manifestRes.statusText}` }, { status: manifestRes.status, headers: corsHeaders() })
      }
      const origManifest = (await readJsonCapped(manifestRes)) as Record<string, unknown>
      const baseUrl = targetUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "")

      const userSuffix = userUuid ? `.${userUuid.slice(0, 8)}` : ""
      const proxiedManifest = {
        ...origManifest,
        id: `org.pictorium.proxy.${Buffer.from(baseUrl).toString("base64url").slice(0, 12)}${userSuffix}`,
        name: `${origManifest.name || "Addon"} (Pictorium)`,
        description: `${origManifest.description || ""} — Poster personalizzati via Pictorium`.trim(),
        logo: origManifest.logo || `${origin}/App.png`,
      }

      // Echo del Content-Type upstream: il manifest può essere servito da
      // addon con media type diversi dal JSON "puro" (fix H9).
      return Response.json(proxiedManifest, { headers: { ...corsHeaders(), "Content-Type": manifestRes.headers.get("content-type") || "application/json; charset=utf-8" } })
    } catch (e) {
      log.error("Manifest proxy error", { error: e instanceof Error ? e.message : String(e) })
      if (deadline.aborted) {
        return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
      }
      if (e instanceof ProxyBodyTooLargeError) {
        return Response.json({ error: "Target manifest too large" }, { status: 413, headers: corsHeaders() })
      }
      return Response.json({ error: "Error fetching manifest" }, { status: 500, headers: corsHeaders() })
    }
  }

  // 2. Resource Proxy (catalog, meta, etc.)
  // Il proxy è pensato per addon Stremio: accetta solo i path standard degli
  // addon, non qualunque percorso del target. Questo evita che l'istanza sia
  // usata come proxy HTTP generico / open relay per URL arbitrari.
  const RESOURCE_PREFIXES = new Set(["catalog", "meta", "stream", "subtitles", "search"])
  if (!RESOURCE_PREFIXES.has(firstPath)) {
    log.warn("Blocked non-addon proxy path", { path: firstPath })
    return Response.json({ error: "Invalid proxy resource path" }, { status: 400, headers: corsHeaders() })
  }
  let deadline: AbortSignal | null = null
  try {
    const subPath = path.join("/")
    const targetBase = targetUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "")
    // Inoltra i query param originali della richiesta (genre/skip/type/id/...):
    // senza, i cataloghi/meta proxati perdono filtro e paginazione (finding 3).
    // Esclusi i parametri di controllo del proxy stesso e le chiavi API
    // (fix M6): la chiave TMDB/MDBList dell'utente non deve finire sul server
    // dell'addon proxyato.
    const STRIPPED_PARAMS = new Set(["target", "url", "u", "user", "api_key", "apikey", "x-api-key", "mdblist_key"])
    const targetQuery = new URLSearchParams()
    for (const [k, v] of searchParams) {
      if (STRIPPED_PARAMS.has(k.toLowerCase())) continue
      targetQuery.append(k, v)
    }
    const qs = targetQuery.toString()
    const fullTargetUrl = `${targetBase}/${subPath}${qs ? `?${qs}` : ""}`
    const { signal, deadline: d } = hopSignal(12000)
    deadline = d
    const res = await safeFetch(fullTargetUrl, { signal })
    if (!res.ok) {
      return Response.json({ error: `Failed to fetch proxy resource: ${res.statusText}` }, { status: res.status, headers: corsHeaders() })
    }

    const data = (await readJsonCapped(res)) as Record<string, unknown> & { metas?: StremioItemMeta[]; meta?: StremioItemMeta }

    if (data && Array.isArray(data.metas)) {
      data.metas = rewriteMetasPosters(data.metas as StremioItemMeta[], origin, userUuid)
    } else if (data && data.meta) {
      data.meta = rewriteSingleMetaPoster(data.meta as StremioItemMeta, origin, userUuid)
    }

    // Echo del Content-Type upstream invece di forzare JSON (fix H9): addon
    // stream/metadata possono rispondere con altri media type (es. M3U8).
    return Response.json(data, { headers: { ...corsHeaders(), "Content-Type": res.headers.get("content-type") || "application/json; charset=utf-8" } })
  } catch (e) {
    log.error("Resource proxy error", { error: e instanceof Error ? e.message : String(e) })
    if (deadline && deadline.aborted) {
      return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
    }
    if (e instanceof ProxyBodyTooLargeError) {
      return Response.json({ error: "Proxy resource too large" }, { status: 413, headers: corsHeaders() })
    }
    return Response.json({ error: "Proxy resource error" }, { status: 500, headers: corsHeaders() })
  }
}
