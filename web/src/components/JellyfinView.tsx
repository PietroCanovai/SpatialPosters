"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, Loader2, Palette, Search, Send, Server, Unplug, X } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { rememberItemSummary } from "@/lib/useNavigation"
import { getLang } from "@/lib/i18n"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  jellyfinApi, jellyfinImageUrl,
  type JellyfinItemDto, type JellyfinLibraryDto, type JellyfinStatus,
} from "@/lib/jellyfin-client"

const PAGE_SIZE = 60
const PUSH_CONCURRENCY = 2

type PushState = { state: "sending" } | { state: "done"; at: number } | { state: "error"; message: string }

function ConnectionCard({ status, onChange }: { status: JellyfinStatus | null; onChange: (s: JellyfinStatus) => void }) {
  const { t } = useT()
  const [url, setUrl] = useState(status?.url || "")
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(!status?.configured)

  useEffect(() => {
    setUrl(status?.url || "")
    setEditing(!status?.configured)
  }, [status?.url, status?.configured])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      onChange(await jellyfinApi.save(url, apiKey))
      setApiKey("")
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    onChange(await jellyfinApi.disconnect())
  }

  if (status?.configured && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <Server className="h-5 w-5 text-zinc-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">
            {status.connected ? `${status.serverName} ${status.version ? `· ${status.version}` : ""}` : t("jf.unreachable")}
          </div>
          <div className="truncate text-xs text-zinc-400">{status.connected ? status.url : status.error}</div>
        </div>
        <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${status.connected ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
          {status.connected ? t("jf.connected") : t("jf.offline")}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/[0.1]">
          {t("ui.edit")}
        </button>
        <button type="button" onClick={disconnect} title={t("jf.disconnect")} className="rounded-xl border border-white/10 bg-white/[0.05] p-1.5 text-zinc-300 hover:bg-white/[0.1]">
          <Unplug className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div>
        <h2 className="text-sm font-bold text-white">{t("jf.connectTitle")}</h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          {t("jf.connectHelp")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.10:8096"
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder={status?.configured ? t("jf.apiKeyKeep") : t("jf.apiKey")}
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !url || (!apiKey && !status?.configured)}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("jf.connect")}
          </button>
          {status?.configured && (
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-white/10 px-3 text-sm text-zinc-300">
              {t("ui.cancel")}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}

function ItemCard({ item, push, bust, onSend }: {
  item: JellyfinItemDto
  push?: PushState
  bust?: number
  onSend: () => void
}) {
  const { t } = useT()
  const editorHref = item.tmdbId ? `/${item.type === "tv" ? "tv" : "movie"}/${item.tmdbId}` : null
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="relative aspect-[2/3] bg-black/40">
        {(item.imageTag || bust) && (
          // eslint-disable-next-line @next/next/no-img-element -- proxied Jellyfin image
          <img src={jellyfinImageUrl(item, bust)} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
        )}
        {push?.state === "sending" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        {push?.state === "done" && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500 p-1 text-white shadow-lg"><Check className="h-3 w-3" /></span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-white" title={item.name}>{item.name}</div>
          <div className="text-[11px] text-zinc-400">{item.year ?? "—"} · {item.type === "tv" ? t("ui.series") : t("ui.movie")}</div>
        </div>
        {push?.state === "error" && <p className="line-clamp-3 text-[11px] text-rose-300" title={push.message}>{push.message}</p>}
        {!item.tmdbId ? (
          <p className="text-[11px] text-amber-300">{t("jf.noTmdbId")}</p>
        ) : (
          <div className="mt-auto grid grid-cols-2 gap-1.5">
            <Link href={editorHref!} onClick={() => rememberItemSummary({ id: item.tmdbId!, media_type: item.type, title: item.name, name: item.name, poster_path: null, release_date: item.year ? `${item.year}-01-01` : undefined, first_air_date: item.year ? `${item.year}-01-01` : undefined })} className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-white/[0.1]">
              <Palette className="h-3.5 w-3.5" /> {t("jf.design")}
            </Link>
            <button
              type="button"
              onClick={onSend}
              disabled={push?.state === "sending"}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-white py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {t("jf.send")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function JellyfinView() {
  const { t } = useT()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mdblistKey = usePSelector((v) => v.mdblistApiKey)

  const [status, setStatus] = useState<JellyfinStatus | null>(null)
  const [libraries, setLibraries] = useState<JellyfinLibraryDto[]>([])
  const [library, setLibrary] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<JellyfinItemDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pushes, setPushes] = useState<Record<string, PushState>>({})
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null)
  const cancelBulk = useRef(false)

  const connected = !!status?.configured && !!status.connected

  useEffect(() => {
    jellyfinApi.status().then(setStatus).catch((e) => setStatus({ configured: false, url: "", error: String(e) }))
  }, [])

  useEffect(() => {
    if (!connected) return
    jellyfinApi.libraries().then((r) => setLibraries(r.libraries)).catch(() => setLibraries([]))
  }, [connected, status?.url])

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadPage = useCallback(async (start: number) => {
    setLoading(true)
    setLoadError(null)
    try {
      const r = await jellyfinApi.items({ parentId: library, search: query, start, limit: PAGE_SIZE })
      setItems((prev) => (start === 0 ? r.items : [...prev, ...r.items]))
      setTotal(r.total)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [library, query])

  useEffect(() => {
    if (connected) loadPage(0)
  }, [connected, loadPage])

  const sendOne = useCallback(async (item: JellyfinItemDto): Promise<boolean> => {
    if (!tmdbKey) {
      setPushes((p) => ({ ...p, [item.id]: { state: "error", message: t("jf.needTmdbKey") } }))
      return false
    }
    setPushes((p) => ({ ...p, [item.id]: { state: "sending" } }))
    try {
      await jellyfinApi.push(item.id, tmdbKey, getLang(), mdblistKey)
      setPushes((p) => ({ ...p, [item.id]: { state: "done", at: Date.now() } }))
      return true
    } catch (e) {
      setPushes((p) => ({ ...p, [item.id]: { state: "error", message: e instanceof Error ? e.message : String(e) } }))
      return false
    }
  }, [tmdbKey, mdblistKey, t])

  const sendAll = async () => {
    cancelBulk.current = false
    // Carica tutte le pagine della vista corrente prima di inviare.
    let all = items
    try {
      while (all.length < total) {
        const r = await jellyfinApi.items({ parentId: library, search: query, start: all.length, limit: 500 })
        if (r.items.length === 0) break
        all = [...all, ...r.items]
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      return
    }
    setItems(all)
    const queue = all.filter((i) => i.tmdbId)
    const progress = { done: 0, total: queue.length, failed: 0 }
    setBulk({ ...progress })
    const worker = async () => {
      while (queue.length && !cancelBulk.current) {
        const ok = await sendOne(queue.shift()!)
        progress.done++
        if (!ok) progress.failed++
        setBulk({ ...progress })
      }
    }
    await Promise.all(Array.from({ length: PUSH_CONCURRENCY }, worker))
    setTimeout(() => setBulk(null), 4000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Jellyfin</h1>
          <p className="text-xs text-zinc-400">
            {t("jf.intro")}
          </p>
        </div>
      </div>

      <ConnectionCard status={status} onChange={setStatus} />

      {connected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {[{ id: null, name: t("ui.all") } as { id: string | null; name: string }, ...libraries].map((l) => (
              <button
                key={l.id ?? "all"}
                type="button"
                onClick={() => setLibrary(l.id)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${library === l.id ? "border-white bg-white text-zinc-950" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"}`}
              >
                {l.name}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("jf.searchLibrary")}
                className="w-56 rounded-xl border border-white/10 bg-black/30 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
            <span className="text-xs text-zinc-400">{t("jf.titles", { n: total })}</span>
            {!tmdbKey && <span className="text-xs text-amber-300">{t("jf.needTmdbKeyRender")}</span>}
            {bulk ? (
              <div className="ml-auto flex items-center gap-3">
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-white transition-all" style={{ width: `${bulk.total ? (bulk.done / bulk.total) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-zinc-300">
                  {bulk.done}/{bulk.total}{bulk.failed ? ` · ${t("jf.failed", { n: bulk.failed })}` : ""}
                </span>
                {bulk.done < bulk.total && (
                  <button type="button" onClick={() => { cancelBulk.current = true }} className="rounded-lg border border-white/10 p-1 text-zinc-300">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={!tmdbKey || total === 0}
                onClick={sendAll}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> {t("jf.sendAll")}
              </button>
            )}
          </div>

          {loadError && <p className="text-xs text-rose-300">{loadError}</p>}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {items.map((item) => {
              const push = pushes[item.id]
              return (
                <ItemCard
                  key={item.id}
                  item={item}
                  push={push}
                  bust={push?.state === "done" ? push.at : undefined}
                  onSend={() => sendOne(item)}
                />
              )
            })}
          </div>

          {items.length < total && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => loadPage(items.length)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.1] disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("ui.loadMore")}
              </button>
            </div>
          )}
          {loading && items.length === 0 && (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
          )}
        </>
      )}
    </div>
  )
}
