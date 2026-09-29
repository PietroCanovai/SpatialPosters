"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, Loader2, Send } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { getLang } from "@/lib/i18n"
import { jellyfinApi } from "@/lib/jellyfin-client"

/**
 * Barra fissa mostrata nell'editor quando ci si arriva dalla pagina Jellyfin
 * (?jf=<itemId>): salva il design nell'editor, poi "Send" renderizza il
 * poster con il mapping salvato e lo carica sull'item Jellyfin.
 */
export function JellyfinSendBar() {
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mdblistKey = usePSelector((v) => v.mdblistApiKey)
  const [itemId, setItemId] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const jf = new URLSearchParams(window.location.search).get("jf")
    if (jf && /^[a-f0-9-]{32,36}$/i.test(jf)) setItemId(jf)
  }, [])

  if (!itemId) return null

  const send = async () => {
    if (!tmdbKey) {
      setState("error")
      setMessage("Add your TMDB API key in Settings first.")
      return
    }
    setState("sending")
    setMessage("")
    try {
      const r = await jellyfinApi.push(itemId, tmdbKey, getLang(), mdblistKey)
      setState("done")
      setMessage(r.designed ? "Sent your saved design to Jellyfin." : "Sent with your default style. Save a design first to customise it.")
    } catch (e) {
      setState("error")
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="fixed bottom-24 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/15 bg-zinc-950/95 px-4 py-2.5 shadow-2xl shadow-black/70 backdrop-blur md:bottom-6">
      <Link href="/jellyfin" className="rounded-lg border border-white/10 p-1.5 text-zinc-300 hover:bg-white/[0.08]" title="Back to Jellyfin">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <span className={`text-xs ${state === "error" ? "text-rose-300" : state === "done" ? "text-emerald-300" : "text-zinc-300"}`}>
        {message || "Save your design, then send it to Jellyfin."}
      </span>
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-50"
      >
        {state === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "done" ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        Send to Jellyfin
      </button>
    </div>
  )
}
