import fs from "node:fs/promises"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"

const log = createLogger("pin-auth")

export function getSecurityFile(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, "security.json")
}

function getDataDir(): string {
  return envWithFallback("DATA_DIR") || DATA_DIR
}


export const PIN_COOKIE_NAME = "pictorium_pin_session"
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60 // 30 giorni

export interface SecurityConfig {
  pinHash?: string // format: `${salt}:${hash}`
  sessionSecret?: string
  updatedAt?: string
}

let cachedConfig: SecurityConfig | null = null
let cacheAt = 0
const CACHE_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 1000

export function _resetPinCache(): void {
  cachedConfig = null
  cacheAt = 0
}

export async function readSecurityConfig(): Promise<SecurityConfig> {
  const now = Date.now()
  if (cachedConfig && now - cacheAt < CACHE_TTL_MS) {
    return cachedConfig
  }

  try {
    const file = getSecurityFile()
    if (!existsSync(file)) {
      cachedConfig = {}
      cacheAt = now
      return cachedConfig
    }
    const raw = await fs.readFile(file, "utf-8")
    cachedConfig = JSON.parse(raw) as SecurityConfig
    cacheAt = now
    return cachedConfig
  } catch (err) {
    log.error("Failed to read security config from file", { err })
    return {}
  }
}

export function readSecurityConfigSync(): SecurityConfig {
  const now = Date.now()
  if (cachedConfig && now - cacheAt < CACHE_TTL_MS) {
    return cachedConfig
  }
  try {
    const file = getSecurityFile()
    if (!existsSync(file)) {
      cachedConfig = {}
      cacheAt = now
      return cachedConfig
    }
    const raw = readFileSync(file, "utf-8")
    cachedConfig = JSON.parse(raw) as SecurityConfig
    cacheAt = now
    return cachedConfig
  } catch {
    return {}
  }
}

export function getAdminPinFromEnv(): string | null {
  // Nota: ADMIN_TOKEN NON è un PIN. Prima SPATIALPOSTERS_ADMIN_TOKEN veniva
  // letto anche qui, attivando il lock-screen PIN con il token admin come
  // password (e il token admin compariva in un form di login del browser).
  const pin =
    envWithFallback("ADMIN_PIN") ||
    envWithFallback("SITE_PASSWORD") ||
    envWithFallback("PIN") ||
    process.env.ADMIN_PIN ||
    process.env.SITE_PASSWORD
  if (pin && typeof pin === "string" && pin.trim().length > 0) {
    return pin.trim()
  }
  return null
}

export function isPinDisabled(): boolean {
  return (
    envWithFallback("DISABLE_PIN") === "1" ||
    process.env.DISABLE_PIN === "1" ||
    process.env.SPATIALPOSTERS_DISABLE_PIN === "1" ||
    process.env.PICTORIUM_DISABLE_PIN === "1"
  )
}

function isValidPinHash(pinHash?: string): boolean {
  if (!pinHash || typeof pinHash !== "string" || !pinHash.includes(":")) return false
  const parts = pinHash.split(":")
  return parts.length === 2 && parts[0].trim().length > 0 && parts[1].trim().length > 0
}

export function hasPinConfiguredSync(): boolean {
  if (isPinDisabled()) return false
  if (getAdminPinFromEnv()) return true
  // PIN impostato dalla UI (PUT /api/auth/pin → security.json / KV). Prima
  // veniva salvato ma mai applicato: il lock-screen restava aperto.
  return isValidPinHash(readSecurityConfigSync().pinHash)
}

// Segreto effimero di processo: usato solo se non è possibile persisterne uno.
// Mai un valore costante (prima: "spatialposters_default_session_secret",
// che permetteva di forgiare cookie di sessione validi).
const processSessionSecret = crypto.randomBytes(32).toString("hex")

export function getSessionSecretSync(): string {
  const cfg = readSecurityConfigSync()
  if (cfg.sessionSecret) return cfg.sessionSecret
  // PIN da env senza segreto salvato: genera un segreto casuale e persistilo.
  // Prima il segreto era sha256(costante + PIN): con un PIN corto chiunque
  // avesse un cookie poteva ricavare il PIN offline e forgiare sessioni.
  try {
    const file = getSecurityFile()
    const sessionSecret = crypto.randomBytes(32).toString("hex")
    const updated: SecurityConfig = { ...cfg, sessionSecret, updatedAt: new Date().toISOString() }
    mkdirSync(getDataDir(), { recursive: true })
    writeFileSync(file, JSON.stringify(updated, null, 2), "utf-8")
    cachedConfig = updated
    cacheAt = Date.now()
    return sessionSecret
  } catch (err) {
    log.warn("Cannot persist session secret — sessions reset on restart", { err })
  }
  return processSessionSecret
}

