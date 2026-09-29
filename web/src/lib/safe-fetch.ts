import dns, { type LookupOptions } from "node:dns"
import { createRequire } from "node:module"
import { createLogger } from "@/lib/logger"

const log = createLogger("safe-fetch")

/** Un hostname è un letterale IPv4 (es. 10.0.0.1) e non un nome DNS. */
export function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

/** Blocca richieste a IP privati / localhost per prevenire SSRF.
 *
 * Importante: i check sui prefissi IP (RFC 1918, fc00::/7, fe80::/10, …) si
 * applicano SOLO ai letterali IP. Un nome DNS come "fcbarcelona.com" non deve
 * essere bloccato solo perché inizia con "fc": per i nomi DNS la protezione
 * arriva dal resolve (resolveAndCheckBlocked/isPrivateIp sugli indirizzi
 * risolti), non da un match di prefisso sul testo.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === "localhost") return true
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true

  // Letterale IPv6 — rimuovi le parentesi per un match uniforme.
  if (h.includes(":")) {
    const bare = h.replace(/^\[|\]$/g, "")
    return (
      bare === "::1" || bare === "::" ||           // loopback / unspecified
      bare.startsWith("::ffff:") ||                // IPv4-mapped IPv6
      bare.startsWith("fc") || bare.startsWith("fd") ||  // fc00::/7 ULA
      /^fe[89ab]/.test(bare)                       // fe80::/10 link-local
    )
  }

  // Letterale IPv4 — i check RFC 1918 / link-local valgono solo qui.
  if (isIpv4Literal(h)) {
    return (
      /^127\./.test(h) ||                          // loopback 127.0.0.0/8
      /^0\./.test(h) ||                            // 0.0.0.0/8
      h.startsWith("10.") ||                       // RFC 1918 10.0.0.0/8
      h.startsWith("192.168.") ||                  // RFC 1918 192.168.0.0/16
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||      // RFC 1918 172.16.0.0/12
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || // CGNAT 100.64.0.0/10
      /^169\.254\./.test(h)                        // link-local
    )
  }

  // Nome DNS: mai bloccato dal testo, sarà valutato sugli IP risolti.
  return false
}

/** Verifica se un indirizzo IP risolto (IPv4 o IPv6) è privato/non routabile. */
export function isPrivateIp(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === "::1" || lower === "::" || lower === "[::1]" || lower === "[::]") return true
  if (lower.startsWith("::ffff:") || lower.startsWith("0:0:0:0:0:ffff:")) {
    // IPv4-mapped IPv6: estrai il quad e valutalo come IPv4
    const v4 = lower.split(":").pop() || ""
    if (isPrivateHost(v4)) return true
    return /^127\./.test(v4) || v4 === "0.0.0.0"
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // ULA fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true // link-local
  if (isPrivateHost(lower)) return true
  return false
}

/**
 * Risolve un hostname a IP (entrambe le famiglie) e verifica che nessuno sia privato.
 * Protegge da:
 * - DNS rebinding (il controllo viene fatto dopo la risoluzione DNS)
 * - IP alternativi (decimali, hex, IPv4-mapped IPv6)
 * - Hostname locali
 * - IPv6 (fetch/undici usa Happy Eyeballs: può connettersi via AAAA anche se il check
 *   considera solo A — quindi dobbiamo bloccare se QUALSIASI indirizzo risolto è privato)
 */
export async function resolveAndCheckBlocked(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true
    const hostname = parsed.hostname.toLowerCase()
    // Controllo rapido su hostname prima di risolvere
    if (isPrivateHost(hostname)) return true
    // Risolvi a IP per prevenire bypass con rappresentazioni alternative.
    // family 0 + all: tutte le family, tutti gli IP. Blocca se uno qualsiasi è privato.
    const addresses = await dns.promises.lookup(hostname, { family: 0, all: true })
    for (const entry of addresses) {
      if (isPrivateIp(entry.address)) return true
    }
    return false
  } catch {
    return true // in caso di errore DNS, blocca per sicurezza
  }
}

/**
 * Lookup DNS personalizzato per l'Agent undici: risolve il hostname e restituisce
 * SOLO gli indirizzi pubblici. Chiude il TOCTOU di resolveAndCheckBlocked: la
 * connessione avviene esattamente sugli IP verificati, senza finestra di
 * DNS-rebinding tra check e fetch. Se nessun indirizzo è pubblico → errore.
 */
function safeLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: dns.LookupAddress[] | string, family?: number) => void) {
  dns.promises
    .lookup(hostname, { family: 0, all: true })
    .then((addresses) => {
      const safe = addresses.filter((a) => !isPrivateIp(a.address))
      if (safe.length === 0) {
        callback(new Error(`Blocked SSRF: no public IP for ${hostname}`), [])
        return
      }
      if (options.all) {
        callback(null, safe)
      } else {
        callback(null, safe[0].address, safe[0].family)
      }
    })
    .catch((err: NodeJS.ErrnoException) => callback(err, []))
}

type Undici = typeof import("undici")

/**
 * Agent undici con lookup vincolato agli IP pubblici (DNS pin), insieme alla
 * `fetch` dello STESSO pacchetto undici. Passare un Agent di undici npm alla
 * fetch globale di Node (che include un'altra versione di undici) fallisce
 * con "invalid onRequestStart method": Agent e fetch devono venire dalla
 * stessa copia. Lazy per non rompere la build se undici non è caricabile.
 */
let pinned: { agent: InstanceType<Undici["Agent"]>; fetch: Undici["fetch"] } | undefined
let pinnedTried = false
function getPinned() {
  if (pinnedTried) return pinned
  pinnedTried = true
  try {
    const require = createRequire(import.meta.url)
    const undici = require("undici") as Undici
    pinned = { agent: new undici.Agent({ connect: { lookup: safeLookup } }), fetch: undici.fetch }
  } catch (e) {
    log.warn("undici Agent unavailable — DNS pin disabilitato, fallback a fetch senza dispatcher", {
      error: e instanceof Error ? e.message : String(e),
    })
    pinned = undefined
  }
  return pinned
}

/**
 * fetch con connessione vincolata agli IP pubblici verificati (se undici è
 * disponibile), altrimenti fetch globale. Redirect sempre manuali: il
 * chiamante deve validare ogni destinazione.
 */
export function pinnedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const p = getPinned()
  const opts = { ...init, redirect: "manual" as const }
  // Nei test (Vitest) si usa la fetch globale, che è quella mockata.
  if (!p || process.env.VITEST) return fetch(url, opts)
  return p.fetch(url, { ...opts, dispatcher: p.agent } as Parameters<Undici["fetch"]>[1]) as unknown as Promise<Response>
}

export class SsrfBlockedError extends Error {}

/**
 * fetch verso URL forniti dall'utente (poster/logo custom, og:image, …):
 * valida la destinazione iniziale e ogni redirect contro IP privati/loopback
 * e, se undici è disponibile, vincola la connessione agli IP verificati.
 * Lancia SsrfBlockedError se una destinazione è bloccata.
 */
export async function fetchPublicUrl(url: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let currentUrl = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (await resolveAndCheckBlocked(currentUrl)) {
      throw new SsrfBlockedError(`Blocked non-public target: ${new URL(currentUrl).hostname}`)
    }
    const res = await pinnedFetch(currentUrl, init)
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get("location")
    if (!location) return res
    currentUrl = new URL(location, currentUrl).href
  }
  throw new Error("Too many redirects")
}
