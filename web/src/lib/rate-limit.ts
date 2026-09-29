const buckets = new Map<string, { tokens: number; lastRefill: number }>()
const CLEANUP_INTERVAL = 30 * 60 * 1000
// Cap sul numero di bucket: gli IP spoofati (X-Forwarded-For senza proxy
// trusted) possono generare chiavi arbitrarie. Oltre il cap, i bucket più
// vecchi vengono rimossi (FIFO) per tenere la memoria bounded.
const MAX_KEYS = 50_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null
import { envWithFallback } from "@/lib/env-compat"

function evictOldest() {
  const oldest = buckets.keys().next().value
  if (oldest !== undefined) buckets.delete(oldest)
}

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - CLEANUP_INTERVAL
    for (const [key, b] of buckets) {
      if (b.lastRefill < cutoff) buckets.delete(key)
    }
  }, CLEANUP_INTERVAL)
}

interface BucketConfig {
  maxTokens: number
  refillRate: number
  refillWindow: number
}

// F7: il bucket poster era 100 burst/10s — un catalog load con molti poster
// freddi poteva andare in 429. Sovrascrivibile via env a module level.
const POSTER_MAX_TOKENS = (() => {
  const raw = envWithFallback("RATELIMIT_POSTER_MAX")
  const n = raw ? parseInt(raw, 10) : 200
  return Number.isFinite(n) && n >= 10 && n <= 10000 ? n : 200
})()

const limits: Record<string, BucketConfig> = {
  default: { maxTokens: 120, refillRate: 10, refillWindow: 1000 },
  tmdb:    { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  poster:  { maxTokens: POSTER_MAX_TOKENS, refillRate: 20, refillWindow: 1000 },
  search:  { maxTokens: 30,  refillRate: 3,  refillWindow: 1000 },
  mappings: { maxTokens: 120, refillRate: 10, refillWindow: 1000 },
  catalog:  { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  // Warmup: operazione pesante (rende molti poster) — burst basso e refill lento
  // per evitare che chiunque (istanza pubblica) possa triggerare carico.
  warmup:   { maxTokens: 5,  refillRate: 1,  refillWindow: 1000 },
  // Config token: generazione di link firmati — burst contenuto per evitare
  // che l'endpoint venga usato come generatore massivo.
  config:   { maxTokens: 30, refillRate: 3,  refillWindow: 1000 },
  defaults: { maxTokens: 30, refillRate: 3,  refillWindow: 1000 },
}

function memoryRateLimit(bucketKey: string, cfg: BucketConfig, now: number): { ok: boolean; retAfter: number } {
  startCleanup()
  let b = buckets.get(bucketKey)

  if (!b) {
    if (buckets.size >= MAX_KEYS) evictOldest()
    b = { tokens: cfg.maxTokens, lastRefill: now }
    buckets.set(bucketKey, b)
  }

  const elapsed = now - b.lastRefill
  if (elapsed >= cfg.refillWindow) {
    const cycles = Math.floor(elapsed / cfg.refillWindow)
    const refill = cycles * cfg.refillRate
    b.tokens = Math.min(b.tokens + refill, cfg.maxTokens)
    b.lastRefill += cycles * cfg.refillWindow
  }

  if (b.tokens > 0) {
    b.tokens--
    return { ok: true, retAfter: 0 }
  }

  const waitMs = b.lastRefill + cfg.refillWindow - now
  return { ok: false, retAfter: Math.ceil(waitMs / 1000) }
}

/** Rate-limit per-processo (token bucket in memoria). Async per compatibilità con le call site. */
export async function rateLimit(key: string, bucket: string): Promise<{ ok: boolean; retAfter: number }> {
  const cfg = limits[bucket] || limits.default
  const now = Date.now()
  // Chiave composta (bucket, client): con la chiave client condivisa "shared"
  // (senza PICTORIUM_TRUST_PROXY) tutte le route finivano in un UNICO bucket
  // il cui maxTokens/refill veniva sovrascritto dall'ultima route chiamata
  // (una chiamata warmup con max 5 sgonfiava il bucket di poster/tmdb e
  // viceversa, rendendo i limiti per-route illusori).
  const bucketKey = `${bucket}:${key}`
  return memoryRateLimit(bucketKey, cfg, now)
}

export function rateLimitKey(request: Request): string {
  // Estrae l'IP client per il rate limit. Quando PICTORIUM_TRUST_PROXY=1
  // gli header sono considerati fidati (proxy sovrascrive XFF), altrimenti
  // x-forwarded-for è ignorato per evitare bucket pollution (H2): l'attaccante
  // poteva inviare X-Forwarded-For arbitrario e generare fino a MAX_KEYS bucket
  // distinti, evictando quelli legittimi (FIFO). x-real-ip / cf-connecting-ip
  // restano usati (Nginx/Cloudflare) ma il fallback ua: garantisce granularità
  // minima senza ricadere nel vecchio bucket "shared" globale.
  const trusted = envWithFallback("TRUST_PROXY") === "1"
  // 1) x-real-ip — Nginx/HF
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()
  // 2) cf-connecting-ip — Cloudflare
  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) return cfIp.trim()
  // 3) x-forwarded-for — solo se trusted, altrimenti spoofabile (H2)
  if (trusted) {
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean)
      if (parts.length > 0) {
        const ip = parts[parts.length - 1]
        if (ip) return ip
      }
    }
  }
  // Fallback: senza header IP affidabile, usa un bucket per-istanza ma con
  // limite più alto (evita DoS del vecchio "shared"). Distinguiamo con
  // user-agent hash quando disponibile per granularità minima.
  const ua = request.headers.get("user-agent")
  if (ua) return `ua:${ua.slice(0, 48)}`
  return "local"
}

export function rateLimitResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "Troppe richieste. Attendi qualche secondo." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
  })
}
