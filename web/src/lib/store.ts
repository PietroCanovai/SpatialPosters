import fsp from "node:fs/promises"
import path from "node:path"
import type { Mapping } from "@/lib/types"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"

export type { Mapping }

const log = createLogger("store")

const debugStore = envWithFallback("DEBUG") === "1"

if (debugStore) {
  log.info("Data directory", { dir: DATA_DIR, file: path.join(DATA_DIR, "mappings.json") })
}

// ---- File-based helpers ----

const DATA_FILE = path.join(DATA_DIR, "mappings.json")
let writeQueue = Promise.resolve()
// In-memory mirror so reads never go stale during a write
let memCache: Record<string, Mapping> | null = null
let memCacheTime = 0

// Lo stat del file viene fatto al massimo ogni READ_STAT_TTL_MS; le scritture nostre aggiornano la
// memCache subito, quindi la staleness è limitata alle scritture di ALTRI
// processi (multi-istanza) ed è bounded a 500ms. Nei test il TTL è 0 per
// mantenere il determinismo (i test scrivono il file e lo rileggono subito).
const READ_STAT_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 500
let lastStatAt = 0

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/** Consecutive write failures — resets to 0 on success */
let writeFailures = 0

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(
    () => { writeFailures = 0 },
    (error) => {
      writeFailures++
      const msg = error instanceof Error ? error.message : String(error)
      log.error("Write queue task failed", { error: msg, consecutiveFailures: writeFailures })
      if (writeFailures >= 5) {
        log.error("Write queue has 5+ consecutive failures — check disk permissions or storage backend")
      }
      throw error
    },
  )
  return run
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`Failed to create data dir '${DATA_DIR}': ${msg}`)
    throw new Error(`Cannot create data directory: ${msg}`)
  })
}

/**
 * Read from disk, then update the in-memory mirror.
 */
async function loadFromDisk(): Promise<Record<string, Mapping>> {
  try {
    const stat = await fsp.stat(DATA_FILE).catch(() => null)
    const raw = await fsp.readFile(DATA_FILE, "utf-8")
    const data = JSON.parse(raw) as Record<string, Mapping>
    memCache = data
    memCacheTime = stat ? stat.mtimeMs : Date.now()
    return data
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      memCache = {}
      // Sentinella: il file non esiste. Con memCacheTime=0 qualsiasi file
      // creato successivamente (anche nello stesso millisecondo da un altro
      // worker) ha mtime > 0 e viene rilevato al prossimo stat. Con Date.now()
      // una scrittura nello stesso ms non veniva vista (mtime == cacheTime) e
      // la cache restava stantia (race vista nei test CI).
      memCacheTime = 0
      return {}
    }
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to load mappings", { error: message })
    return memCache ?? {}
  }
}

/**
 * Fast read via in-memory mirror, refreshing from disk if file was modified.
 */
async function readFromMem(): Promise<Record<string, Mapping>> {
  const now = Date.now()
  if (memCache && now - lastStatAt < READ_STAT_TTL_MS) return memCache
  lastStatAt = now
  try {
    const stat = await fsp.stat(DATA_FILE)
    if (memCache && stat.mtimeMs <= memCacheTime) return memCache
  } catch {
    if (memCache) return memCache
  }
  return loadFromDisk()
}

async function persist(data: Record<string, Mapping>) {
  await ensureDataDir()
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
    try {
      await fsp.rename(tmp, DATA_FILE)
    } catch (e) {
      if (isNodeError(e) && (e as NodeJS.ErrnoException).code === "EXDEV") {
        // EXDEV se tmp e DATA_FILE sono su volumi diversi: copy+unlink.
        await fsp.copyFile(tmp, DATA_FILE)
        await fsp.unlink(tmp).catch(() => {})
      } else {
        throw e
      }
    }
    // Aggiorna la memCache SOLO dopo la write riuscita: se la persist fallisce,
    // la memCache resta coerente con il disco e non serve dati mai persistiti.
    memCache = data
    memCacheTime = Date.now()
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    log.error("Failed to write mappings", { file: DATA_FILE, error: msg })
    if (msg.includes("EACCES") || msg.includes("EPERM")) {
      log.error("Permission error — check that data dir is writable", { dir: DATA_DIR })
    }
    throw new Error(`Cannot persist mappings: ${msg}`)
  }
}

// ---- Exported API ----

export async function getAll(): Promise<Mapping[]> {
  return Object.values(await readFromMem())
}

export async function getById(type: "movie" | "tv", id: number): Promise<Mapping | null> {
  const key = `${type}:${id}`
  const data = await readFromMem()
  return data[key] ?? null
}

export async function upsert(mapping: Mapping) {
  return enqueueWrite(async () => {
    // Fix M13: rilettura FORZATA da disco dentro la coda di scrittura.
    // Prima readFromMem() poteva restituire la memCache stantia (TTL 500ms):
    // due istanze che scrivevano insieme si sovrascrivevano le entry (lost
    // update). La coda serializza le scritture di questo processo, ma il
    // merge deve partire dallo stato reale su disco, non dal mirror.
    const data = await loadFromDisk()
    const key = `${mapping.mediaType}:${mapping.tmdbId}`
    data[key] = { ...mapping, updatedAt: new Date().toISOString() }
    await persist(data)
  })
}

export async function remove(type: "movie" | "tv", id: number) {
  return enqueueWrite(async () => {
    const data = await loadFromDisk()
    const key = `${type}:${id}`
    delete data[key]
    await persist(data)
  })
}

export async function removeAll() {
  return enqueueWrite(async () => {
    await persist({})
  })
}

export async function importMappings(mappings: Mapping[]) {
  return enqueueWrite(async () => {
    const data = await loadFromDisk() // Fix M13: merge sullo stato reale su disco
    const now = new Date().toISOString()
    for (const m of mappings) {
      const key = `${m.mediaType}:${m.tmdbId}`
      // updatedAt è parte del cache key dei poster: timbrarlo invalida la cache.
      data[key] = { ...m, updatedAt: now }
    }
    await persist(data)
  })
}
