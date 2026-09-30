"use client"

import React, { useEffect, useState } from "react"
import { Check, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"

type Provider = "tmdb" | "mdblist" | "tvdb" | "fanart" | "anidb"
type Keys = Record<Provider, string>

const PROVIDERS: { id: Provider; name: string; required?: boolean; getKeyUrl: string; getKeyHint: string }[] = [
  {
    id: "tmdb",
    name: "TMDB",
    required: true,
    getKeyUrl: "https://www.themoviedb.org/settings/api",
    getKeyHint: "themoviedb.org → Settings → API → API Key",
  },
  {
    id: "mdblist",
    name: "MDBList",
    getKeyUrl: "https://mdblist.com/preferences/",
    getKeyHint: "mdblist.com → Preferences → API key",
  },
  {
    id: "fanart",
    name: "Fanart.tv",
    getKeyUrl: "https://fanart.tv/get-an-api-key/",
    getKeyHint: "fanart.tv → Get an API key (personal key)",
  },
  {
    id: "tvdb",
    name: "TheTVDB",
    getKeyUrl: "https://thetvdb.com/api-information",
    getKeyHint: "thetvdb.com → API Information → project API key",
  },
  {
    id: "anidb",
    name: "AniDB",
    getKeyUrl: "https://anidb.net/software/add",
    getKeyHint: "anidb.net → Account → Add client (name, version 1)",
  },
]

/**
 * Chiavi API dei provider, salvate sul server (data/provider-keys.json) e
 * usate da tutti i render, compresi gli upload verso Jellyfin.
 */
export function ProviderKeysPanel({ active }: { active: boolean }) {
  const { t } = useT()
  const setTmdbKey = usePSelector((v) => v.setTmdbKey)
  const setMdblistApiKey = usePSelector((v) => v.setMdblistApiKey)

  const [saved, setSaved] = useState<Keys>({ tmdb: "", mdblist: "", tvdb: "", fanart: "", anidb: "" })
  const [draft, setDraft] = useState<Keys>({ tmdb: "", mdblist: "", tvdb: "", fanart: "", anidb: "" })
  const [errors, setErrors] = useState<Partial<Keys>>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/provider-keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { keys: Keys } | null) => {
        if (data?.keys) {
          setSaved(data.keys)
          setDraft(data.keys)
        }
      })
      .finally(() => setLoaded(true))
  }, [])

  const dirty = PROVIDERS.some((p) => draft[p.id].trim() !== saved[p.id])

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch("/api/provider-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const data = (await res.json().catch(() => ({}))) as { keys?: Keys; errors?: Partial<Keys>; error?: string }
      if (!data.keys) throw new Error(data.error || `HTTP ${res.status}`)
      setSaved(data.keys)
      setDraft((d) => {
        // Le chiavi rifiutate restano nel campo per poterle correggere.
        const next = { ...data.keys! }
        for (const p of Object.keys(data.errors || {}) as Provider[]) next[p] = d[p]
        return next
      })
      setErrors(data.errors || {})
      setTmdbKey(data.keys.tmdb)
      setMdblistApiKey(data.keys.mdblist)
      if (data.errors && Object.keys(data.errors).length) toast.error(t("keys.rejected"))
      else toast.success(t("keys.savedToast"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="tabpanel" aria-label={t("ui.apiKeysTab")} className={`space-y-3 text-xs ${active ? "block" : "hidden"}`}>
      <p className="px-1 text-zinc-400">
        {t("keys.intro")}
      </p>
      {PROVIDERS.map((p) => {
        const isSet = !!saved[p.id]
        return (
          <div key={p.id} className="space-y-2 rounded-xl border border-surface2/60 bg-surface/50 p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100">{p.name}</span>
              {p.required && !isSet && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">{t("keys.required")}</span>}
              {isSet && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <Check className="h-3 w-3" /> {t("keys.saved")}
                </span>
              )}
              <a
                href={p.getKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={p.getKeyHint}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                {t("keys.getKey")} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-[11px] text-zinc-400">{t(`keys.purpose.${p.id}`)}</p>
            <input
              type={p.id === "anidb" ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              disabled={!loaded}
              value={draft[p.id]}
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
              placeholder={p.getKeyHint}
              aria-label={`${p.name} API key`}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
            />
            {errors[p.id] && <p className="text-[11px] text-rose-300">{errors[p.id]}</p>}
          </div>
        )
      })}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("keys.save")}
        </button>
      </div>
    </div>
  )
}