export function verifySessionFromRequestSync(request: Request): boolean {
  if (!hasPinConfiguredSync()) return true

  const token = extractSessionToken(request)
  if (!token) return false

  const parts = token.split(".")
  if (parts.length !== 2) return false

  const [payload, signature] = parts
  const expiresAt = Number(payload)
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) return false

  const secret = getSessionSecretSync()
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  if (expectedSignature.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

export async function writeSecurityConfig(config: SecurityConfig): Promise<void> {
  const updated: SecurityConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  }

  try {
    const dataDir = getDataDir()
    const file = getSecurityFile()
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.tmp.${Date.now()}`
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8")
    await fs.rename(tmp, file)
    cachedConfig = updated
    cacheAt = Date.now()
  } catch (err) {
    log.error("Failed to write security config to file", { err })
    throw err
  }
}

export function hashPin(pin: string, salt?: string): { hash: string; salt: string; pinHash: string } {
  const generatedSalt = salt || crypto.randomBytes(16).toString("hex")
  const derived = crypto.scryptSync(pin, generatedSalt, 64).toString("hex")
  return {
    hash: derived,
    salt: generatedSalt,
    pinHash: `${generatedSalt}:${derived}`,
  }
}

export async function hasPinConfigured(): Promise<boolean> {
  if (isPinDisabled()) return false
  if (getAdminPinFromEnv()) return true
  const cfg = await readSecurityConfig()
  return isValidPinHash(cfg.pinHash)
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!pin || typeof pin !== "string") return false
  const clean = pin.trim()
  const envPin = getAdminPinFromEnv()
  if (envPin) {
    const a = Buffer.from(clean)
    const b = Buffer.from(envPin)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  }

  const cfg = await readSecurityConfig()
  if (!cfg.pinHash) return false

  const [salt, storedHash] = cfg.pinHash.split(":")
  if (!salt || !storedHash) return false

  const candidate = crypto.scryptSync(clean, salt, 64).toString("hex")
  if (candidate.length !== storedHash.length) return false
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash))
}

export async function setPin(newPin: string): Promise<boolean> {
  if (!newPin || typeof newPin !== "string" || newPin.trim().length < 4) {
    return false
  }
  const cleanPin = newPin.trim()
  const cfg = await readSecurityConfig()
  const { pinHash } = hashPin(cleanPin)
  const sessionSecret = cfg.sessionSecret || crypto.randomBytes(32).toString("hex")

  await writeSecurityConfig({
    ...cfg,
    pinHash,
    sessionSecret,
  })
  return true
}

export async function removePin(currentPin: string): Promise<boolean> {
  const isValid = await verifyPin(currentPin)
  if (!isValid) return false

  await writeSecurityConfig({
    pinHash: undefined,
    sessionSecret: undefined,
  })
  return true
}

export async function createSessionToken(): Promise<string | null> {
  const hasPin = await hasPinConfigured()
  if (!hasPin) return null
  const secret = getSessionSecretSync()

  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000
  const payload = String(expiresAt)
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  return `${payload}.${signature}`
}

export function buildSessionCookie(token: string): string {
  const isProd = process.env.NODE_ENV === "production"
  const secure = isProd ? "; Secure" : ""
  // Max-Age=30 giorni
  return `${PIN_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_DURATION_SECONDS}; HttpOnly; SameSite=Lax${secure}`
}

export function buildClearSessionCookie(): string {
  return `${PIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token || typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length !== 2) return false

  const [payload, signature] = parts
  const expiresAt = Number(payload)
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) return false

  const secret = getSessionSecretSync()
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  if (expectedSignature.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

export function extractSessionToken(request: Request): string | null {
  // 1. Header esplicito
  const headerToken = request.headers.get("x-pin-token")
  if (headerToken) return headerToken

  // 2. Cookie
  const cookieHeader = request.headers.get("cookie")
  if (!cookieHeader) return null

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PIN_COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function verifySessionFromRequest(request: Request): Promise<boolean> {
  const hasPin = await hasPinConfigured()
  if (!hasPin) {
    // Se nessun PIN è configurato, la sessione non è richiesta
    return true
  }
  const token = extractSessionToken(request)
  return verifySessionToken(token)
}
