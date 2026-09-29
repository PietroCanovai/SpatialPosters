import fs from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"

const log = createLogger("provider-keys")

/**
 * Chiavi dei provider salvate dalla UI (Impostazioni → API keys) in
 * DATA_DIR/provider-keys.json. Upstream le leggeva solo da variabili
 * d'ambiente: invece di modificare ~20 call site, le chiavi salvate vengono
 * applicate a process.env (SPATIALPOSTERS_*) all'avvio del server
 * (instrumentation.ts) e a ogni salvataggio. Le chiavi salvate vincono
 * sull'ambiente.
 */

export const PROVIDERS = ["tmdb", "mdblist", "tvdb", "fanart", "anidb"] as const
export type Provider = (typeof PROVIDERS)[number]
export type ProviderKeys = Partial<Record<Provider, string>>

const ENV_NAME: Record<Provider, string> = {
  tmdb: "SPATIALPOSTERS_TMDB_KEY",
  mdblist: "SPATIALPOSTERS_MDBLIST_KEY",
  tvdb: "SPATIALPOSTERS_TVDB_API_KEY",
  fanart: "SPATIALPOSTERS_FANART_KEY",
  anidb: "SPATIALPOSTERS_ANIDB_CLIENT",
}

function file(): string {
  return path.join(DATA_DIR, "provider-keys.json")
}

export function readProviderKeys(): ProviderKeys {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf-8")) as Record<string, unknown>
    const keys: ProviderKeys = {}
    for (const p of PROVIDERS) if (typeof raw[p] === "string" && raw[p]) keys[p] = raw[p] as string
    return keys
  } catch {
    return {}
  }
}

/** Applica le chiavi salvate a process.env; una chiave cancellata rimuove anche l'env. */
export function applyProviderKeys(keys: ProviderKeys = readProviderKeys(), previous: ProviderKeys = {}): void {
  for (const p of PROVIDERS) {
    if (keys[p]) process.env[ENV_NAME[p]] = keys[p]
    else if (previous[p] && process.env[ENV_NAME[p]] === previous[p]) delete process.env[ENV_NAME[p]]
  }
}

export function writeProviderKeys(next: ProviderKeys): ProviderKeys {
  const previous = readProviderKeys()
  const clean: ProviderKeys = {}
  for (const p of PROVIDERS) {
    const v = next[p]?.trim()
    if (v) clean[p] = v
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${file()}.tmp.${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), "utf-8")
  fs.renameSync(tmp, file())
  applyProviderKeys(clean, previous)
  log.info("Provider keys saved", { providers: Object.keys(clean) })
  return clean
}

/** Chiave effettiva (salvata o da env) per ogni provider, per la UI admin. */
export function effectiveProviderKeys(): Record<Provider, string> {
  return {
    tmdb: process.env.SPATIALPOSTERS_TMDB_KEY || process.env.TMDB_API_KEY || process.env.TMDB_KEY || "",
    mdblist: process.env.SPATIALPOSTERS_MDBLIST_KEY || process.env.MDBLIST_API_KEY || process.env.MDBLIST_KEY || "",
    tvdb: process.env.SPATIALPOSTERS_TVDB_API_KEY || process.env.TVDB_API_KEY || "",
    fanart: process.env.SPATIALPOSTERS_FANART_KEY || "",
    anidb: process.env.SPATIALPOSTERS_ANIDB_CLIENT || "",
  }
}

export async function validateProviderKey(provider: Provider, key: string): Promise<{ valid: boolean; message?: string }> {
  const k = encodeURIComponent(key.trim())
  try {
    if (provider === "tmdb") {
      const base = process.env.TMDB_BASE_URL || "https://api.themoviedb.org/3"
      const res = await fetch(`${base}/authentication?api_key=${k}`, { signal: AbortSignal.timeout(8000) })
      const data = res.ok ? await res.json().catch(() => null) : null
      return data?.success === true ? { valid: true } : { valid: false, message: "TMDB rejected this key" }
    }
    if (provider === "mdblist") {
      const res = await fetch(`https://api.mdblist.com/user?apikey=${k}`, { signal: AbortSignal.timeout(8000) })
      return res.ok ? { valid: true } : { valid: false, message: "MDBList rejected this key" }
    }
    if (provider === "tvdb") {
      const res = await fetch("https://api4.thetvdb.com/v4/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: key.trim() }),
        signal: AbortSignal.timeout(8000),
      })
      return res.ok ? { valid: true } : { valid: false, message: "TheTVDB rejected this key" }
    }
    if (provider === "fanart") {
      const res = await fetch(`https://webservice.fanart.tv/v3/movies/27205?api_key=${k}`, { signal: AbortSignal.timeout(8000) })
      return res.status !== 401 && res.status !== 403 ? { valid: true } : { valid: false, message: "fanart.tv rejected this key" }
    }
    // AniDB: il "client" registrato sull'account; una richiesta con client
    // non valido risponde <error>client version missing or invalid</error>.
    const res = await fetch(`http://api.anidb.net:9001/httpapi?request=anime&client=${k}&clientver=1&protover=1&aid=1`, { signal: AbortSignal.timeout(8000) })
    const body = await res.text()
    return /<error[^>]*>[^<]*client/i.test(body) ? { valid: false, message: "AniDB doesn't recognise this client name (register it on anidb.net, version 1)" } : { valid: true }
  } catch (e) {
    return { valid: false, message: `Could not reach ${provider.toUpperCase()} (${e instanceof Error ? e.message : String(e)})` }
  }
}
